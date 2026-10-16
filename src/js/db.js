// Persistencia local en IndexedDB: nidos capturados en campo y copia de los catálogos.
const DB_NOMBRE = 'nido';
// v2: el store de nidos pasa de keyPath 'id' a 'clave' (el id lo asigna Supabase).
const DB_VERSION = 2;

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

export function guardarCatalogo(nombre, registros) {
  return transaccion('catalogos', 'readwrite', (store) =>
    store.put({ nombre, registros, actualizado_en: new Date().toISOString() }));
}

export async function leerCatalogo(nombre) {
  const fila = await transaccion('catalogos', 'readonly', (store) => store.get(nombre));
  return fila ? fila.registros : [];
}
