// Nidos activos del campamento (HU-13): qué nidos se muestran y cómo se mezcla lo que
// llega del servidor con lo que ya hay en el teléfono.
// Módulo puro (sin DOM, IndexedDB ni Supabase) para poder probarlo con `node --test`.
import { ESTADOS } from './estados-nido.js';

// Un nido está activo si no está perdido ni liberado. "Liberado" no es un estado: un
// nido eclosionado lo está cuando ya no le quedan crías por liberar (crias_por_liberar
// lo calcula la vista nidos_activos). Si no se sabe (null o nido capturado en el
// teléfono), sigue activo.
export function esNidoActivo(nido) {
  if (!nido) return false;
  if (nido.estado === ESTADOS.REGISTRADO || nido.estado === ESTADOS.EN_CORRAL) return true;
  if (nido.estado === ESTADOS.ECLOSIONADO) return nido.crias_por_liberar !== 0;
  return false;
}

// Cambios locales que todavía no llegan al servidor (o que el servidor rechazó):
// la sincronización no los toca.
export function tienePendientes(nido) {
  return Boolean(nido?.pendiente_envio || nido?.perdida_pendiente || nido?.conflicto);
}

// El campamento sale del nido (si vino del servidor) o del catálogo de tramos.
export function campamentoDelNido(nido, campamentoPorTramo = new Map()) {
  return nido.campamento_id ?? campamentoPorTramo.get(nido.tramo_id) ?? null;
}

// Lo que ve cada quien sin señal. El filtro de verdad es la RLS del servidor; este
// cubre los nidos capturados en el teléfono (puede haberlos de otro usuario).
// - Coordinador: todos.
// - Perfil sin campamento (aún no corre la migración): todos los del teléfono.
// - Nido de campamento desconocido (catálogo de tramos viejo): se muestra.
export function filtrarNidosActivos(nidos, { perfil, campamentoPorTramo } = {}) {
  const miCampamento = perfil?.campamento_id ?? null;
  const veTodo = perfil?.rol === 'coordinador' || miCampamento === null;
  return nidos.filter((nido) => {
    if (!esNidoActivo(nido)) return false;
    if (veTodo) return true;
    const campamento = campamentoDelNido(nido, campamentoPorTramo);
    return campamento === null || String(campamento) === String(miCampamento);
  });
}

// Primero los que están en corral, por clave de corral ("C-2" antes que "C-10");
// después los demás, del más reciente al más antiguo.
export function ordenarNidos(nidos) {
  const comparar = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;
  return nidos.slice().sort((a, b) => {
    const corralA = a.corral ? String(a.corral) : '';
    const corralB = b.corral ? String(b.corral) : '';
    if (corralA && !corralB) return -1;
    if (!corralA && corralB) return 1;
    if (corralA && corralB && corralA !== corralB) return comparar(corralA, corralB);
    return String(b.creado_en ?? '').localeCompare(String(a.creado_en ?? ''));
  });
}

// Búsqueda en la pantalla: por clave de corral, clave del nido o referencia.
export function coincideBusqueda(nido, texto) {
  const buscado = String(texto ?? '').trim().toLocaleLowerCase('es');
  if (buscado === '') return true;
  return [nido.corral, nido.clave, nido.referencia_ubicacion]
    .some((valor) => valor != null && String(valor).toLocaleLowerCase('es').includes(buscado));
}

// Mezcla los nidos activos del servidor con los del teléfono.
// - Un nido con cambios pendientes o en conflicto no se toca.
// - Los del servidor se guardan como enviados (pendiente_envio: false) y con
//   origen 'servidor' si el teléfono no los tenía.
// - completo: la respuesta trae TODOS los activos del usuario. Solo entonces se borran
//   los nidos bajados del servidor que ya no vienen (se liberaron, se perdieron o son de
//   otro campamento). Los capturados en el teléfono nunca se borran.
// Devuelve { guardar: [nido], borrar: [clave] } para aplicarlo en una transacción.
export function fusionarNidosDelServidor(locales, remotos, { completo = false, ahora = new Date().toISOString() } = {}) {
  const porClave = new Map(locales.map((nido) => [nido.clave, nido]));
  const recibidas = new Set();
  const guardar = [];

  for (const remoto of remotos) {
    if (!remoto?.clave) continue;
    recibidas.add(remoto.clave);
    const local = porClave.get(remoto.clave);
    if (local && tienePendientes(local)) continue;
    guardar.push({
      ...local,
      ...remoto,
      // nuevo-nido.html ordena por creado_en: nunca debe quedar vacío.
      creado_en: remoto.creado_en ?? local?.creado_en ?? ahora,
      pendiente_envio: false,
      origen: local ? local.origen : 'servidor',
      sincronizado_en: ahora,
    });
  }

  const borrar = completo
    ? locales
      .filter((nido) => nido.origen === 'servidor' && !recibidas.has(nido.clave) && !tienePendientes(nido))
      .map((nido) => nido.clave)
    : [];

  return { guardar, borrar };
}
