import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esNidoActivo,
  tienePendientes,
  filtrarNidosActivos,
  ordenarNidos,
  coincideBusqueda,
  fusionarNidosDelServidor,
} from '../src/js/nidos-activos.js';

const nido = (datos) => ({ clave: 'n1', estado: 'registrado', tramo_id: 1, creado_en: '2026-11-01T10:00:00Z', ...datos });

test('registrado y en_corral son activos; perdido no', () => {
  assert.equal(esNidoActivo(nido({ estado: 'registrado' })), true);
  assert.equal(esNidoActivo(nido({ estado: 'en_corral' })), true);
  assert.equal(esNidoActivo(nido({ estado: 'perdido' })), false);
});

test('eclosionado es activo mientras le queden crías por liberar', () => {
  assert.equal(esNidoActivo(nido({ estado: 'eclosionado', crias_por_liberar: 12 })), true);
  assert.equal(esNidoActivo(nido({ estado: 'eclosionado', crias_por_liberar: null })), true);
  assert.equal(esNidoActivo(nido({ estado: 'eclosionado' })), true);
  assert.equal(esNidoActivo(nido({ estado: 'eclosionado', crias_por_liberar: 0 })), false);
});

test('estado desconocido o nido vacío no es activo', () => {
  assert.equal(esNidoActivo(nido({ estado: 'liberado' })), false);
  assert.equal(esNidoActivo(null), false);
});

test('tienePendientes detecta envío, pérdida en cola y conflicto', () => {
  assert.equal(tienePendientes(nido({ pendiente_envio: true })), true);
  assert.equal(tienePendientes(nido({ perdida_pendiente: true })), true);
  assert.equal(tienePendientes(nido({ conflicto: { codigo: 'NE002' } })), true);
  assert.equal(tienePendientes(nido({ pendiente_envio: false })), false);
  assert.equal(tienePendientes(undefined), false);
});

test('el voluntario solo ve los nidos de su campamento', () => {
  const campamentoPorTramo = new Map([[1, 10], [2, 20]]);
  const nidos = [
    nido({ clave: 'a', tramo_id: 1 }),
    nido({ clave: 'b', tramo_id: 2 }),
    nido({ clave: 'c', tramo_id: 99, campamento_id: 20 }),
    nido({ clave: 'd', tramo_id: 1, estado: 'perdido' }),
  ];
  const perfil = { rol: 'voluntario', campamento_id: 10 };
  assert.deepEqual(filtrarNidosActivos(nidos, { perfil, campamentoPorTramo }).map((n) => n.clave), ['a']);
});

test('el campamento del servidor (campamento_id) gana al del catálogo', () => {
  const campamentoPorTramo = new Map([[1, 10]]);
  const perfil = { rol: 'voluntario', campamento_id: 20 };
  const visibles = filtrarNidosActivos([nido({ tramo_id: 1, campamento_id: 20 })], { perfil, campamentoPorTramo });
  assert.equal(visibles.length, 1);
});

test('compara ids aunque uno llegue como texto', () => {
  const perfil = { rol: 'voluntario', campamento_id: '10' };
  const visibles = filtrarNidosActivos([nido({ campamento_id: 10 })], { perfil });
  assert.equal(visibles.length, 1);
});

test('el coordinador y un perfil sin campamento ven todos los activos', () => {
  const nidos = [nido({ clave: 'a', campamento_id: 10 }), nido({ clave: 'b', campamento_id: 20 })];
  assert.equal(filtrarNidosActivos(nidos, { perfil: { rol: 'coordinador', campamento_id: 10 } }).length, 2);
  assert.equal(filtrarNidosActivos(nidos, { perfil: { rol: 'voluntario', campamento_id: null } }).length, 2);
});

test('un nido de campamento desconocido se muestra (catálogo de tramos viejo)', () => {
  const perfil = { rol: 'voluntario', campamento_id: 10 };
  assert.equal(filtrarNidosActivos([nido({ tramo_id: 5 })], { perfil, campamentoPorTramo: new Map() }).length, 1);
});

