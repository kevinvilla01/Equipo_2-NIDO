// Máquina de estados del nido. Espejo de nidos_validar_transicion() en
// supabase/migrations/20261126000000_hu12_nido_perdido.sql: si cambias una, cambia la otra.
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

// Estado actual → estados a los que puede pasar. perdido es final: el nido queda cerrado.
export const TRANSICIONES = Object.freeze({
  registrado: Object.freeze(['en_corral', 'perdido']),
  en_corral: Object.freeze(['eclosionado', 'perdido']),
  eclosionado: Object.freeze(['perdido']),
  perdido: Object.freeze([]),
});

// Causas de pérdida: mismos valores que el CHECK nidos_causa_perdida_valida.
export const CAUSAS_PERDIDA = Object.freeze({
  depredacion: 'Depredación',
  saqueo: 'Saqueo',
  marea: 'Marea',
  inviable: 'Inviable',
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

// Un nido perdido no admite ningún cambio (en el servidor responde NE005).
export function estaCerrado(nido) {
  return nido?.estado === ESTADOS.PERDIDO;
}

// Valida el paso a perdido: transición permitida y causa del catálogo.
export function validarPasoAPerdido(nido, { causa }) {
  if (estaCerrado(nido)) {
    return { valido: false, errores: { estado: 'Este nido ya está perdido y no se puede modificar.' } };
  }
  if (!puedeTransicionar(nido?.estado, ESTADOS.PERDIDO)) {
    const actual = ETIQUETA_ESTADO[nido?.estado] ?? nido?.estado;
    return { valido: false, errores: { estado: `No se puede marcar como perdido un nido "${actual}".` } };
  }
  if (!Object.hasOwn(CAUSAS_PERDIDA, causa)) {
    return { valido: false, errores: { causa: 'Elige la causa de la pérdida.' } };
  }
  return { valido: true, datos: { causa } };
}

// Acepta 0: puede no haber crías vivas o muertas.
function aEnteroNoNegativo(valor) {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor >= 0 ? valor : null;
  if (typeof valor !== 'string' || !/^\s*\d+\s*$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : null;
}

// Valida el paso a eclosionado (HU-11): solo desde en_corral, crías vivas y muertas
// obligatorias y su suma no mayor que los huevos registrados. Mismas reglas que
// registrar_eclosion() en supabase/migrations/20261129000000_hu11_eclosion.sql.
export function validarPasoAEclosionado(nido, { vivas, muertas } = {}) {
  if (estaCerrado(nido)) {
    return { valido: false, errores: { estado: 'Este nido está perdido y no se puede modificar.' } };
  }
  if (!puedeTransicionar(nido?.estado, ESTADOS.ECLOSIONADO)) {
    const actual = ETIQUETA_ESTADO[nido?.estado] ?? nido?.estado;
    return {
      valido: false,
      errores: { estado: `Solo se puede registrar la eclosión de un nido en corral; este está "${actual}".` },
    };
  }
  const errores = {};
  const totalVivas = aEnteroNoNegativo(vivas);
  const totalMuertas = aEnteroNoNegativo(muertas);
  if (totalVivas === null) errores.vivas = 'Escribe las crías vivas (0 o más).';
  if (totalMuertas === null) errores.muertas = 'Escribe las crías muertas (0 o más).';
  if (Object.keys(errores).length > 0) return { valido: false, errores };
  const huevos = nido.huevos_contados;
  if (!Number.isInteger(huevos) || totalVivas + totalMuertas > huevos) {
    return {
      valido: false,
      errores: {
        suma: `Crías vivas más muertas (${totalVivas + totalMuertas}) no pueden superar los huevos registrados (${huevos ?? 'sin registrar'}).`,
      },
    };
  }
  return { valido: true, datos: { vivas: totalVivas, muertas: totalMuertas } };
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
