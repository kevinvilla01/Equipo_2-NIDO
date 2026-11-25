import { supabase } from './supabase.js';

const params = new URLSearchParams(window.location.search);
const patrullajeId = params.get('id');

if (!patrullajeId) {
    alert ('No se indicó el patrullaje a abrir');
    window.location.href = 'patrullajes.html';
}

const contenidoEl = document.getElementById('contenido-patrullaje');

async function cargarDetalle() {
    
    const {data, error} = await supabase
    .from('patrullajes')
    .select(`
        id, 
        fecha, 
        hora_inicio, 
        tramo_id:tramos ( nombre ), 
        patrullaje_voluntario ( usuarios ( nombre ) )`)
    .eq('id', patrullajeId)
    .single();

      if (error) {
    console.error(error);
    alert('No se pudo cargar el patrullaje');
        contenidoEl.innerHTML = `<p class="state-msg">No se pudo cargar el patrullaje.</p>`;
    return false;
      }


  contenidoEl.querySelector('.state-msg')?.remove();
      
      contenidoEl.insertAdjacentHTML('beforeend', `
            <section class="summary-card" id="detalle-patrullaje">
          <div class="summary-row">
            <span class="summary-label">Fecha</span>
            <span class="summary-value"id="d-fecha"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Hora de inicio</span>
            <span class="summary-value" id="d-inicio"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Tramo</span>
            <span class="summary-value" id="d-tramo"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Voluntarios</span>
            <span class="summary-value" id="d-voluntarios"></span>
          </div>
        </section>
    `);
  

  const voluntarios = (data.patrullaje_voluntario ?? [])
    .map(v => v.usuarios?.nombre)
    .filter(Boolean)
    .join(', ') || 'Sin voluntarios';

    document.getElementById('d-fecha').textContent = data.fecha;
    document.getElementById('d-tramo').textContent = data.tramo_id?.nombre ?? 'Sin tramo asignado';
    document.getElementById('d-voluntarios').textContent = voluntarios;
    document.getElementById('d-inicio').textContent = data.hora_inicio.slice(0, 5);

      return true;
}


async function cargarCierre() {

  const { data, error  } = await supabase
    .from('patrullajes')
    .select(`
      id, hora_fin, marea, fase_lunar, clima,
      observaciones, pendiente_envio, creado_en, finalizado`)
    .eq('id', patrullajeId)
    .single();

  if (error) {
    console.error(error);
    alert('No se pudieron cargar los datos de cierre');
    return;
  }

  if (data.finalizado === true) {
    document.getElementById('detalle-patrullaje').insertAdjacentHTML ('beforeend', `          
          <div class="summary-row">
            <span class="summary-label">Hora de finalización</span>
            <span class="summary-value"id="d-hora-fin"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Marea</span>
            <span class="summary-value" id="d-marea"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Fase lunar</span>
            <span class="summary-value" id="d-fase-lunar"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Clima</span>
            <span class="summary-value" id="d-clima"></span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Observaciones</span>
            <span class="summary-value" id="d-observaciones"></span>
          </div>`);

              document.getElementById('d-hora-fin').textContent = data.hora_fin ? data.hora_fin.slice(0, 5) : '-';
    document.getElementById('d-marea').textContent = data.marea ?? '-';
    document.getElementById('d-fase-lunar').textContent = data.fase_lunar ?? '-';
    document.getElementById('d-clima').textContent = data.clima ?? '-';
    document.getElementById('d-observaciones').textContent = data.observaciones || 'Sin novedades';

const elementos = document.querySelectorAll('.summary-row');

elementos.forEach(elemento => {
  elemento.classList.replace('summary-row', 'summary-row-completed');
});

    return;
  }

  contenidoEl.insertAdjacentHTML ('beforeend', `
          <h2 class="section-title">Datos de cierre</h2>

        <form class="form-fields">

          <div class="field">
            <label for="hora-fin">Hora de fin</label>
            <input type="time" id="hora-fin">
          </div>

          <div class="field">
            <label for="marea">Marea</label>
            <div class="select-wrap">
              <select id="marea">
                <option value="" disabled selected>Selecciona una opción</option>
                <option>Baja</option>
                <option>Media</option>
                <option>Alta</option>
              </select>
              <svg viewBox="0 0 24 24" class="icon-chevron"><path d="M6 9l6 6 6-6" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>

          <div class="field">
            <label for="fase-lunar">Fase lunar</label>
            <div class="select-wrap">
              <select id="fase-lunar">
                <option value="" disabled selected>Selecciona una opción</option>
                <option>Luna nueva</option>
                <option>Luna creciente</option>
                <option>Cuarto creciente</option>
                <option>Gibosa creciente</option>
                <option>Luna llena</option>
                <option>Gibosa menguante</option>
                <option>Cuarto menguante</option>
                <option>Menguante</option>
              </select>
              <svg viewBox="0 0 24 24" class="icon-chevron"><path d="M6 9l6 6 6-6" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>

          <div class="field">
            <label for="clima">Clima</label>
            <div class="select-wrap">
              <select id="clima">
                <option value="" disabled selected>Selecciona una opción</option>
                <option>Despejado</option>
                <option>Nublado</option>
                <option>Lluvioso</option>
                <option>Ventoso</option>
              </select>
              <svg viewBox="0 0 24 24" class="icon-chevron"><path d="M6 9l6 6 6-6" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>

          <div class="field">
            <label for="observaciones">Observaciones</label>
            <textarea id="observaciones" rows="4" placeholder="Escribe cualquier novedad del recorrido..."></textarea>
          </div>

        </form>

      


  `)
  const btnFinalizar = document.getElementById('botones');
  btnFinalizar.insertAdjacentHTML('afterbegin', `
 <button class="cta" id="btn-finalizar">Finalizar</button>

  `);

      const ahorita = new Date();
    const horaEl = document.getElementById('hora-fin');
    horaEl.value = `${String(ahorita.getHours()).padStart(2, '0')}:${String(ahorita.getMinutes()).padStart(2, '0')}`;

      document.getElementById('btn-finalizar').addEventListener('click', finalizarPatrullaje);
}
  
