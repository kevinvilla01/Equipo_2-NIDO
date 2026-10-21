import { supabase } from '/js/supabase.js';

const params = new URLSearchParams(window.location.search);
const patrullajeId = params.get('id');

const avisoFormulario = document.getElementById('aviso-formulario');
const btnFinalizar = document.getElementById('btn-finalizar');
const btnEliminar = document.getElementById('btn-eliminar');
const dialogo = document.getElementById('dialogo-eliminar');
const btnDialogoConfirmar = document.getElementById('btn-dialogo-confirmar');

function mostrarAviso(mensaje) {
  avisoFormulario.textContent = mensaje;
  avisoFormulario.classList.remove('oculto');
  avisoFormulario.scrollIntoView({ block: 'center' });
}

function limpiarAviso() {
  avisoFormulario.classList.add('oculto');
}

function motivo(accion) {
  return navigator.onLine
    ? `No se pudo ${accion}. Intenta de nuevo.`
    : `No se pudo ${accion} porque no hay señal. Intenta de nuevo con conexión.`;
}

if (!patrullajeId) {
  mostrarAviso('No se indicó el patrullaje a abrir. Vuelve a la lista y elige uno.');
  btnFinalizar.disabled = true;
  btnEliminar.disabled = true;
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
    mostrarAviso(motivo('cargar el patrullaje'));
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
  dialogo.close();
  limpiarAviso();

    const { error: errorVol } = await supabase
    .from('patrullaje_voluntario')
    .delete()
    .eq('patrullaje_id', patrullajeId);

      if (errorVol) {
    console.error(errorVol);
    mostrarAviso(navigator.onLine
      ? 'No se pudieron borrar los voluntarios: ' + errorVol.message
      : motivo('eliminar el patrullaje'));
    return;
  }

    const { data, error } = await supabase
    .from('patrullajes')
    .delete()
    .eq('id', patrullajeId)
    .select();

  if (error) {
    console.error(error);
    mostrarAviso(navigator.onLine ? 'No se pudo eliminar: ' + error.message : motivo('eliminar el patrullaje'));
    return;
  }

  if (!data || data.length === 0) {
    mostrarAviso('No se eliminó ningún registro (revisa las políticas de DELETE).');
    return;
  }

  window.location.href = '/patrullajes.html?aviso=eliminado';
}



btnEliminar.addEventListener('click', () => dialogo.showModal());
document.getElementById('btn-dialogo-volver').addEventListener('click', () => dialogo.close());
btnDialogoConfirmar.addEventListener('click', eliminarPatrullaje);

if (patrullajeId) cargarDetalle();


async function finalizarPatrullaje(){

  const horaFin = document.getElementById('hora-fin').value;
  const Marea = document.getElementById('marea').value;
  const faseLunar = document.getElementById('fase-lunar').value;
  const Clima = document.getElementById('clima').value;
  const Observaciones = document.getElementById('observaciones').value;

  limpiarAviso();

    if (!horaFin || !Marea || !faseLunar || !Clima || !Observaciones) {
    mostrarAviso('Completa todos los apartados para finalizar el patrullaje.');
    return;
  }

  btnFinalizar.disabled = true;
  btnFinalizar.textContent = 'Finalizando…';

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
      .select()
      .single();

        if (error) {
    console.error(error);
    btnFinalizar.disabled = false;
    btnFinalizar.textContent = 'Finalizar patrullaje';
    mostrarAviso(motivo('finalizar el patrullaje'));
    return;
  }

    window.location.href = '/patrullajes.html?aviso=finalizado';


  }
  btnFinalizar.addEventListener('click', finalizarPatrullaje);
