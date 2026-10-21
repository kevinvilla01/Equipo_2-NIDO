import { supabase } from './supabase.js';

const params = new URLSearchParams(window.location.search);
const patrullajeId = params.get('id');

if (!patrullajeId) {
    alert ('No se indicó el patrullaje a abrir');
    window.location.href = 'patrullajes.html';
}

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
    return;
  }

  const voluntarios = (data.patrullaje_voluntario ?? [])
    .map(v => v.usuarios?.nombre)
    .filter(Boolean)
    .join(', ') || 'Sin voluntarios';

    document.getElementById('d-fecha').textContent = data.fecha;
    document.getElementById('d-tramo').textContent = data.tramo_id?.nombre ?? 'Sin tramo asignado';
    document.getElementById('d-voluntarios').textContent = voluntarios;
    document.getElementById('d-inicio').textContent = data.hora_inicio.slice(0, 5);

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



document.getElementById('btn-eliminar').addEventListener('click', eliminarPatrullaje);

cargarDetalle();


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

const { data, error } = await supabase
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

      alert ('Patrullaje finalizado coan éxito');
    window.location.href = 'patrullajes.html';


  }
  document.getElementById('btn-finalizar').addEventListener('click', finalizarPatrullaje);
