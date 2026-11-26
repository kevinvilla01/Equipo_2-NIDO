// Cola de envío de pendientes (HU-16). Módulo puro (sin DOM, IndexedDB ni Supabase) para
// probarlo con `node --test`; envio-pendientes.js le pasa cómo enviar y cómo guardar.
//
// Orden de dependencias: patrullajes → nidos → liberaciones. Si un padre falla (o se
// queda esperando), sus hijos no se envían en esa corrida y siguen pendientes, sin
// contarlos como error. Cada registro se procesa por separado: un fallo no detiene el lote.

export const ESTADO_SYNC = Object.freeze({
  PENDIENTE: 'pending',
  ENVIANDO: 'syncing',
  ENVIADO: 'synced',
  ERROR: 'error',
});

export const ORDEN = Object.freeze(['patrullajes', 'nidos', 'liberaciones']);

// Identificador de cliente de cada tipo y el de su padre.
const ID = { patrullajes: 'client_id', nidos: 'clave', liberaciones: 'client_id' };
const PADRE = { patrullajes: null, nidos: 'patrullaje_client_id', liberaciones: 'nido_clave' };

export function idDe(tipo, registro) {
  return registro[ID[tipo]];
}

// Pendiente = falta enviarlo, aunque el último intento haya fallado (se puede reintentar).
// Un 'syncing' que quedó guardado (se cerró la pestaña a medio envío) también cuenta.
export function estaPendiente(tipo, registro) {
  if (tipo === 'nidos') return registro?.pendiente_envio === true;
  return Boolean(registro) && registro.sync?.estado !== ESTADO_SYNC.ENVIADO;
}

// Errores reintentables (el registro vuelve a 'pending'): sin respuesta del servidor,
// 5xx/408/429, sesión vencida o NE001 (el padre aún no llega). El resto son rechazos
// de validación: 'error' con el motivo, y se pueden reintentar a mano.
export function clasificarError(error) {
  const codigo = String(error?.code ?? '');
  const estado = Number(error?.status ?? 0);
  const mensaje = String(error?.message ?? error ?? 'Error desconocido');
  const deRed = /failed to fetch|networkerror|load failed|network request failed|timeout|tiempo agotado|abort/i.test(mensaje);
  const reintentable = deRed
    || (!codigo && !estado)
    || estado >= 500 || estado === 408 || estado === 429 || estado === 401
    || codigo === 'NE001' || codigo === 'PGRST301';
  return { reintentable, motivo: codigo ? `${codigo}: ${mensaje}` : mensaje };
}

// cola: { patrullajes: [], nidos: [], liberaciones: [] } (solo los pendientes).
// enviar(tipo, registro) → fila del servidor, o lanza el error.
// guardar(tipo, registro, cambios) → persiste el resultado en el teléfono.
export async function procesarCola(cola, { enviar, guardar }) {
  const resumen = { enviados: 0, fallidos: 0, en_espera: 0, errores: [] };
  // Padres que no llegaron al servidor en esta corrida.
  const bloqueados = new Set();

  for (const tipo of ORDEN) {
    const registros = [...(cola[tipo] ?? [])].sort((a, b) => String(a.creado_en ?? '').localeCompare(String(b.creado_en ?? '')));
    for (const registro of registros) {
      const id = idDe(tipo, registro);
      const padre = PADRE[tipo] ? registro[PADRE[tipo]] : null;
      if (padre && bloqueados.has(padre)) {
        bloqueados.add(id);
        resumen.en_espera++;
        continue;
      }

      const intentos = (registro.sync?.intentos ?? 0) + 1;
      await guardar(tipo, registro, { sync: { ...registro.sync, estado: ESTADO_SYNC.ENVIANDO } });
      try {
        const fila = await enviar(tipo, registro);
        await guardar(tipo, registro, {
          ...(tipo === 'nidos' ? { pendiente_envio: false, id: fila?.id ?? registro.id } : { id: fila?.id ?? registro.id }),
          sync: { estado: ESTADO_SYNC.ENVIADO, intentos, ultimo_error: null, enviado_en: new Date().toISOString() },
        });
        resumen.enviados++;
      } catch (error) {
        const { reintentable, motivo } = clasificarError(error);
        await guardar(tipo, registro, {
          sync: { estado: reintentable ? ESTADO_SYNC.PENDIENTE : ESTADO_SYNC.ERROR, intentos, ultimo_error: motivo },
        });
        bloqueados.add(id);
        resumen.fallidos++;
        resumen.errores.push({ tipo, id, motivo, reintentable });
      }
    }
  }
  return resumen;
}

export function textoResumen({ enviados, fallidos, en_espera: enEspera }) {
  const partes = [`${enviados} ${enviados === 1 ? 'enviado' : 'enviados'}`, `${fallidos} ${fallidos === 1 ? 'fallido' : 'fallidos'}`];
  if (enEspera) partes.push(`${enEspera} en espera de su patrullaje o nido`);
  return partes.join(', ');
}
