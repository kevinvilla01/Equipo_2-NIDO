// Edge Function usuarios-admin: única vía para crear, editar y borrar usuarios.
//
// La app la llama con la sesión del coordinador:
//   supabase.functions.invoke('usuarios-admin', { body: { accion: 'crear', ... } })
//
// 1. Verifica el JWT de quien llama con Auth y busca su fila en usuarios:
//    debe estar activo y ser coordinador. Si no → 403.
// 2. Hace el cambio con la service_role, que solo existe aquí (variable de entorno
//    que Supabase inyecta en las Edge Functions; nunca llega al navegador).
//
// Acciones (body JSON):
//   { accion: 'crear', nombre, correo, telefono?, rol, activo?, password }
//   { accion: 'actualizar', id, nombre?, correo?, telefono?, rol?, activo?, password? }
//   { accion: 'eliminar', id }
// Respuesta: 200 { usuario } | 4xx/5xx { error, codigo }.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BLOQUEO = '876000h';
const ROLES = ['coordinador', 'voluntario'];
const COLUMNAS = 'id, nombre, correo, telefono, rol, activo, auth_id';

// Orígenes que pueden llamar a la función desde el navegador, separados por comas,
// con esquema y puerto exactos. Se configura como secreto de la función:
//   npx supabase secrets set ORIGENES_PERMITIDOS="https://<proyecto>.vercel.app,http://localhost:<puerto>"
// Si falta, ningún navegador puede llamarla (falla cerrado). No afecta a la seguridad
// del servidor (eso lo hace la verificación del JWT); solo evita que otros sitios la usen.
const ORIGENES_PERMITIDOS = new Set(
  (Deno.env.get('ORIGENES_PERMITIDOS') ?? '')
    .split(',')
    .map((origen) => origen.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);
if (ORIGENES_PERMITIDOS.size === 0) {
  console.warn('ORIGENES_PERMITIDOS está vacío: el navegador bloqueará todas las llamadas.');
}

function cabecerasCors(req: Request): Record<string, string> {
  const cabeceras: Record<string, string> = { Vary: 'Origin' };
  const origen = req.headers.get('Origin');
  if (origen && ORIGENES_PERMITIDOS.has(origen)) {
    cabeceras['Access-Control-Allow-Origin'] = origen;
    cabeceras['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    cabeceras['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    cabeceras['Access-Control-Max-Age'] = '86400';
  }
  return cabeceras;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class ErrorHttp extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

function responder(req: Request, estado: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabecerasCors(req), 'Content-Type': 'application/json' },
  });
}

type Usuario = {
  id: number;
  nombre: string;
  correo: string;
  telefono: string | null;
  rol: string;
  activo: boolean;
  auth_id: string | null;
};

async function coordinadorQueLlama(req: Request): Promise<Usuario> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new ErrorHttp(401, 'sin_sesion', 'Inicia sesión para continuar.');

  // getUser valida firma y expiración con Auth; la anon key no es un usuario y falla aquí.
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new ErrorHttp(401, 'sin_sesion', 'La sesión no es válida. Vuelve a iniciar sesión.');

  const { data: fila } = await admin
    .from('usuarios')
    .select(COLUMNAS)
    .eq('auth_id', data.user.id)
    .maybeSingle();
  if (!fila || !fila.activo || fila.rol !== 'coordinador') {
    throw new ErrorHttp(403, 'no_coordinador', 'Solo un coordinador puede administrar usuarios.');
  }
  return fila as Usuario;
}

// ---- Validación ----------------------------------------------------------------

function texto(valor: unknown, campo: string, { requerido = false, max = 200 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ErrorHttp(400, 'datos_invalidos', `Falta ${campo}.`);
    return valor === undefined ? undefined : null;
  }
  if (typeof valor !== 'string' || valor.trim() === '' || valor.trim().length > max) {
    throw new ErrorHttp(400, 'datos_invalidos', `${campo} no es válido.`);
  }
  return valor.trim();
}

