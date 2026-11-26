// Cola de pérdidas de nidos (HU-12). El coordinador marca el nido como perdido aunque no
// haya señal: queda en IndexedDB ('perdidas_pendientes') y se envía con la RPC
// marcar_nido_perdido cuando hay sesión vigente. Contrato de la RPC en el README.
import { supabase } from '/js/supabase.js';
import { asegurarSesion } from '/js/sesion.js';
import { actualizarNido, listarPerdidasPendientes, obtenerNido, quitarPerdidaPendiente } from '/js/db.js';

// El servidor recibió la petición y dijo que no: reintentar no lo arregla.
// NE001 (el nido aún no está en el servidor) no va aquí: se reintenta cuando HU-16 lo suba.
const RECHAZOS = new Set(['NE002', 'NE003', 'NE004', 'NE005', 'NE006', '22P02']);

async function actualizarLocal(clave, cambios) {
  const nido = await obtenerNido(clave);
  if (nido) await actualizarNido({ ...nido, ...cambios });
}

async function enviarUna(perdida) {
  const { error } = await supabase.rpc('marcar_nido_perdido', {
    p_clave: perdida.clave,
    p_causa: perdida.causa,
    p_fecha_perdida: perdida.fecha_perdida,
  });
  if (!error) {
    await quitarPerdidaPendiente(perdida.clave);
    await actualizarLocal(perdida.clave, { perdida_pendiente: false, conflicto: null });
    return 'enviada';
  }
  if (RECHAZOS.has(error.code)) {
    // Se saca de la cola y se marca en el nido para que alguien lo resuelva.
    await quitarPerdidaPendiente(perdida.clave);
    await actualizarLocal(perdida.clave, {
      perdida_pendiente: false,
      conflicto: { codigo: error.code, mensaje: error.message, en: new Date().toISOString() },
    });
    return 'conflicto';
  }
  // Red, 5xx, JWT vencido o NE001: sigue pendiente para el siguiente intento.
  console.warn(`Pérdida del nido ${perdida.clave} sigue pendiente:`, error.code || error.message);
  return 'pendiente';
}

async function enviar() {
  const pendientes = await listarPerdidasPendientes();
  const resumen = { enviadas: 0, conflictos: 0, pendientes: pendientes.length };
  if (pendientes.length === 0) return resumen;
  // Sin red o con la sesión rechazada no se intenta: lo pendiente se queda en IndexedDB.
  if (await asegurarSesion() !== 'vigente') return resumen;

  // En orden de captura, una a una: así un fallo no deja a medias las demás.
  pendientes.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  for (const perdida of pendientes) {
    const resultado = await enviarUna(perdida);
    if (resultado === 'enviada') resumen.enviadas += 1;
    if (resultado === 'conflicto') resumen.conflictos += 1;
  }
  resumen.pendientes -= resumen.enviadas + resumen.conflictos;
  window.dispatchEvent(new CustomEvent('nido:perdidas-actualizadas', { detail: resumen }));
  return resumen;
}

// Varias llamadas a la vez (carga de la pantalla, 'online', sesión renovada) comparten
// el mismo envío para no mandar dos veces la misma pérdida.
let enCurso = null;

export function enviarPerdidasPendientes() {
  enCurso ??= enviar().finally(() => { enCurso = null; });
  return enCurso;
}
