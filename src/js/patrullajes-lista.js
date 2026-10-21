import { supabase } from './supabase.js';

const listEl = document.getElementById('patrol-list');

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
  const badgeClase = finalizado ? 'badge badge-completado' : 'badge';

const Voluntarios = (patrullaje_voluntario ?? [])
  .map(v => v.usuarios?.nombre)
  .filter(Boolean)
  .join(', ') || 'Sin voluntarios';

  const syncIcon = pendiente_envio
    ? `<span class="sync-status sync-pending">
         <svg viewBox="0 0 24 24" class="icon-clock"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
         Pendiente
       </span>`
    : `<span class="sync-status">
         <svg viewBox="0 0 24 24" class="icon-check"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
         Sincronizado
       </span>`;

  return `
  <a href="finalizar_patrullaje.html?id=${id}" class="card-link">
    <article class="card">
        <div class="card-head">
          <h2>${titulo}</h2>
          <span class="${badgeClase}"><span class="dot"></span>${badgeTexto}</span>
        </div>
        <dl class="details">
          <div><dt>Tramo</dt><dd>${nombreTramo}</dd></div>
          <div><dt>Hora de inicio</dt><dd>${hora_inicio.slice(0, 5)}</dd></div>
          <div><dt>Hora de fin</dt><dd>${finTexto}</dd></div>
          <div><dt>Observaciones</dt><dd>${obsTexto}</dd></div>
          <div><dt>Voluntarios</dt><dd>${Voluntarios}</dd></div>

        </dl>
        <hr>
        <div class="card-foot">
          <span class="timestamp">${formatFecha(fecha)}</span>
          ${syncIcon}
        </div>
      </article>
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

  if (error) {
    console.error(error);
    listEl.innerHTML = `<p class="state-msg">No se pudieron cargar los patrullajes.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = `<p class="state-msg">Aún no hay patrullajes registrados.</p>`;
    return;
  }

  listEl.innerHTML = data.map(crearTarjeta).join('');
}

  cargarPatrullajes();


