// Persistencia local en IndexedDB: nidos capturados en campo y copia de los catálogos.
import { tienePendientes } from '/js/nidos-activos.js';

const DB_NOMBRE = 'nido';
// v2: el store de nidos pasa de keyPath 'id' a 'clave' (el id lo asigna Supabase).
// v3: cola de pérdidas por enviar (HU-12), una por nido.
// v4: patrullajes y liberaciones capturados sin señal (HU-16), por client_id.
const DB_VERSION = 4;

let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolve, reject) => {
    const peticion = indexedDB.open(DB_NOMBRE, DB_VERSION);
    peticion.onupgradeneeded = (evento) => {
      const db = peticion.result;
      // En v1 los nidos eran solo de prueba; se descartan para cambiar el keyPath.
      if (evento.oldVersion < 2 && db.objectStoreNames.contains('nidos')) {
        db.deleteObjectStore('nidos');
      }
      if (!db.objectStoreNames.contains('nidos')) {
        const nidos = db.createObjectStore('nidos', { keyPath: 'clave' });
        nidos.createIndex('pendiente_envio', 'pendiente_envio');
      }
      // Copia local de tramos y especies para poder llenar el formulario sin señal.
      if (!db.objectStoreNames.contains('catalogos')) {
        db.createObjectStore('catalogos', { keyPath: 'nombre' });
      }
      // Pérdidas marcadas sin señal: { clave, causa, fecha_perdida, creado_en }.
      if (!db.objectStoreNames.contains('perdidas_pendientes')) {
        db.createObjectStore('perdidas_pendientes', { keyPath: 'clave' });
      }
      // Registros creados en el teléfono con su client_id (UUID) y su estado de envío
      // (sync: { estado: 'pending'|'syncing'|'synced'|'error', intentos, ultimo_error }).
      for (const store of ['patrullajes', 'liberaciones']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'client_id' });
      }
    };
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
  return conexion;
}

async function transaccion(store, modo, operacion) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo);
    const resultado = operacion(tx.objectStore(store));
    tx.oncomplete = () => resolve(resultado.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function guardarNido(nido) {
  return transaccion('nidos', 'readwrite', (store) => store.add(nido));
}

export function listarNidos() {
  return transaccion('nidos', 'readonly', (store) => store.getAll());
}

export function obtenerNido(clave) {
  return transaccion('nidos', 'readonly', (store) => store.get(clave));
}

// Reemplaza el nido completo (mismo keyPath 'clave'); se usa en los cambios de estado.
export function actualizarNido(nido) {
  return transaccion('nidos', 'readwrite', (store) => store.put(nido));
}

// Marca el nido como perdido y lo deja en la cola en una sola transacción:
// o quedan las dos cosas o ninguna.
export async function marcarPerdidoLocal(nido, perdida) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['nidos', 'perdidas_pendientes'], 'readwrite');
    tx.objectStore('nidos').put(nido);
    tx.objectStore('perdidas_pendientes').put(perdida);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Aplica lo que trajo la sincronización de nidos activos (HU-13) en una sola
// transacción: si algo falla, el teléfono se queda como estaba. Se vuelve a leer cada
// nido dentro de la transacción: si mientras se descargaba alguien lo cambió en el
// teléfono (reubicar, marcar perdido), gana el cambio local.
export async function aplicarSincronizacionNidos({ guardar, borrar }) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nidos', 'readwrite');
    const store = tx.objectStore('nidos');
    const conActual = (clave, accion) => {
      const lectura = store.get(clave);
      lectura.onsuccess = () => {
        if (!tienePendientes(lectura.result)) accion();
      };
    };
    guardar.forEach((nido) => conActual(nido.clave, () => store.put(nido)));
    borrar.forEach((clave) => conActual(clave, () => store.delete(clave)));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function listarPerdidasPendientes() {
  return transaccion('perdidas_pendientes', 'readonly', (store) => store.getAll());
}

export function quitarPerdidaPendiente(clave) {
  return transaccion('perdidas_pendientes', 'readwrite', (store) => store.delete(clave));
}

export function guardarCatalogo(nombre, registros) {
  return transaccion('catalogos', 'readwrite', (store) =>
    store.put({ nombre, registros, actualizado_en: new Date().toISOString() }));
}

export async function leerCatalogo(nombre) {
  const fila = await transaccion('catalogos', 'readonly', (store) => store.get(nombre));
  return fila ? fila.registros : [];
}

// HU-16: patrullajes y liberaciones creados sin señal.
export function guardarPatrullajeLocal(patrullaje) {
  return transaccion('patrullajes', 'readwrite', (store) => store.add(patrullaje));
}

export function listarPatrullajesLocales() {
  return transaccion('patrullajes', 'readonly', (store) => store.getAll());
}

export function guardarLiberacionLocal(liberacion) {
  return transaccion('liberaciones', 'readwrite', (store) => store.add(liberacion));
}

export function listarLiberacionesLocales() {
  return transaccion('liberaciones', 'readonly', (store) => store.getAll());
}

export function contarPerdidasPendientes() {
  return transaccion('perdidas_pendientes', 'readonly', (store) => store.count());
}

// Mezcla cambios en un registro leyéndolo dentro de la misma transacción, para no pisar
// lo que otra pantalla haya cambiado mientras se enviaba (p. ej. marcar perdido).
export async function actualizarCampos(store, llave, cambios) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objetos = tx.objectStore(store);
    const lectura = objetos.get(llave);
    lectura.onsuccess = () => {
      if (lectura.result) objetos.put({ ...lectura.result, ...cambios });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
