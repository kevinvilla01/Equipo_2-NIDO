// Máquina de estados del nido. Espejo de nidos_validar_transicion() en
// supabase/migrations/20261110000000_hu10_reubicar_nido.sql: si cambias una, cambia la otra.
// Módulo puro (sin DOM ni IndexedDB) para poder probarlo con `node --test`.

export const ESTADOS = Object.freeze({
  REGISTRADO: 'registrado',
  EN_CORRAL: 'en_corral',
  ECLOSIONADO: 'eclosionado',
  PERDIDO: 'perdido',
});

export const ETIQUETA_ESTADO = Object.freeze({
  registrado: 'Registrado',
  en_corral: 'En corral',
  eclosionado: 'Eclosionado',
  perdido: 'Perdido',
});

// Estado actual → estados a los que puede pasar. eclosionado y perdido son finales.
export const TRANSICIONES = Object.freeze({
  registrado: Object.freeze(['en_corral', 'perdido']),
  en_corral: Object.freeze(['eclosionado', 'perdido']),
  eclosionado: Object.freeze([]),
  perdido: Object.freeze([]),
});

export function puedeTransicionar(desde, hacia) {
  return Object.hasOwn(TRANSICIONES, desde) && TRANSICIONES[desde].includes(hacia);
}

// Acepta el valor tal cual llega del <input> (texto) o ya como número.
function aEnteroPositivo(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor > 0 ? valor : null;
  if (typeof valor !== 'string' || !/^\s*\d+\s*$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

// Valida los datos de la reubicación al corral. Devuelve los valores normalizados
// o los errores por campo, con el mensaje que se muestra al usuario.
export function validarReubicacion({ corral, huevos }) {
  const errores = {};
  const clave = typeof corral === 'string' ? corral.trim() : '';
  if (clave === '') errores.corral = 'Escribe la clave del corral.';
  const totalHuevos = aEnteroPositivo(huevos);
  if (totalHuevos === null) errores.huevos = 'Escribe el número de huevos (entero mayor que 0).';
  if (Object.keys(errores).length > 0) return { valido: false, errores };
  return { valido: true, datos: { corral: clave, huevos: totalHuevos } };
}

// Valida la transición y los datos juntos: es lo que se revisa antes de guardar.
export function validarPasoACorral(nido, datos) {
  if (!puedeTransicionar(nido.estado, ESTADOS.EN_CORRAL)) {
    const actual = ETIQUETA_ESTADO[nido.estado] ?? nido.estado;
    return {
      valido: false,
      errores: { estado: `Solo se puede reubicar un nido registrado; este está "${actual}".` },
    };
  }
  return validarReubicacion(datos);
}

// Fecha 'YYYY-MM-DD' + días. Se calcula en UTC para que el cambio de horario no
// mueva el resultado un día. Devuelve null si la fecha o los días no son válidos.
export function calcularFechaEstimada(fechaReubicacion, diasIncubacion) {
  if (!Number.isInteger(diasIncubacion) || diasIncubacion <= 0) return null;
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaReubicacion ?? '');
  if (!partes) return null;
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Descarta fechas que Date "corrige", como 2026-02-30.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  fecha.setUTCDate(fecha.getUTCDate() + diasIncubacion);
  return fecha.toISOString().slice(0, 10);
}
