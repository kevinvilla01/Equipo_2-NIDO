// Sesión con Supabase Auth.
//
// - supabase-js guarda el JWT y el refresh token en localStorage y los manda en cada
//   petición; RLS y las RPC identifican al usuario con auth.uid().
// - El perfil (id, nombre, correo, rol de public.usuarios) se guarda aparte en
//   'nido_usuario' para que la app funcione sin señal (rol para la UI, id para
//   responsable_id). Es solo para mostrar: el servidor nunca confía en él.
// - Nada de aquí borra IndexedDB: lo capturado sin señal sobrevive a un cierre de sesión
//   o a una sesión vencida y se envía después de volver a entrar.
import { supabase } from '/js/supabase.js';

const CLAVE_PERFIL = 'nido_usuario';
// Se refresca el JWT si le queda menos de esto, para que no venza a mitad de un envío.
const MARGEN_MS = 60_000;
const PANTALLA_INICIO = '/patrullajes.html';

export class ErrorSesion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo; // 'red' | 'credenciales' | 'inactivo' | 'rechazada'
  }
}

export function leerPerfil() {
  try {
    const perfil = JSON.parse(localStorage.getItem(CLAVE_PERFIL));
    return perfil && perfil.id != null && perfil.rol ? perfil : null;
  } catch {
    return null;
  }
}

function guardarPerfil({ id, nombre, correo, rol }) {
  localStorage.setItem(CLAVE_PERFIL, JSON.stringify({ id, nombre, correo, rol }));
}

function borrarPerfil() {
  localStorage.removeItem(CLAVE_PERFIL);
}

export function esCoordinador() {
  return leerPerfil()?.rol === 'coordinador';
}

// Falla de red (sin señal, timeout, 5xx) frente a un "no" de Auth (token revocado,
// usuario bloqueado). Solo lo segundo obliga a volver a iniciar sesión.
export function esErrorDeRed(error) {
  if (!navigator.onLine) return true;
  if (!error) return false;
  return error.name === 'AuthRetryableFetchError'
    || error.name === 'TypeError' // fetch sin red
    || error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || (typeof error.status === 'number' && (error.status === 0 || error.status >= 500));
}

// ?volver=… solo acepta rutas propias (evita redirigir a otro sitio).
export function rutaDeRegreso() {
  const volver = new URLSearchParams(location.search).get('volver');
  if (!volver || !volver.startsWith('/') || volver.startsWith('//') || volver.startsWith('/\\')) {
    return PANTALLA_INICIO;
  }
  if (volver === '/' || volver.startsWith('/index.html')) return PANTALLA_INICIO;
  return volver;
}

export function irAlLogin() {
  const volver = location.pathname + location.search;
  location.replace(`/index.html?volver=${encodeURIComponent(volver)}`);
}

export async function iniciarSesion(correo, contrasena) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: correo, password: contrasena });
  if (error) {
    if (esErrorDeRed(error)) {
      throw new ErrorSesion('red', 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
    }
    if (error.code === 'user_banned') {
      throw new ErrorSesion('inactivo', 'Tu cuenta está desactivada. Habla con el coordinador.');
    }
    throw new ErrorSesion('credenciales', 'Correo o contraseña incorrectos.');
  }

  const { data: perfil, error: errorPerfil } = await supabase
    .from('usuarios')
    .select('id, nombre, correo, rol, activo')
    .eq('auth_id', data.user.id)
    .maybeSingle();

  if (errorPerfil || !perfil || !perfil.activo) {
    await supabase.auth.signOut({ scope: 'local' });
    if (errorPerfil) {
      throw new ErrorSesion('red', 'No se pudo cargar tu perfil. Intenta de nuevo.');
    }
    throw new ErrorSesion('inactivo', 'Tu cuenta no está activa en NIDO. Habla con el coordinador.');
  }

  guardarPerfil(perfil);
  return perfil;
}

export async function cerrarSesion() {
  // scope 'local': solo este teléfono; con señal también revoca el refresh token.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  borrarPerfil();
  location.replace('/index.html');
}

// Deja el JWT vigente antes de hablar con el servidor.
// Devuelve 'vigente' | 'sin_red' | 'rechazada'. Varias llamadas a la vez comparten
// el mismo refresh (dos refresh simultáneos gastarían el mismo refresh token).
let enCurso = null;

export function asegurarSesion() {
  enCurso ??= revisarSesion().finally(() => { enCurso = null; });
  return enCurso;
}

async function revisarSesion() {
  if (!navigator.onLine) return 'sin_red';

  const { data, error } = await supabase.auth.getSession();
  const sesion = data?.session;
  if (sesion && sesion.expires_at * 1000 - Date.now() > MARGEN_MS) return 'vigente';
  if (!sesion && esErrorDeRed(error)) return 'sin_red';

  const { data: refrescada, error: errorRefresh } = await supabase.auth.refreshSession();
  if (refrescada?.session) return 'vigente';
  if (esErrorDeRed(errorRefresh)) return 'sin_red';
  return 'rechazada';
}

// Para cualquier envío al servidor (RPC, cola offline, Edge Function).
// Sin señal: lanza ErrorSesion('red') y lo pendiente se queda para el próximo intento.
// Sesión rechazada: manda al login SIN borrar lo pendiente en IndexedDB.
export async function conSesionVigente(accion) {
  const estado = await asegurarSesion();
  if (estado === 'sin_red') {
    throw new ErrorSesion('red', 'Sin conexión. Se enviará cuando vuelva la señal.');
  }
  if (estado === 'rechazada') {
    borrarPerfil();
    irAlLogin();
    throw new ErrorSesion('rechazada', 'Tu sesión venció. Vuelve a iniciar sesión.');
  }
  return accion();
}

// Guarda de cada pantalla. acceso: 'publico' | 'sesion' | 'coordinador'.
// Sin señal basta el perfil local (el trabajo de campo sigue); con señal se valida
// la sesión y se relee el perfil por si cambió el rol o lo desactivaron.
export async function protegerPagina(acceso) {
  if (acceso === 'publico') return leerPerfil();

  const perfil = leerPerfil();
  if (!perfil) {
    irAlLogin();
    return null;
  }
  if (acceso === 'coordinador' && perfil.rol !== 'coordinador') {
    location.replace(PANTALLA_INICIO);
    return null;
  }

  const estado = await asegurarSesion();
  if (estado === 'rechazada') {
    borrarPerfil();
    irAlLogin();
    return null;
  }
  if (estado === 'vigente') {
    // Por auth_id de la sesión, no por el id local (localStorage se puede editar).
    const { data: { session } } = await supabase.auth.getSession();
    const { data: actual, error } = await supabase
      .from('usuarios')
      .select('id, nombre, correo, rol, activo')
      .eq('auth_id', session.user.id)
      .maybeSingle();
    if (!error && (!actual || !actual.activo)) {
      await cerrarSesion();
      return null;
    }
    if (actual) {
      guardarPerfil(actual);
      if (acceso === 'coordinador' && actual.rol !== 'coordinador') {
        location.replace(PANTALLA_INICIO);
        return null;
      }
    }
  }
  return leerPerfil();
}
