// Tramos y especies: se descargan de Supabase con señal y se guarda copia en IndexedDB.
import { guardarCatalogo, leerCatalogo } from '/js/db.js';

// Columna que se muestra al usuario en cada catálogo.
export const CAMPO_NOMBRE = { tramos: 'nombre', especies: 'nombre_comun' };

// Con señal débil el fetch puede quedarse colgado; se corta y se usa la copia local.
const TIMEOUT_MS = 5000;

async function descargar(tabla) {
  const config = window.NIDO_CONFIG || {};
  if (!navigator.onLine || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${config.SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
      headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${config.SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const registros = await res.json();
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
