import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puedeTransicionar,
  validarReubicacion,
  validarPasoACorral,
  calcularFechaEstimada,
} from '../src/js/estados-nido.js';

test('registrado → en_corral es una transición válida', () => {
  assert.equal(puedeTransicionar('registrado', 'en_corral'), true);
});

test('solo se llega a en_corral desde registrado', () => {
  for (const desde of ['en_corral', 'eclosionado', 'perdido']) {
    assert.equal(puedeTransicionar(desde, 'en_corral'), false, desde);
  }
});

test('estados finales y desconocidos no transicionan', () => {
  assert.equal(puedeTransicionar('eclosionado', 'perdido'), false);
  assert.equal(puedeTransicionar('perdido', 'registrado'), false);
  assert.equal(puedeTransicionar('inventado', 'en_corral'), false);
  assert.equal(puedeTransicionar('toString', 'en_corral'), false);
});

test('paso a corral válido normaliza clave y huevos', () => {
  const resultado = validarPasoACorral({ estado: 'registrado' }, { corral: '  C-12 ', huevos: '87' });
  assert.deepEqual(resultado, { valido: true, datos: { corral: 'C-12', huevos: 87 } });
});

test('paso a corral desde un estado que no es registrado se rechaza', () => {
  const resultado = validarPasoACorral({ estado: 'eclosionado' }, { corral: 'C-1', huevos: 80 });
  assert.equal(resultado.valido, false);
  assert.ok(resultado.errores.estado);
});

test('sin clave de corral se rechaza', () => {
  for (const corral of ['', '   ', undefined, null]) {
    const resultado = validarReubicacion({ corral, huevos: 80 });
    assert.equal(resultado.valido, false);
    assert.ok(resultado.errores.corral, String(corral));
    assert.equal(resultado.errores.huevos, undefined);
  }
});

test('sin número de huevos se rechaza', () => {
  for (const huevos of ['', '  ', undefined, null]) {
    const resultado = validarReubicacion({ corral: 'C-1', huevos });
    assert.equal(resultado.valido, false);
    assert.ok(resultado.errores.huevos, String(huevos));
  }
});

test('huevos = 0 se rechaza', () => {
  assert.equal(validarReubicacion({ corral: 'C-1', huevos: 0 }).valido, false);
  assert.equal(validarReubicacion({ corral: 'C-1', huevos: '0' }).valido, false);
});

test('huevos negativos, decimales o con texto se rechazan', () => {
  for (const huevos of [-3, '-3', 2.5, '2.5', '1e2', '12a', NaN, Infinity]) {
    assert.equal(validarReubicacion({ corral: 'C-1', huevos }).valido, false, String(huevos));
  }
});

test('sin clave ni huevos reporta ambos errores', () => {
  const resultado = validarReubicacion({ corral: '', huevos: '' });
  assert.deepEqual(Object.keys(resultado.errores).sort(), ['corral', 'huevos']);
});

test('fecha estimada = reubicación + días de incubación', () => {
  assert.equal(calcularFechaEstimada('2026-11-10', 67), '2027-01-16');
});

test('fecha estimada cruza fin de mes y año bisiesto', () => {
  assert.equal(calcularFechaEstimada('2028-02-28', 1), '2028-02-29');
  assert.equal(calcularFechaEstimada('2027-02-28', 1), '2027-03-01');
  assert.equal(calcularFechaEstimada('2026-12-31', 1), '2027-01-01');
});

test('fecha estimada no se mueve por el cambio de horario', () => {
  // En 2026 México no tiene horario de verano, pero EE. UU. cambia el 1 de nov.
  assert.equal(calcularFechaEstimada('2026-10-31', 2), '2026-11-02');
  assert.equal(calcularFechaEstimada('2026-03-07', 2), '2026-03-09');
});

test('sin días de incubación válidos no hay fecha estimada', () => {
  for (const dias of [null, undefined, 0, -5, 45.5, '60']) {
    assert.equal(calcularFechaEstimada('2026-11-10', dias), null, String(dias));
  }
});

test('fecha de reubicación inválida no da fecha estimada', () => {
  for (const fecha of ['', null, '10/11/2026', '2026-02-30', '2026-13-01']) {
    assert.equal(calcularFechaEstimada(fecha, 60), null, String(fecha));
  }
});
