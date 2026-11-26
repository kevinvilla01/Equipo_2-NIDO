// Shell común de todas las pantallas: sesión, service worker, estado de conexión y navegación inferior.
import { asegurarSesion, cerrarSesion, esCoordinador, protegerPagina } from '/js/sesion.js';
import { enviarPerdidasPendientes } from '/js/cola-perdidas.js';
import { sincronizarNidosActivos } from '/js/sync-nidos.js';
import { avisarPendientes, enviando, enviarPendientes as enviarTodoLoPendiente } from '/js/envio-pendientes.js';
import { textoResumen } from '/js/cola-envio.js';

// Pérdidas de nidos marcadas sin señal (HU-12). Solo con sesión de coordinador: si en el
// teléfono entra después un voluntario, el servidor las rechazaría (NE006) y quedarían
// como conflicto.
function enviarPendientes() {
  if (!esCoordinador()) return;
  enviarPerdidasPendientes().catch((err) => console.warn('No se pudieron enviar las pérdidas pendientes:', err));
}

// Acceso de la pantalla: <body data-acceso="publico|sesion|coordinador">; por defecto 'sesion'.
// Es comodidad de UI: quién puede leer o escribir qué lo decide RLS en el servidor.
protegerPagina(document.body.dataset.acceso ?? 'sesion').then((perfil) => {
  // Enlaces solo para coordinador (Catálogos, Voluntarios…): data-solo-coordinador,
  // con class="oculto" en el HTML para que no parpadeen antes de saber el rol.
  const coordinador = esCoordinador();
  document.querySelectorAll('[data-solo-coordinador]').forEach((elemento) => {
    elemento.classList.toggle('oculto', !coordinador);
  });
  if (perfil && document.body.dataset.acceso !== 'publico') {
    montarBotonPendientes();
    enviarPendientes();
    // Nidos activos y catálogos para el trabajo sin señal (HU-13).
    sincronizarNidosActivos();
  }
});

window.addEventListener('nido:sesion-vigente', () => {
  // Al volver la señal se manda todo lo pendiente (HU-16); incluye las pérdidas.
  if (botonPendientes) enviarDesdeBarra({ automatico: true });
  else enviarPendientes();
  sincronizarNidosActivos({ forzar: true });
});

document.querySelectorAll('[data-cerrar-sesion]').forEach((boton) => {
  boton.addEventListener('click', () => cerrarSesion());
});

// Al volver la señal se deja el JWT vigente y se avisa a quien tenga envíos pendientes
// (escuchan 'nido:sesion-vigente'). Si Auth rechaza la sesión, la pantalla manda al login
// con protegerPagina() y lo pendiente sigue en IndexedDB.
window.addEventListener('online', async () => {
  const estado = await asegurarSesion();
  if (estado === 'vigente') window.dispatchEvent(new Event('nido:sesion-vigente'));
  else if (estado === 'rechazada') protegerPagina(document.body.dataset.acceso ?? 'sesion');
});

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
    id: 'nidos', texto: 'Nidos', href: '/nidos-activos.html',
    icono: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: 'liberaciones', texto: 'Liberaciones', href: '/liberaciones.html',
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

// HU-16 · "Enviar pendientes" en la barra de todas las pantallas con sesión: contador de
// patrullajes, nidos y liberaciones por enviar, y el botón que los manda.
let botonPendientes = null;
let totalPendientes = 0;

function pintarBotonPendientes() {
  if (!botonPendientes) return;
  const ocupado = enviando();
  botonPendientes.querySelector('[data-total]').textContent = String(totalPendientes);
  botonPendientes.querySelector('[data-texto]').textContent = ocupado ? 'Enviando…' : 'Enviar pendientes';
  botonPendientes.classList.toggle('btn-pendientes--vacio', totalPendientes === 0);
  botonPendientes.disabled = ocupado || totalPendientes === 0 || !navigator.onLine;
  botonPendientes.setAttribute('aria-busy', String(ocupado));
  botonPendientes.title = !navigator.onLine ? 'Sin conexión' : totalPendientes === 0 ? 'No hay pendientes' : '';
}

function avisoEnvio(texto, tipo) {
  let aviso = document.getElementById('aviso-envio');
  if (!aviso) {
    aviso = document.createElement('div');
    aviso.id = 'aviso-envio';
    aviso.setAttribute('role', 'status');
    document.body.append(aviso);
  }
  aviso.className = `aviso aviso--${tipo} aviso-envio`;
  aviso.textContent = texto;
  clearTimeout(aviso.temporizador);
  aviso.temporizador = setTimeout(() => aviso.remove(), tipo === 'exito' ? 4000 : 10000);
}

async function enviarDesdeBarra({ automatico = false } = {}) {
  if (enviando() || !navigator.onLine) return;
  if (automatico && totalPendientes === 0) return;
  const promesa = enviarTodoLoPendiente();
  pintarBotonPendientes();
  try {
    const resumen = await promesa;
    if (resumen.estado === 'sin_red') {
      if (!automatico) avisoEnvio('Sin conexión con el servidor. Lo pendiente sigue guardado en el teléfono.', 'aviso');
      return;
    }
    const rechazos = resumen.errores.filter((e) => !e.reintentable).map((e) => e.motivo);
    const texto = textoResumen(resumen) + (rechazos.length ? `. Motivo: ${rechazos.join(' · ')}` : '.');
    if (!automatico || resumen.enviados || resumen.fallidos) avisoEnvio(texto, resumen.fallidos ? 'error' : 'exito');
    window.dispatchEvent(new CustomEvent('nido:envio-terminado', { detail: resumen }));
  } catch (err) {
    console.error('No se pudieron enviar los pendientes:', err);
    avisoEnvio('No se pudieron enviar los pendientes. Intenta de nuevo.', 'error');
  } finally {
    pintarBotonPendientes();
  }
}

function montarBotonPendientes() {
  const acciones = document.querySelector('.barra .barra__acciones');
  if (!acciones || botonPendientes) return;
  botonPendientes = document.createElement('button');
  botonPendientes.type = 'button';
  botonPendientes.className = 'btn btn--secundario btn--pequeno btn-pendientes';
  botonPendientes.innerHTML = '<span data-texto>Enviar pendientes</span> <span class="btn-pendientes__total" data-total aria-label="pendientes">0</span>';
  botonPendientes.addEventListener('click', () => enviarDesdeBarra());
  acciones.prepend(botonPendientes);
  window.addEventListener('nido:pendientes', (evento) => {
    totalPendientes = evento.detail.total;
    pintarBotonPendientes();
  });
  window.addEventListener('nido:perdidas-actualizadas', () => avisarPendientes());
  window.addEventListener('online', pintarBotonPendientes);
  window.addEventListener('offline', pintarBotonPendientes);
  // Al volver a la pestaña (o con el botón Atrás del navegador) se recuenta.
  window.addEventListener('pageshow', () => avisarPendientes().catch(() => {}));
  avisarPendientes().catch((err) => console.warn('No se pudieron contar los pendientes:', err));
}
