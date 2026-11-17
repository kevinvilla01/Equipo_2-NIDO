// Crea una cuenta de Supabase Auth por cada fila de public.usuarios y llena usuarios.auth_id.
//
// Se corre UNA vez, en local, entre la migración auth_1 y la auth_2:
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=...        \
//   node scripts/migrar-cuentas-auth.mjs --dry-run   # solo muestra lo que haría
//   node scripts/migrar-cuentas-auth.mjs             # lo hace
//
// La service_role se salta la RLS: nunca la pongas en el repo, en .env.local ni en Vercel.
//
// - Cada cuenta conserva su correo y su contraseña actual (email ya confirmado), así que
//   nadie tiene que cambiar nada para entrar.
// - Si la contraseña actual no la acepta Auth (vacía o < 6 caracteres), se crea con una
//   aleatoria que no se muestra; el coordinador le pone una nueva desde "Editar voluntario".
// - Usuarios inactivos: la cuenta se crea bloqueada (ban), para que no puedan entrar.
// - Idempotente: si el usuario ya tiene auth_id, o ya existe una cuenta con ese correo,
//   no crea otra; solo liga y ajusta el bloqueo.
import { randomBytes } from 'node:crypto';

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SIMULACION = process.argv.includes('--dry-run');
const BLOQUEO = '876000h'; // ~100 años: así "banea" Auth hasta que se reactive.

if (!URL_BASE || !CLAVE) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const cabeceras = {
  apikey: CLAVE,
  Authorization: `Bearer ${CLAVE}`,
  'Content-Type': 'application/json',
};

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${URL_BASE}${ruta}`, {
    method: metodo,
    headers: { ...cabeceras, Prefer: 'return=representation' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!respuesta.ok) {
    const error = new Error(`${metodo} ${ruta} → ${respuesta.status}: ${datos?.msg ?? datos?.message ?? texto}`);
    error.estado = respuesta.status;
    error.codigo = datos?.error_code ?? datos?.code;
    throw error;
  }
  return datos;
}

// Cuentas de Auth existentes, por correo en minúsculas.
async function cuentasExistentes() {
  const porCorreo = new Map();
  for (let pagina = 1; ; pagina += 1) {
    const { users } = await pedir('GET', `/auth/v1/admin/users?page=${pagina}&per_page=1000`);
    for (const cuenta of users) if (cuenta.email) porCorreo.set(cuenta.email.toLowerCase(), cuenta);
    if (users.length < 1000) return porCorreo;
  }
}

function contrasenaValida(contrasena) {
  return typeof contrasena === 'string' && contrasena.length >= 6;
}

const usuarios = await pedir('GET', '/rest/v1/usuarios?select=id,correo,password,activo,auth_id&order=id');
const existentes = await cuentasExistentes();
const resumen = { creadas: 0, ligadas: 0, sinCambios: 0, contrasenaNueva: [], errores: [] };

console.log(`${usuarios.length} usuarios en public.usuarios${SIMULACION ? ' (simulación, no se cambia nada)' : ''}.\n`);

for (const usuario of usuarios) {
  const etiqueta = `#${usuario.id} ${usuario.correo ?? '(sin correo)'}`;
  try {
    const correo = usuario.correo?.trim().toLowerCase();
    if (!correo) throw new Error('no tiene correo');

    let cuenta = usuario.auth_id ? { id: usuario.auth_id } : existentes.get(correo);
    const bloqueo = usuario.activo ? 'none' : BLOQUEO;

    if (!cuenta) {
      const usaActual = contrasenaValida(usuario.password);
      if (!usaActual) resumen.contrasenaNueva.push(etiqueta);
      console.log(`${etiqueta}: crear cuenta${usuario.activo ? '' : ' bloqueada'}${usaActual ? '' : ' con contraseña aleatoria'}`);
      if (!SIMULACION) {
        cuenta = await pedir('POST', '/auth/v1/admin/users', {
          email: correo,
          password: usaActual ? usuario.password : randomBytes(24).toString('base64url'),
          email_confirm: true,
          ban_duration: bloqueo,
        });
      }
      resumen.creadas += 1;
    } else {
      console.log(`${etiqueta}: ya tiene cuenta, ajustar bloqueo (${usuario.activo ? 'activo' : 'bloqueado'})`);
      if (!SIMULACION) await pedir('PUT', `/auth/v1/admin/users/${cuenta.id}`, { ban_duration: bloqueo });
    }

    if (usuario.auth_id) {
      resumen.sinCambios += 1;
    } else {
      if (!SIMULACION) {
        await pedir('PATCH', `/rest/v1/usuarios?id=eq.${encodeURIComponent(usuario.id)}`, { auth_id: cuenta.id });
      }
      resumen.ligadas += 1;
    }
  } catch (error) {
    console.error(`${etiqueta}: ERROR ${error.message}`);
    resumen.errores.push(etiqueta);
  }
}

console.log(`
Cuentas creadas: ${resumen.creadas}
Usuarios ligados (auth_id): ${resumen.ligadas}
Ya estaban ligados: ${resumen.sinCambios}`);
if (resumen.contrasenaNueva.length > 0) {
  console.log(`Necesitan contraseña nueva (ponla en "Editar voluntario"): ${resumen.contrasenaNueva.join(', ')}`);
}
if (resumen.errores.length > 0) {
  console.log(`Con error (vuelve a correr el script cuando los corrijas): ${resumen.errores.join(', ')}`);
  process.exit(1);
}
