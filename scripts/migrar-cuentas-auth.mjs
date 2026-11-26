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
// - Si la contraseña actual no sirve (vacía, no es texto o < 6 caracteres, el mínimo de
//   Auth), el --dry-run dice el motivo sin mostrarla y la cuenta se crearía con una
//   aleatoria que no se muestra.
// - --password-para <id> (se puede repetir): pide la contraseña de ese usuario con un
//   prompt oculto (dos veces, mínimo 8 caracteres) y la usa en lugar de la actual.
//   Si la cuenta ya existe, se la cambia. Así el primer coordinador puede entrar.
//   Necesita una terminal interactiva: córrelo en tu terminal, no con `!` en Claude Code.
//     node scripts/migrar-cuentas-auth.mjs --password-para 1
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

// Motivo por el que la contraseña actual no sirve, sin revelarla. null = sirve.
// Si la columna es numérica (p. ej. 123456) se usa como texto.
function motivoContrasenaInvalida(contrasena) {
  if (contrasena === null || contrasena === undefined) return 'la columna password está vacía (null)';
  if (typeof contrasena === 'number') contrasena = String(contrasena);
  if (typeof contrasena !== 'string') return `la columna password no es texto (es ${typeof contrasena})`;
  if (contrasena.trim() === '') return 'la contraseña está en blanco';
  if (contrasena.length < 6) return 'tiene menos de 6 caracteres (mínimo de Supabase Auth)';
  if (contrasena.length > 72) return 'tiene más de 72 caracteres (máximo de Supabase Auth)';
  return null;
}

// Lee una línea sin mostrarla en pantalla (ni asteriscos).
function leerOculto(pregunta) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('--password-para necesita una terminal interactiva.'));
  }
  return new Promise((resolve) => {
    let valor = '';
    const terminar = () => {
      stdin.off('data', alTeclear);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const alTeclear = (texto) => {
      for (const caracter of texto) {
        if (caracter === '\r' || caracter === '\n') {
          terminar();
          resolve(valor);
          return;
        }
        if (caracter === '\u0003') { // Ctrl+C
          terminar();
          process.exit(130);
        }
        if (caracter === '\u007f' || caracter === '\b') valor = valor.slice(0, -1);
        else if (caracter >= ' ') valor += caracter;
      }
    };
    stdout.write(pregunta);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', alTeclear);
  });
}

async function pedirContrasena(etiqueta) {
  for (;;) {
    const primera = await leerOculto(`Contraseña nueva para ${etiqueta} (no se ve al escribir): `);
    if (primera.length < 8 || primera.length > 72) {
      console.log('Debe tener entre 8 y 72 caracteres. Intenta de nuevo.');
      continue;
    }
    const segunda = await leerOculto('Repítela: ');
    if (primera === segunda) return primera;
    console.log('No coinciden. Intenta de nuevo.');
  }
}

// Opciones: --dry-run y --password-para <id> (repetible). Cualquier otra cosa es error:
// un typo como --dryrun no debe correr el script de verdad.
const USO = 'Uso: node scripts/migrar-cuentas-auth.mjs [--dry-run] [--password-para <id>]...';
const idsConContrasena = new Set();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--dry-run') continue;
  if (arg === '--password-para') {
    const id = process.argv[i + 1];
    if (!/^\d+$/.test(id ?? '')) {
      console.error(`--password-para necesita un id numérico de public.usuarios.\n${USO}`);
      process.exit(1);
    }
    idsConContrasena.add(Number(id));
    i += 1;
    continue;
  }
  console.error(`Opción desconocida: ${arg}\n${USO}`);
  process.exit(1);
}

const usuarios = await pedir('GET', '/rest/v1/usuarios?select=id,correo,password,activo,auth_id&order=id');
const existentes = await cuentasExistentes();
const resumen = { creadas: 0, ligadas: 0, sinCambios: 0, contrasenaNueva: [], errores: [] };

const idsInexistentes = [...idsConContrasena].filter((id) => !usuarios.some((u) => u.id === id));
if (idsInexistentes.length > 0) {
  console.error(`--password-para: no existen los usuarios ${idsInexistentes.join(', ')}.`);
  process.exit(1);
}

// Las contraseñas manuales se piden todas antes de tocar nada.
const contrasenasManuales = new Map();
if (!SIMULACION) {
  for (const usuario of usuarios) {
    if (idsConContrasena.has(usuario.id)) {
      try {
        contrasenasManuales.set(usuario.id, await pedirContrasena(`#${usuario.id} ${usuario.correo}`));
      } catch (error) {
        console.error(`${error.message} Córrelo en tu terminal, no con \`!\` ni con la entrada redirigida.`);
        process.exit(1);
      }
    }
  }
}

console.log(`${usuarios.length} usuarios en public.usuarios${SIMULACION ? ' (simulación, no se cambia nada)' : ''}.\n`);

for (const usuario of usuarios) {
  const etiqueta = `#${usuario.id} ${usuario.correo ?? '(sin correo)'}`;
  try {
    const correo = usuario.correo?.trim().toLowerCase();
    if (!correo) throw new Error('no tiene correo');

    let cuenta = usuario.auth_id ? { id: usuario.auth_id } : existentes.get(correo);
    const bloqueo = usuario.activo ? 'none' : BLOQUEO;

    const manual = idsConContrasena.has(usuario.id);
    const motivo = manual ? null : motivoContrasenaInvalida(usuario.password);

    if (!cuenta) {
      let origen;
      let contrasena;
      if (manual) {
        origen = 'con la contraseña que escribiste';
        contrasena = contrasenasManuales.get(usuario.id);
      } else if (motivo === null) {
        origen = 'con su contraseña actual';
        contrasena = String(usuario.password);
      } else {
        origen = `con contraseña aleatoria porque la actual no sirve: ${motivo}`;
        contrasena = randomBytes(24).toString('base64url');
        resumen.contrasenaNueva.push(etiqueta);
      }
      console.log(`${etiqueta}: crear cuenta${usuario.activo ? '' : ' bloqueada'} ${origen}`);
      if (!SIMULACION) {
        cuenta = await pedir('POST', '/auth/v1/admin/users', {
          email: correo,
          password: contrasena,
          email_confirm: true,
          ban_duration: bloqueo,
        });
      }
      resumen.creadas += 1;
    } else {
      const cambios = { ban_duration: bloqueo };
      if (manual && !SIMULACION) cambios.password = contrasenasManuales.get(usuario.id);
      console.log(`${etiqueta}: ya tiene cuenta, ajustar bloqueo (${usuario.activo ? 'activo' : 'bloqueado'})${manual ? ' y cambiar la contraseña' : ''}`);
      if (!SIMULACION) await pedir('PUT', `/auth/v1/admin/users/${cuenta.id}`, cambios);
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
  console.log(`Necesitan contraseña nueva: ${resumen.contrasenaNueva.join(', ')}
  Corre el script con --password-para <id> para ponérsela tú, o pónsela después
  desde "Editar voluntario" con una sesión de coordinador.`);
}
if (resumen.errores.length > 0) {
  console.log(`Con error (vuelve a correr el script cuando los corrijas): ${resumen.errores.join(', ')}`);
  process.exit(1);
}
