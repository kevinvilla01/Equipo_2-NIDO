// Shell común de todas las pantallas: service worker, estado de conexión y navegación inferior.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('Service worker no registrado:', err);
  });
}

// Sin señal: <body class="sin-conexion"> muestra la .franja-offline de ui.css.
// Si la pantalla tiene #estado-sync en la barra, también se actualiza.
function actualizarConexion() {
  const hayConexion = navigator.onLine;
  document.body.classList.toggle('sin-conexion', !hayConexion);

  const estado = document.getElementById('estado-sync');
  if (!estado) return;
  estado.classList.toggle('estado-sync--sin-conexion', !hayConexion);
  document.getElementById('estado-sync-icono').textContent = hayConexion ? '✓' : '⚠';
  document.getElementById('estado-sync-texto').textContent = hayConexion ? 'En línea' : 'Sin conexión';
}

window.addEventListener('online', actualizarConexion);
window.addEventListener('offline', actualizarConexion);
actualizarConexion();

// Barra inferior de las pantallas de operación: <nav class="nav-inferior" data-activa="patrullaje"></nav>
const PESTANAS = [
  {
    id: 'patrullaje', texto: 'Patrullaje', href: '/patrullajes.html',
    icono: '<path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  },
  {
    id: 'nidos', texto: 'Nidos', href: '/nuevo-nido.html',
    icono: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: 'liberaciones', texto: 'Liberaciones', href: null,
    icono: '<path d="M12 3c3 3.5 6 6.8 6 10.5A6 6 0 0 1 6 13.5C6 9.8 9 6.5 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  },
];

const nav = document.querySelector('.nav-inferior');
if (nav) {
  nav.setAttribute('aria-label', 'Secciones');
  nav.innerHTML = PESTANAS.map((pestana) => {
    const icono = `<svg viewBox="0 0 24 24" aria-hidden="true">${pestana.icono}</svg>`;
    if (!pestana.href) {
      return `<span class="nav-inferior__item" aria-disabled="true">${icono}
        <span>${pestana.texto}</span><span class="nav-inferior__nota">Próximamente</span></span>`;
    }
    const actual = pestana.id === nav.dataset.activa ? ' aria-current="page"' : '';
    return `<a class="nav-inferior__item" href="${pestana.href}"${actual}>${icono}<span>${pestana.texto}</span></a>`;
  }).join('');
}
