// Sincronización de nidos activos (HU-13). Al tener cobertura baja los catálogos y los
// nidos activos del campamento (vista nidos_activos; la RLS decide cuáles) y los deja
// en IndexedDB para consultarlos en el corral sin señal.
import { supabase } from '/js/supabase.js';
import { asegurarSesion } from '/js/sesion.js';
import { descargarCatalogos } from '/js/catalogos.js';
import { aplicarSincronizacionNidos, listarNidos } from '/js/db.js';
import { fusionarNidosDelServidor } from '/js/nidos-activos.js';

const CLAVE_ULTIMA = 'nido_sync_nidos';
// Con señal débil la consulta se queda colgada; se corta y se sigue con lo local.
const TIMEOUT_MS = 8000;
// Al abrir pantallas seguidas no se vuelve a bajar todo cada vez.
const INTERVALO_MIN_MS = 2 * 60_000;

export function ultimaSincronizacion() {
  return localStorage.getItem(CLAVE_ULTIMA);
}

async function descargarNidosActivos() {
  const consulta = supabase
    .from('nidos_activos')
    .select('*', { count: 'exact' })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  const limite = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Tiempo agotado al descargar los nidos activos')), TIMEOUT_MS);
  });
  const { data, error, count } = await Promise.race([consulta, limite]);
  if (error) throw error;
  // PostgREST corta en max-rows: si faltan filas no se borra nada local.
  return { remotos: data ?? [], completo: count == null || (data ?? []).length >= count };
}

async function sincronizar() {
  if (await asegurarSesion() !== 'vigente') return { estado: 'sin_red' };

  await descargarCatalogos();
  const { remotos, completo } = await descargarNidosActivos();
  const ahora = new Date().toISOString();
  const cambios = fusionarNidosDelServidor(await listarNidos(), remotos, { completo, ahora });
  await aplicarSincronizacionNidos(cambios);
  localStorage.setItem(CLAVE_ULTIMA, ahora);

  const resumen = { estado: 'ok', recibidos: remotos.length, guardados: cambios.guardar.length, borrados: cambios.borrar.length };
  window.dispatchEvent(new CustomEvent('nido:nidos-sincronizados', { detail: resumen }));
  return resumen;
}

// Varias llamadas a la vez (carga, 'online', sesión renovada) comparten la misma.
// forzar: ignora el intervalo mínimo (al volver la señal o con el botón de la pantalla).
let enCurso = null;

export function sincronizarNidosActivos({ forzar = false } = {}) {
  const ultima = Date.parse(ultimaSincronizacion() ?? '');
  if (!forzar && !enCurso && Number.isFinite(ultima) && Date.now() - ultima < INTERVALO_MIN_MS) {
    return Promise.resolve({ estado: 'reciente' });
  }
  enCurso ??= sincronizar()
    .catch((err) => {
      console.warn('No se pudieron sincronizar los nidos activos:', err);
      window.dispatchEvent(new CustomEvent('nido:nidos-sincronizados', { detail: { estado: 'error' } }));
      return { estado: 'error' };
    })
    .finally(() => { enCurso = null; });
  return enCurso;
}
