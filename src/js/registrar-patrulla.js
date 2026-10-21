import { supabase } from './supabase.js';

async function registrarPatrullaje() {

  const horaInicio = document.getElementById('hora-inicio').value;
  const tramoId = document.getElementById('tramo').value;
  const Fecha = document.getElementById('fecha').value;
  const voluntariosIds = obtenerVoluntariosSeleccionados();

  if (!Fecha || !horaInicio || !tramoId) {
    alert('Completa la fecha, la hora de inicio y el tramo');
    return;
  }

  if (voluntariosIds.length === 0) {
    alert('Selecciona al menos un voluntario');
    return;
  }

  const { data, error } = await supabase
    .from('patrullajes')
    .insert({
      fecha: Fecha,
      hora_inicio: horaInicio,
      tramo_id: tramoId
    })
      .select()
      .single();

  if (error) {
    console.error(error);
    alert ('No se pudo insertar el patrullaje');
    return;
  }

  const patrullajeId = data.id;

  const filas = voluntariosIds.map(usuarioId => ({
    patrullaje_id: patrullajeId,
    usuario_id: usuarioId
  }));

console.log('filas a insertar:', filas);


    const { error: errorVoluntarios } = await supabase
    .from('patrullaje_voluntario')
    .insert(filas);

  if (errorVoluntarios) {
    console.error(errorVoluntarios);
    alert('El patrullaje se guardó, pero no se pudieron asociar los voluntarios: ' + errorVoluntarios.message);
    return;
  }
 
    alert ('Patrullaje guardado coan éxito');
    window.location.href = 'patrullajes.html';

}


async function cargarVoluntarios() {

    console.log('cargarVoluntarios se ejecutó');

  const {data, error} = await supabase
  .from('usuarios')
  .select('id, nombre')
  .order('nombre');


if (error){
  console.error(error);
  return;
}

  const contenedor = document.getElementById('voluntarios-list');
  contenedor.innerHTML = data.map(u => `
    <label class="checkbox-item">
      <input type="checkbox" value="${u.id}" name="voluntario">
      ${u.nombre}
    </label>
  `).join('');
}

cargarVoluntarios();

function obtenerVoluntariosSeleccionados(){
  const checkboxes = document.querySelectorAll('input[name="voluntario"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}




async function cargarTramos() {


  const { data, error } = await supabase
    .from('tramos')
    .select('id, nombre')
    .order('nombre');

  if (error) {
    console.error(error);
    return;
  }

  const selectEl = document.getElementById('tramo');
  selectEl.innerHTML =
    '<option value="">Selecciona un tramo</option>' +
    data.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
}
cargarTramos();

const hoy = new Date();
document.getElementById('fecha').value =
  `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;


document.getElementById('btn-guardar').addEventListener('click', registrarPatrullaje);
    
