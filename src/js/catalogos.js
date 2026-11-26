// Catálogos (tramos, especies, campamentos y el directorio de voluntarios): se descargan
// de Supabase con señal y se guarda copia en IndexedDB para usarlos sin red (HU-13).
// Va con el cliente de Supabase para que lleve el JWT del usuario: RLS ya no deja leer a anon.
import { guardarCatalogo, leerCatalogo } from '/js/db.js';
import { supabase } from '/js/supabase.js';

// Columna que se muestra al usuario en cada catálogo.
export const CAMPO_NOMBRE = {
  tramos: 'nombre',
  especies: 'nombre_comun',
  campamentos: 'nombre',
  // Vista id, nombre, activo: un voluntario no puede leer las filas de otros en usuarios.
  directorio_usuarios: 'nombre',
};

// Con señal débil la petición (y el refresh del JWT que puede ir antes) se queda
// colgada; se corta todo y se usa la copia local.
const TIMEOUT_MS = 5000;

async function descargar(tabla) {
  if (!navigator.onLine) return null;
  try {
    const consulta = supabase.from(tabla).select('*').abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    const limite = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Tiempo agotado al descargar ${tabla}`)), TIMEOUT_MS);
    });
    const { data: registros, error } = await Promise.race([consulta, limite]);
    if (error) throw error;
    await guardarCatalogo(tabla, registros);
    return registros;
  } catch (err) {
    console.warn(`No se pudo descargar ${tabla}, se usa la copia local:`, err);
    return null;
  }
}

export async function cargarCatalogo(tabla) {
  return (await descargar(tabla)) ?? leerCatalogo(tabla);
}

export function descargarCatalogos() {
  return Promise.all(Object.keys(CAMPO_NOMBRE).map(descargar));
}