test('ordena primero por corral (orden natural) y luego por fecha', () => {
  const ordenados = ordenarNidos([
    nido({ clave: 'sin-viejo', creado_en: '2026-11-01T00:00:00Z' }),
    nido({ clave: 'c10', corral: 'C-10' }),
    nido({ clave: 'sin-nuevo', creado_en: '2026-11-05T00:00:00Z' }),
    nido({ clave: 'c2', corral: 'C-2' }),
  ]);
  assert.deepEqual(ordenados.map((n) => n.clave), ['c2', 'c10', 'sin-nuevo', 'sin-viejo']);
});

test('la búsqueda encuentra por corral, clave o referencia sin importar mayúsculas', () => {
  const n = nido({ clave: 'abc123', corral: 'C-7', referencia_ubicacion: 'Junto a la Caseta 3' });
  assert.equal(coincideBusqueda(n, 'c-7'), true);
  assert.equal(coincideBusqueda(n, 'ABC'), true);
  assert.equal(coincideBusqueda(n, 'caseta'), true);
  assert.equal(coincideBusqueda(n, 'zzz'), false);
  assert.equal(coincideBusqueda(n, '  '), true);
});

test('fusionar guarda los del servidor como enviados y con origen servidor', () => {
  const { guardar, borrar } = fusionarNidosDelServidor([], [{ clave: 'r1', estado: 'en_corral', corral: 'C-1', creado_en: '2026-11-02T00:00:00Z' }], { ahora: 'T' });
  assert.equal(guardar.length, 1);
  assert.equal(guardar[0].pendiente_envio, false);
  assert.equal(guardar[0].origen, 'servidor');
  assert.equal(guardar[0].sincronizado_en, 'T');
  assert.deepEqual(borrar, []);
});

test('fusionar no pisa un nido con cambios pendientes o en conflicto', () => {
  const locales = [
    nido({ clave: 'p', pendiente_envio: true, estado: 'en_corral', corral: 'LOCAL' }),
    nido({ clave: 'q', conflicto: { codigo: 'NE002' } }),
  ];
  const remotos = [{ clave: 'p', estado: 'registrado' }, { clave: 'q', estado: 'registrado' }];
  const { guardar } = fusionarNidosDelServidor(locales, remotos);
  assert.deepEqual(guardar, []);
});

test('fusionar conserva el origen de un nido capturado en el teléfono', () => {
  const locales = [nido({ clave: 'x', pendiente_envio: false, nota_local: 'sí' })];
  const { guardar } = fusionarNidosDelServidor(locales, [{ clave: 'x', estado: 'en_corral', corral: 'C-3' }]);
  assert.equal(guardar[0].origen, undefined);
  assert.equal(guardar[0].nota_local, 'sí');
  assert.equal(guardar[0].corral, 'C-3');
  assert.equal(guardar[0].creado_en, '2026-11-01T10:00:00Z');
});

test('con respuesta completa borra solo los bajados del servidor que ya no están activos', () => {
  const locales = [
    nido({ clave: 'srv-viejo', origen: 'servidor', pendiente_envio: false }),
    nido({ clave: 'srv-pendiente', origen: 'servidor', pendiente_envio: true }),
    nido({ clave: 'telefono', pendiente_envio: false }),
  ];
  const { borrar } = fusionarNidosDelServidor(locales, [], { completo: true });
  assert.deepEqual(borrar, ['srv-viejo']);
});

test('con respuesta incompleta no borra nada', () => {
  const locales = [nido({ clave: 'srv', origen: 'servidor', pendiente_envio: false })];
  assert.deepEqual(fusionarNidosDelServidor(locales, [], { completo: false }).borrar, []);
});

test('fusionar ignora filas sin clave', () => {
  assert.deepEqual(fusionarNidosDelServidor([], [{ estado: 'registrado' }, null]).guardar, []);
});
