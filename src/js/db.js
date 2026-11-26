// Persistencia local en IndexedDB: nidos capturados en campo y copia de los catálogos.
const DB_NOMBRE = 'nido';
// v2: el store de nidos pasa de keyPath 'id' a 'clave' (el id lo asigna Supabase).
// v3: cola de pérdidas por enviar (HU-12), una por nido.
const DB_VERSION = 3;

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