async function finalizarPatrullaje(){

  const horaFin = document.getElementById('hora-fin').value;
  const Marea = document.getElementById('marea').value;
  const faseLunar = document.getElementById('fase-lunar').value;
  const Clima = document.getElementById('clima').value;
  const Observaciones = document.getElementById('observaciones').value;

        if (!horaFin || !Marea || !faseLunar || !Clima || !Observaciones) {
    alert('Completa la todos los apartados para finalizar el patrullaje');
    return;
  }

  if (horaFin <= horaInicio) {
    alert(`La hora de fin debe ser posterior a la hora de inicio (${horaInicio}).`);
    return;
  }

const { data, error} = await supabase
    .from('patrullajes')
    .update({
      hora_fin: horaFin || null,
      marea: Marea || null,
      fase_lunar: faseLunar || null,
      clima: Clima || null,
      observaciones: Observaciones || null,
      finalizado: true
    })
    .eq('id', patrullajeId)
      .single();

        if (error) {
    console.error(error);
    alert ('No se pudo finalizar el patrullaje');
    return;
  }

    if (!data || data.length === 0) {
    alert('No se actualizó ningún registro (revisa la política de UPDATE)');
    return;
  }

      alert ('Patrullaje finalizado coan éxito');
    window.location.href = 'patrullajes.html';
  }

async function eliminarPatrullaje() {
  if (!confirm('¿Seguro que quieres eliminar este patrullaje? No se puede deshacer.')) return;

  const { error: errorVol } = await supabase
    .from('patrullaje_voluntario')
    .delete()
    .eq('patrullaje_id', patrullajeId);

  if (errorVol) {
    console.error(errorVol);
    alert('No se pudieron borrar los voluntarios: ' + errorVol.message);
    return;
  }

  const { data, error } = await supabase
    .from('patrullajes')
    .delete()
    .eq('id', patrullajeId)
    .select();

  if (error) {
    console.error(error);
    alert('No se pudo eliminar: ' + error.message);
    return;
  }

  if (!data || data.length === 0) {
    alert('No se eliminó ningún registro (revisa las políticas de DELETE)');
    return;
  }

  alert('Patrullaje eliminado');
  window.location.href = 'patrullajes.html';
}

document.getElementById('btn-eliminar')?.addEventListener('click', eliminarPatrullaje);

// Punto de entrada: primero el resumen, y cuando termina, el cierre
async function iniciar() {
  const ok = await cargarDetalle();
  if (ok) await cargarCierre();
}

iniciar();