function validar(body: Record<string, unknown>, creando: boolean) {
  const datos: Record<string, unknown> = {};
  const nombre = texto(body.nombre, 'el nombre', { requerido: creando });
  const correo = texto(body.correo, 'el correo', { requerido: creando, max: 254 });
  const telefono = texto(body.telefono, 'el teléfono', { max: 30 });
  if (nombre !== undefined) datos.nombre = nombre;
  if (correo !== undefined) {
    if (correo === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      throw new ErrorHttp(400, 'datos_invalidos', 'El correo no es válido.');
    }
    datos.correo = correo.toLowerCase();
  }
  if (telefono !== undefined) datos.telefono = telefono;
  if (body.rol !== undefined || creando) {
    if (!ROLES.includes(body.rol as string)) throw new ErrorHttp(400, 'datos_invalidos', 'El rol no es válido.');
    datos.rol = body.rol;
  }
  if (body.activo !== undefined) {
    if (typeof body.activo !== 'boolean') throw new ErrorHttp(400, 'datos_invalidos', 'activo debe ser verdadero o falso.');
    datos.activo = body.activo;
  } else if (creando) {
    datos.activo = true;
  }

  let password: string | undefined;
  if (body.password !== undefined && body.password !== '') {
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 72) {
      throw new ErrorHttp(400, 'datos_invalidos', 'La contraseña debe tener entre 8 y 72 caracteres.');
    }
    password = body.password;
  } else if (creando) {
    throw new ErrorHttp(400, 'datos_invalidos', 'Falta la contraseña.');
  }
  return { datos, password };
}

function errorDeAuth(error: { message?: string; code?: string; status?: number }): never {
  if (error.code === 'email_exists' || /already been registered/i.test(error.message ?? '')) {
    throw new ErrorHttp(409, 'correo_duplicado', 'Ya existe una cuenta con ese correo.');
  }
  if (error.code === 'weak_password') {
    throw new ErrorHttp(400, 'datos_invalidos', 'La contraseña es demasiado débil.');
  }
  throw new ErrorHttp(500, 'error_auth', error.message ?? 'Error de Auth.');
}

function idValido(valor: unknown) {
  if (!Number.isSafeInteger(valor) || (valor as number) <= 0) {
    throw new ErrorHttp(400, 'datos_invalidos', 'Falta el id del usuario.');
  }
  return valor as number;
}

async function leerUsuario(id: number): Promise<Usuario> {
  const { data } = await admin.from('usuarios').select(COLUMNAS).eq('id', id).maybeSingle();
  if (!data) throw new ErrorHttp(404, 'no_existe', 'El usuario ya no existe.');
  return data as Usuario;
}

// ---- Reversiones y errores de BD -----------------------------------------------

// Borra una cuenta de Auth recién creada cuyo paso en la BD falló. Si el borrado también
// falla, la cuenta queda huérfana (sin fila en usuarios): se registra con su id para
// poder borrarla a mano (consulta en el README, "Cuentas huérfanas"). Una huérfana no
// puede usar la app: sin fila, iniciarSesion() la saca y es_coordinador() es false.
async function revertirCuenta(authId: string, motivo: string) {
  const { error } = await admin.auth.admin.deleteUser(authId);
  if (error) {
    console.error(`CUENTA HUÉRFANA auth_id=${authId}: no se pudo revertir (${motivo}): ${error.message}`);
  } else {
    console.warn(`Cuenta ${authId} revertida (${motivo}).`);
  }
}

// El detalle de Postgres va al log de la función, no al navegador.
function errorDeBd(contexto: string, error: { code?: string; message?: string }): never {
  console.error(`${contexto}: [${error.code}] ${error.message}`);
  if (error.code === '23505') throw new ErrorHttp(409, 'correo_duplicado', 'Ya existe un usuario con ese correo.');
  throw new ErrorHttp(500, 'error_bd', 'No se pudo guardar en la base de datos. Avisa al equipo.');
}

// ---- Acciones ------------------------------------------------------------------

async function crear(body: Record<string, unknown>) {
  const { datos, password } = validar(body, true);

  const { data: creado, error } = await admin.auth.admin.createUser({
    email: datos.correo as string,
    password,
    email_confirm: true,
    ban_duration: datos.activo ? 'none' : BLOQUEO,
  });
  if (error) errorDeAuth(error);

  const { data: fila, error: errorFila } = await admin
    .from('usuarios')
    .insert({ ...datos, auth_id: creado.user.id, creado_en: new Date().toISOString() })
    .select(COLUMNAS)
    .single();
  if (errorFila) {
    // Sin fila en usuarios la cuenta no sirve: se deshace para no dejar huérfanas.
    await revertirCuenta(creado.user.id, 'falló el insert en usuarios');
    errorDeBd('crear: insert en usuarios', errorFila);
  }
  return fila;
}

