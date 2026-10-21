import { supabase } from '/js/supabase.js';

const avisoFormulario = document.getElementById('aviso-formulario');

function mostrarAviso(mensaje) {
  avisoFormulario.textContent = mensaje;
  avisoFormulario.classList.remove('oculto');
  avisoFormulario.scrollIntoView({ block: 'center' });
}

// Mensaje cuando una consulta falla: con o sin señal, dice qué hacer en vez de dejar la lista vacía.
function mensajeSinDatos(que) {
  return navigator.onLine
    ? `No se pudieron cargar ${que}. Intenta de nuevo en un momento.`
    : `No se pudieron cargar ${que} porque no hay señal. Vuelve a abrir esta pantalla con conexión.`;
}

async function registrarPatrullaje() {

  const horaInicio = document.getElementById('hora-inicio').value;
  const tramoId = document.getElementById('tramo').value;
  const Fecha = document.getElementById('fecha').value;
  const voluntariosIds = obtenerVoluntariosSeleccionados();

  avisoFormulario.classList.add('oculto');

  if (!Fecha || !horaInicio || !tramoId) {
    mostrarAviso('Completa la fecha, la hora de inicio y el tramo.');
    return;
  }

  if (voluntariosIds.length === 0) {
    mostrarAviso('Selecciona al menos un voluntario.');
    return;
  }

  const btnGuardar = document.getElementById('btn-guardar');
  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando…';

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
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar patrullaje';
    mostrarAviso(navigator.onLine
      ? 'No se pudo guardar el patrullaje. Intenta de nuevo.'
      : 'No se pudo guardar el patrullaje porque no hay señal. Intenta de nuevo con conexión.');
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
    // El patrullaje ya existe: el botón queda deshabilitado para no duplicarlo.
    btnGuardar.textContent = 'Patrullaje guardado';
    mostrarAviso('El patrullaje se guardó, pero no se pudieron asociar los voluntarios: ' + errorVoluntarios.message);
    return;
  }

    window.location.href = '/patrullajes.html?aviso=registrado';

}


async function cargarVoluntarios() {

    console.log('cargarVoluntarios se ejecutó');

  const {data, error} = await supabase
  .from('usuarios')
  .select('id, nombre')
  .order('nombre');


  const contenedor = document.getElementById('voluntarios-list');

if (error){
  console.error(error);
  contenedor.innerHTML = `<p class="campo__error">${mensajeSinDatos('los voluntarios')}</p>`;
  return;
}

  if (data.length === 0) {
    contenedor.innerHTML = '<p class="tenue pequeno mb-0">No hay voluntarios registrados.</p>';
    return;
  }

  contenedor.innerHTML = data.map(u => `
    <label class="opcion">
      <input type="checkbox" value="${u.id}" name="voluntario">
      <span></span>
    </label>
  `).join('');
  // El nombre se pone como texto para no interpretar HTML que venga de la base de datos.
  contenedor.querySelectorAll('.opcion span').forEach((span, i) => { span.textContent = data[i].nombre; });
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

  const selectEl = document.getElementById('tramo');

  if (error) {
    console.error(error);
    selectEl.innerHTML = '<option value="">Sin tramos disponibles</option>';
    mostrarAviso(mensajeSinDatos('los tramos'));
    return;
  }

  selectEl.innerHTML = '<option value="">Selecciona un tramo</option>';
  data.forEach(t => selectEl.add(new Option(t.nombre, t.id)));
}
cargarTramos();

const hoy = new Date();
document.getElementById('fecha').value =
  `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;


document.getElementById('btn-guardar').addEventListener('click', registrarPatrullaje);
    
