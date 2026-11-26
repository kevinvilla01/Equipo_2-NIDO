import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarError, estaPendiente, procesarCola, textoResumen, ESTADO_SYNC } from '../src/js/cola-envio.js';

// Servidor falso con la misma semántica que las RPCs de HU-16: deduplica por el
// identificador de cliente y responde NE001 si el padre aún no existe.
function servidorFalso({ fallar = () => null } = {}) {
  const tablas = { patrullajes: new Map(), nidos: new Map(), liberaciones: new Map() };
  const llamadas = [];
  let siguiente = 1;
  const enviar = async (tipo, r) => {
    const id = tipo === 'nidos' ? r.clave : r.client_id;
    llamadas.push(`${tipo}:${id}`);
    const error = fallar(tipo, r);
    if (error) throw error;
    if (tipo === 'nidos' && r.patrullaje_client_id && !tablas.patrullajes.has(r.patrullaje_client_id)) {
      throw { code: 'NE001', message: 'El patrullaje del nido aún no está en el servidor.' };
    }
    if (tipo === 'liberaciones' && !tablas.nidos.has(r.nido_clave)) {
      throw { code: 'NE001', message: 'El nido de la liberación aún no está en el servidor.' };
    }
    if (!tablas[tipo].has(id)) tablas[tipo].set(id, { id: siguiente++ });
    return tablas[tipo].get(id);
  };
  return { tablas, llamadas, enviar };
}

// "Teléfono" falso: guarda los cambios sobre copias de los registros.
function telefono(cola) {
  const copia = structuredClone(cola);
  const guardar = async (tipo, registro, cambios) => {
    const llave = tipo === 'nidos' ? 'clave' : 'client_id';
    const actual = copia[tipo].find((r) => r[llave] === registro[llave]);
    Object.assign(actual, cambios);
  };
  const pendientes = () => ({
    patrullajes: copia.patrullajes.filter((r) => estaPendiente('patrullajes', r)),
    nidos: copia.nidos.filter((r) => estaPendiente('nidos', r)),
    liberaciones: copia.liberaciones.filter((r) => estaPendiente('liberaciones', r)),
  });
  const total = () => Object.values(pendientes()).reduce((s, l) => s + l.length, 0);
  return { copia, guardar, pendientes, total };
}

const pendiente = { estado: ESTADO_SYNC.PENDIENTE, intentos: 0 };
// Desordenados a propósito: la cola tiene que ordenar por tipo.
const lote = () => ({
  liberaciones: [{ client_id: 'L1', nido_clave: 'N1', cantidad_liberada: 3, creado_en: '2026-11-28T03:00:00Z', sync: pendiente }],
  nidos: [
    { clave: 'N1', patrullaje_client_id: 'P1', pendiente_envio: true, creado_en: '2026-11-28T02:00:00Z' },
    { clave: 'N2', patrullaje_client_id: null, pendiente_envio: true, creado_en: '2026-11-28T02:30:00Z' },
  ],
  patrullajes: [{ client_id: 'P1', voluntarios: [1], creado_en: '2026-11-28T01:00:00Z', sync: pendiente }],
});

test('envía en orden de dependencias: patrullaje → nido → liberación', async () => {
  const servidor = servidorFalso();
  const tel = telefono(lote());
  const resumen = await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });
  assert.deepEqual(servidor.llamadas, ['patrullajes:P1', 'nidos:N1', 'nidos:N2', 'liberaciones:L1']);
  assert.equal(resumen.enviados, 4);
  assert.equal(resumen.fallidos, 0);
  assert.equal(tel.total(), 0, 'el contador de pendientes baja a 0');
  assert.equal(tel.copia.patrullajes[0].sync.estado, ESTADO_SYNC.ENVIADO);
  assert.equal(tel.copia.nidos[0].pendiente_envio, false);
});

test('enviar el mismo lote dos veces deja las mismas filas en el servidor', async () => {
  const servidor = servidorFalso();
  // Dos teléfonos con el mismo lote simulan un reenvío en el que se perdió la marca local.
  for (const tel of [telefono(lote()), telefono(lote())]) {
    await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(servidor.tablas).map(([t, filas]) => [t, filas.size])),
    { patrullajes: 1, nidos: 2, liberaciones: 1 },
  );
});

test('un segundo envío no manda nada si ya se envió todo', async () => {
  const servidor = servidorFalso();
  const tel = telefono(lote());
  await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });
  const llamadas = servidor.llamadas.length;
  const resumen = await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });
  assert.equal(servidor.llamadas.length, llamadas);
  assert.equal(resumen.enviados, 0);
});