async function actualizar(body: Record<string, unknown>, quien: Usuario) {
  const id = idValido(body.id);
  const { datos, password } = validar(body, false);
  const actual = await leerUsuario(id);

  if (actual.id === quien.id) {
    if (datos.rol !== undefined && datos.rol !== actual.rol) {
      throw new ErrorHttp(403, 'propio_rol', 'No puedes cambiar tu propio rol.');
    }
    if (datos.activo === false) {
      throw new ErrorHttp(403, 'propio_rol', 'No puedes desactivar tu propia cuenta.');
    }
  }

  const cambiosAuth: Record<string, unknown> = {};
  if (datos.correo !== undefined && datos.correo !== actual.correo) {
    cambiosAuth.email = datos.correo;
    cambiosAuth.email_confirm = true;
  }
  if (password !== undefined) cambiosAuth.password = password;
  if (datos.activo !== undefined && datos.activo !== actual.activo) {
    cambiosAuth.ban_duration = datos.activo ? 'none' : BLOQUEO;
  }

  // Usuario que el script no pudo migrar: se le crea la cuenta ahora (requiere contraseña).
  let cuentaNueva: string | null = null;
  if (!actual.auth_id) {
    if (password === undefined) {
      throw new ErrorHttp(400, 'datos_invalidos', 'Este usuario aún no tiene cuenta: escribe una contraseña.');
    }
    const activo = (datos.activo ?? actual.activo) as boolean;
    const { data: creado, error } = await admin.auth.admin.createUser({
      email: (datos.correo ?? actual.correo) as string,
      password,
      email_confirm: true,
      ban_duration: activo ? 'none' : BLOQUEO,
    });
    if (error) errorDeAuth(error);
    cuentaNueva = creado.user.id;
    datos.auth_id = cuentaNueva;
  }

  // Primero la fila (falla rápido si el correo choca) y luego Auth; si Auth falla, la fila
  // se regresa a como estaba para que las dos no queden distintas.
  let fila: Usuario = actual;
  if (Object.keys(datos).length > 0) {
    const { data, error } = await admin.from('usuarios').update(datos).eq('id', id).select(COLUMNAS).single();
    if (error) {
      if (cuentaNueva) await revertirCuenta(cuentaNueva, 'falló el update en usuarios');
      errorDeBd('actualizar: update en usuarios', error);
    }
    fila = data as Usuario;
  }

  if (actual.auth_id && Object.keys(cambiosAuth).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(actual.auth_id, cambiosAuth);
    if (error) {
      const { nombre, correo, telefono, rol, activo } = actual;
      const { error: errorRevertir } = await admin
        .from('usuarios').update({ nombre, correo, telefono, rol, activo }).eq('id', id);
      if (errorRevertir) {
        console.error(`DESINCRONIZADO usuario ${id}: Auth rechazó el cambio y la fila no se pudo regresar: ${errorRevertir.message}`);
      }
      errorDeAuth(error);
    }
  }
  return fila;
}

async function eliminar(body: Record<string, unknown>, quien: Usuario) {
  const id = idValido(body.id);
  if (id === quien.id) throw new ErrorHttp(403, 'propio_rol', 'No puedes eliminar tu propia cuenta.');
  const actual = await leerUsuario(id);

  const { error } = await admin.from('usuarios').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new ErrorHttp(409, 'tiene_historial',
        'No se puede eliminar: tiene patrullajes o liberaciones registrados. Desactívalo en su lugar.');
    }
    errorDeBd('eliminar: delete en usuarios', error);
  }
  if (actual.auth_id) await revertirCuenta(actual.auth_id, `se eliminó el usuario ${id}`);
  return actual;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    // Preflight: 204 con las cabeceras CORS solo si el origen está permitido.
    // Sin Access-Control-Allow-Origin el navegador cancela la llamada real.
    return new Response(null, { status: 204, headers: cabecerasCors(req) });
  }
  if (req.method !== 'POST') return responder(req, 405, { error: 'Método no permitido.', codigo: 'metodo' });

  try {
    const quien = await coordinadorQueLlama(req);
    const body = await req.json().catch(() => {
      throw new ErrorHttp(400, 'datos_invalidos', 'El cuerpo debe ser JSON.');
    });
    if (typeof body !== 'object' || body === null) throw new ErrorHttp(400, 'datos_invalidos', 'El cuerpo debe ser un objeto JSON.');

    switch (body.accion) {
      case 'crear':
        return responder(req, 200, { usuario: await crear(body) });
      case 'actualizar':
        return responder(req, 200, { usuario: await actualizar(body, quien) });
      case 'eliminar':
        return responder(req, 200, { usuario: await eliminar(body, quien) });
      default:
        throw new ErrorHttp(400, 'accion_invalida', 'Acción no válida.');
    }
  } catch (error) {
    if (error instanceof ErrorHttp) return responder(req, error.estado, { error: error.message, codigo: error.codigo });
    console.error(error);
    return responder(req, 500, { error: 'Error inesperado.', codigo: 'interno' });
  }
});
