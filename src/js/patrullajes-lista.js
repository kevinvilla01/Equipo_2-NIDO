import { supabase } from '/js/supabase.js';

const listEl = document.getElementById('patrol-list');

// Los textos vienen de la base de datos: se escapan antes de meterlos en innerHTML.
function escaparHTML(valor) {
  const div = document.createElement('div');
  div.textContent = valor;
  return div.innerHTML;
}

// Convierte "2026-09-26" -> "Ayer", "Hoy" o "26 sep"
function formatFecha(fechaStr) {
  const fecha = new Date(fechaStr + 'T00:00:00');
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);

  if (fecha.getTime() === hoy.getTime()) return 'Hoy';
  if (fecha.getTime() === ayer.getTime()) return 'Ayer';

  return fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

// Deriva un título simple según la hora de inicio
function tituloPorHora(horaInicio) {
  const hora = parseInt(horaInicio.split(':')[0], 10);
  const esNocturno = hora >= 19 || hora < 6;
  return esNocturno ? 'Patrullaje Nocturno' : 'Patrullaje Matutino';
}

function crearTarjeta(patrullaje) {
  const {
    id,
    tramo_id,
    fecha,
    hora_inicio,
    hora_fin,
    observaciones,
    pendiente_envio,
    patrullaje_voluntario,
    finalizado

  } = patrullaje;

  const nombreTramo = tramo_id?.nombre ?? 'Sin tramo asignado';
  const titulo = tituloPorHora(hora_inicio);
  const finTexto = hora_fin ? hora_fin.slice(0, 5) : 'En curso';
  const obsTexto = observaciones ? observaciones : 'Sin novedades';

  const badgeTexto = finalizado ? 'Completado' : 'Creado';
  const badgeClase = finalizado ? 'etiqueta etiqueta--completado' : 'etiqueta etiqueta--proceso';

const Voluntarios = (patrullaje_voluntario ?? [])
  .map(v => v.usuarios?.nombre)
  .filter(Boolean)
  .join(', ') || 'Sin voluntarios';

  const syncIcon = pendiente_envio
    ? `<span class="etiqueta etiqueta--pendiente">Pendiente</span>`
    : `<span class="estado-sync"><span aria-hidden="true">✓</span>Sincronizado</span>`;

  return `
    <a href="/finalizar-patrullaje.html?id=${id}" class="tarjeta tarjeta-enlace">
      <div class="fila entre mb-3">
        <h3 class="tarjeta__titulo">${titulo}</h3>
        <span class="${badgeClase}">${badgeTexto}</span>
      </div>
      <dl class="datos">
        <dt>Tramo</dt><dd>${escaparHTML(nombreTramo)}</dd>
        <dt>Hora de inicio</dt><dd>${hora_inicio.slice(0, 5)}</dd>
        <dt>Hora de fin</dt><dd>${finTexto}</dd>
        <dt>Observaciones</dt><dd>${escaparHTML(obsTexto)}</dd>
        <dt>Voluntarios</dt><dd>${escaparHTML(Voluntarios)}</dd>
      </dl>
      <div class="tarjeta__pie entre">
        <span class="tenue pequeno">${formatFecha(fecha)}</span>
        ${syncIcon}
      </div>
    </a>
  `;
}

async function cargarPatrullajes() {
  const { data, error } = await supabase
    .from('patrullajes')
    .select(`
      id, fecha, hora_inicio, hora_fin, marea, fase_lunar, clima,
      observaciones, pendiente_envio, creado_en, finalizado,
      tramo_id:tramos ( nombre ),
      patrullaje_voluntario ( usuarios ( nombre ) )

    `)
    .order('creado_en', { ascending: false });

  listEl.removeAttribute('aria-busy');

  if (error) {
    console.error(error);
    listEl.innerHTML = `
      <div class="estado-error">
        <p class="estado-error__titulo">No se pudieron cargar los patrullajes</p>
        <p class="estado-error__texto">
          ${navigator.onLine ? 'Hubo un problema al traer los datos.' : 'No hay señal en este momento.'}
          Revisa tu conexión e intenta de nuevo.
        </p>
        <button class="btn btn--secundario" type="button">Reintentar</button>
      </div>`;
    listEl.querySelector('button').addEventListener('click', cargarPatrullajes);
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio__icono" aria-hidden="true">🐢</div>
        <p class="estado-vacio__titulo">Aún no hay patrullajes registrados</p>
        <p class="estado-vacio__texto">Inicia el primero y aparecerá aquí con su tramo y voluntarios.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = data.map(crearTarjeta).join('');
}

// Mensaje que dejan registrar y finalizar al volver a la lista (?aviso=...)
const AVISOS = {
  registrado: 'Patrullaje guardado con éxito.',
  finalizado: 'Patrullaje finalizado con éxito.',
  eliminado: 'Patrullaje eliminado.',
};
const avisoResultado = document.getElementById('aviso-resultado');
const aviso = AVISOS[new URLSearchParams(window.location.search).get('aviso')];
if (aviso) {
  avisoResultado.textContent = aviso;
  avisoResultado.classList.remove('oculto');
  history.replaceState(null, '', '/patrullajes.html');
}

cargarPatrullajes();