test('si falla un nido, su liberación sigue pendiente y los demás se envían', async () => {
  const servidor = servidorFalso({
    fallar: (tipo, r) => (tipo === 'nidos' && r.clave === 'N1' ? { code: 'NE003', message: 'Datos inválidos' } : null),
  });
  const tel = telefono(lote());
  const resumen = await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });

  assert.ok(!servidor.llamadas.includes('liberaciones:L1'), 'la liberación del nido fallido no se manda');
  assert.ok(servidor.llamadas.includes('nidos:N2'), 'el otro nido sí se manda');
  const [n1, n2] = tel.copia.nidos;
  const [l1] = tel.copia.liberaciones;
  assert.equal(n1.pendiente_envio, true);
  assert.equal(n1.sync.estado, ESTADO_SYNC.ERROR);
  assert.match(n1.sync.ultimo_error, /NE003/);
  assert.equal(n2.pendiente_envio, false);
  assert.equal(l1.sync.estado, ESTADO_SYNC.PENDIENTE, 'el hijo queda pendiente, no en error');
  assert.equal(l1.sync.intentos, 0, 'al hijo no se le cuenta un intento');
  assert.deepEqual([resumen.enviados, resumen.fallidos, resumen.en_espera], [2, 1, 1]);
  assert.equal(textoResumen(resumen), '2 enviados, 1 fallido, 1 en espera de su patrullaje o nido');

  // Reintento: ya sin el fallo, se envían el nido y su liberación.
  const reintento = await procesarCola(tel.pendientes(), { enviar: servidorFalsoCon(servidor).enviar, guardar: tel.guardar });
  assert.deepEqual([reintento.enviados, reintento.fallidos], [2, 0]);
  assert.equal(tel.total(), 0);
});

// El mismo servidor (mismas tablas) pero ya sin fallar.
function servidorFalsoCon(servidor) {
  const limpio = servidorFalso();
  limpio.tablas.patrullajes = servidor.tablas.patrullajes;
  limpio.tablas.nidos = servidor.tablas.nidos;
  limpio.tablas.liberaciones = servidor.tablas.liberaciones;
  return limpio;
}

test('un error de red deja el registro pendiente para reintentar y bloquea a sus hijos', async () => {
  const servidor = servidorFalso({
    fallar: (tipo) => (tipo === 'patrullajes' ? new TypeError('Failed to fetch') : null),
  });
  const tel = telefono(lote());
  const resumen = await procesarCola(tel.pendientes(), { enviar: servidor.enviar, guardar: tel.guardar });
  assert.equal(tel.copia.patrullajes[0].sync.estado, ESTADO_SYNC.PENDIENTE);
  assert.equal(tel.copia.patrullajes[0].sync.intentos, 1);
  assert.ok(!servidor.llamadas.includes('nidos:N1'));
  assert.ok(!servidor.llamadas.includes('liberaciones:L1'), 'el nieto tampoco se manda');
  assert.deepEqual([resumen.enviados, resumen.fallidos, resumen.en_espera], [1, 1, 2]);
});

test('clasifica errores de red y de validación', () => {
  assert.equal(clasificarError(new TypeError('Failed to fetch')).reintentable, true);
  assert.equal(clasificarError({ message: 'Load failed' }).reintentable, true);
  assert.equal(clasificarError({ code: '500', status: 503, message: 'Service Unavailable' }).reintentable, true);
  assert.equal(clasificarError({ code: 'NE001', message: 'padre' }).reintentable, true);
  assert.equal(clasificarError({ code: 'PGRST301', message: 'JWT expired' }).reintentable, true);
  for (const code of ['NE003', 'NE007', '22P02', '23503', '42501']) {
    const { reintentable, motivo } = clasificarError({ code, message: 'motivo' });
    assert.equal(reintentable, false, code);
    assert.equal(motivo, `${code}: motivo`);
  }
});

test('pendiente: nidos por pendiente_envio, el resto por sync.estado', () => {
  assert.equal(estaPendiente('nidos', { pendiente_envio: true }), true);
  assert.equal(estaPendiente('nidos', { pendiente_envio: false }), false);
  assert.equal(estaPendiente('patrullajes', { sync: { estado: 'error' } }), true);
  assert.equal(estaPendiente('patrullajes', { sync: { estado: 'syncing' } }), true, 'un envío interrumpido se reintenta');
  assert.equal(estaPendiente('liberaciones', { sync: { estado: 'synced' } }), false);
});
