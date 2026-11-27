// "Enviar pendientes" (HU-16): lee del teléfono lo que falta enviar, lo manda con las RPCs
// idempotentes de supabase/migrations/20261128000000_hu16_envio_pendientes.sql en orden
// patrullajes → nidos → liberaciones, y después las pérdidas (cola-perdidas.js, HU-12).
import { supabase } from '/js/supabase.js';
import { asegurarSesion, esCoordinador } from '/js/sesion.js';
import { enviarPerdidasPendientes } from '/js/cola-perdidas.js';
import {
  actualizarCampos, contarPerdidasPendientes, listarLiberacionesLocales, listarNidos, listarPatrullajesLocales,
} from '/js/db.js';
import { estaPendiente, procesarCola } from '/js/cola-envio.js';

async function rpc(nombre, parametros) {
  const { data, error } = await supabase.rpc(nombre, parametros);
  if (error) throw error;
  return data;
}

const ENVIAR = {
  patrullajes: (p) => rpc('registrar_patrullaje', {
    p_client_id: p.client_id,
    p_fecha: p.fecha,
    p_hora_inicio: p.hora_inicio,
    p_tramo_id: p.tramo_id,
    p_voluntarios: p.voluntarios,
  }),
  nidos: async (n) => {
    const fila = await rpc('registrar_nido', {
      p_clave: n.clave,
      p_tramo_id: n.tramo_id,
      p_especie_id: n.especie_id,
      p_referencia_ubicacion: n.referencia_ubicacion,
      p_fecha_hallazgo: n.fecha_hallazgo,
      p_creado_en: n.creado_en ?? null,
      p_patrullaje_client_id: n.patrullaje_client_id ?? null,
    });
    // Un nido reubicado sin señal (HU-10) se sube como registrado; sin esto, al quitarle
    // el pendiente la sincronización de HU-13 le regresaría el estado del servidor y se
    // perdería la reubicación. reubicar_nido es idempotente.
    if (n.estado !== 'en_corral' && n.estado !== 'eclosionado') return fila;
    let reubicado;
    try {
      reubicado = await rpc('reubicar_nido', {
        p_clave: n.clave, p_corral: n.corral, p_huevos: n.huevos_contados, p_fecha_reubicacion: n.fecha_reubicacion,
      });
    } catch (error) {
      // Reenvío de un nido que en el servidor ya pasó de corral (HU-11): reubicar_nido
      // responde NE002 y registrar_eclosion decide si es el mismo dato o un conflicto.
      if (!(n.estado === 'eclosionado' && fila?.estado === 'eclosionado' && error?.code === 'NE002')) throw error;
    }
    if (n.estado === 'en_corral') return reubicado;
    // HU-11: la eclosión va después de la reubicación (solo se llega desde en_corral).
    return rpc('registrar_eclosion', {
      p_clave: n.clave,
      p_crias_vivas: n.crias_vivas,
      p_crias_muertas: n.crias_muertas,
      p_fecha_eclosion: n.fecha_eclosion,
    });
  },
  liberaciones: (l) => rpc('registrar_liberacion', {
    p_client_id: l.client_id,
    p_nido_clave: l.nido_clave,
    p_cantidad_liberada: l.cantidad_liberada,
    p_fecha: l.fecha,
    p_hora: l.hora,
    p_sitio: l.sitio ?? null,
    p_creado_en: l.creado_en ?? null,
  }),
};

const LLAVE = { patrullajes: 'client_id', nidos: 'clave', liberaciones: 'client_id' };

async function leerCola() {
  const [patrullajes, nidos, liberaciones] = await Promise.all([
    listarPatrullajesLocales(), listarNidos(), listarLiberacionesLocales(),
  ]);
  return {
    patrullajes: patrullajes.filter((r) => estaPendiente('patrullajes', r)),
    nidos: nidos.filter((r) => estaPendiente('nidos', r)),
    liberaciones: liberaciones.filter((r) => estaPendiente('liberaciones', r)),
  };
}

export async function contarPendientes() {
  // Las pérdidas solo las envía un coordinador (NE006 para los demás), así que solo cuentan con él.
  const [cola, perdidas] = await Promise.all([leerCola(), esCoordinador() ? contarPerdidasPendientes() : 0]);
  return cola.patrullajes.length + cola.nidos.length + cola.liberaciones.length + perdidas;
}

// Avisa a la barra (app.js) que cambió el número de pendientes.
export async function avisarPendientes() {
  const total = await contarPendientes();
  window.dispatchEvent(new CustomEvent('nido:pendientes', { detail: { total } }));
  return total;
}

async function enviar() {
  if (await asegurarSesion() !== 'vigente') {
    return { estado: 'sin_red', enviados: 0, fallidos: 0, en_espera: 0, errores: [] };
  }
  const resumen = await procesarCola(await leerCola(), {
    enviar: (tipo, registro) => ENVIAR[tipo](registro),
    guardar: (tipo, registro, cambios) => actualizarCampos(tipo, registro[LLAVE[tipo]], cambios),
  });
  // Las pérdidas van al final: su nido tiene que existir ya en el servidor.
  if (esCoordinador()) await enviarPerdidasPendientes().catch((err) => console.warn('No se pudieron enviar las pérdidas pendientes:', err));
  return { estado: 'ok', ...resumen };
}

// Una sola corrida a la vez en la pestaña (doble clic, botón + evento 'online'):
// las llamadas mientras corre comparten la misma promesa.
let enCurso = null;

export function enviarPendientes() {
  enCurso ??= enviar()
    .finally(async () => {
      enCurso = null;
      await avisarPendientes().catch(() => {});
    });
  return enCurso;
}

export function enviando() {
  return enCurso !== null;
}
