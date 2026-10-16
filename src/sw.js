// Service worker: precachea el shell de la app y lo sirve desde caché cuando no hay señal.
const CACHE = 'nido-v3';
// Con señal débil el fetch se queda colgado; pasado este tiempo se sirve la copia en caché.
const TIMEOUT_RED_MS = 3000;
const PRECACHE = [
  '/',
  '/index.html',
  '/nuevo-nido.html',
  '/config.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/js/db.js',
  '/js/catalogos.js',
  '/js/uuid.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Red primero para recibir cada despliegue nuevo; si no hay señal o tarda más de
// TIMEOUT_RED_MS, la copia en caché. Las peticiones a Supabase (otro origen) no pasan por aquí.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(redConTimeout(request));
});

// Tras un timeout, la red se da por lenta un rato y se sirve el caché sin esperar;
// si no, cada recurso encadenado (HTML → config.js → módulos) sumaría otros 3 s.
const RED_LENTA_MS = 30000;
let redLentaHasta = 0;

async function redConTimeout(request) {
  const red = fetch(request).then((respuesta) => {
    if (respuesta.ok) {
      const copia = respuesta.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copia));
    }
    return respuesta;
  });
  red.catch(() => {});

  if (Date.now() < redLentaHasta) {
    const enCache = await caches.match(request, { ignoreSearch: true });
    if (enCache) return enCache;
  }

  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT_RED_MS, null));
  try {
    const respuesta = await Promise.race([red, timeout]);
    if (respuesta) return respuesta;
    redLentaHasta = Date.now() + RED_LENTA_MS;
  } catch (err) {
    // Sin red: se intenta con el caché.
  }
  const enCache = await caches.match(request, { ignoreSearch: true });
  // Si no está en caché se sigue esperando a la red (o se propaga su error).
  return enCache || red;
}
