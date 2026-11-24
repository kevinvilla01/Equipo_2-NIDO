import { supabase } from './supabase.js';

const listEl = document.getElementById('patrol-list');
const listElCompleted = document.getElementById('patrol-list-completed');

const buscarEl = document.getElementById('buscar-tramo');
const fechaEl = document.getElementById('filtro-fecha');
const limpiarEl = document.getElementById('limpiar-filtros');

let completados = [];


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

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);

  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');

  return `${anio}-${mes}-${dia}`;
}

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

function normalizar(texto) {
  return (texto ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function filtrarPatrullajes(lista) {
  const texto = normalizar(buscarEl.value.trim());
  const fecha = fechaEl.value;

  const sinFiltros = !texto && !fecha;
  if (sinFiltros) {
    const limite = fechaHaceDias(6);
    return lista.filter(p => p.fecha >= limite);
  }

  return lista.filter(p => {
    const coincideTramo = !texto || normalizar(p.tramo_id?.nombre).includes(texto);
    const coincideFecha = !fecha || p.fecha === fecha;
    return coincideTramo && coincideFecha;
  });
}

function pintarCompletados() {
  const resultados = filtrarPatrullajes(completados);
  const hayFiltros = buscarEl.value.trim() || fechaEl.value;

  const mensajeVacio = hayFiltros
    ? 'No se encontraron patrullajes que coincidan con los filtros.'
    : 'No hay patrullajes completados en los últimos 7 días.';

  listElCompleted.innerHTML = resultados.length
    ? resultados.map(crearTarjeta).join('')
    : `<p class="state-msg">${mensajeVacio}</p>`;
}


async function cargarPatrullajesCreados() {
  const { data, error } = await supabase
    .from('patrullajes')
    .select(`
      id, fecha, hora_inicio, hora_fin, marea, fase_lunar, clima,
      observaciones, pendiente_envio, creado_en, finalizado,
      tramo_id:tramos ( nombre ),
      patrullaje_voluntario ( usuarios ( nombre ) )

    `)
    .eq('finalizado', false)
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

async function cargarPatrullajesCompletados() {
  const { data, error } = await supabase
    .from('patrullajes')
    .select(`
      id, fecha, hora_inicio, hora_fin, marea, fase_lunar, clima,
      observaciones, pendiente_envio, creado_en, finalizado,
      tramo_id:tramos ( nombre ),
      patrullaje_voluntario ( usuarios ( nombre ) )

    `)
    .eq('finalizado', true)
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

  completados = data;
  pintarCompletados();
}

buscarEl.addEventListener('input', pintarCompletados);
fechaEl.addEventListener('change', pintarCompletados);

limpiarEl.addEventListener('click', () => {
  buscarEl.value = '';
  fechaEl.value = '';
  pintarCompletados();
});

  cargarPatrullajesCreados();
  cargarPatrullajesCompletados();


