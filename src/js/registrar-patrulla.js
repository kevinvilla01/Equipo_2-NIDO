// HU-16: el patrullaje se guarda primero en el teléfono con su client_id y se envía con
// "Enviar pendientes" (registrar_patrullaje, idempotente). Tramos y voluntarios salen de
// la copia local de los catálogos (HU-13) cuando no hay señal.
import { cargarCatalogo } from '/js/catalogos.js';
import { guardarPatrullajeLocal } from '/js/db.js';
import { avisarPendientes, enviarPendientes } from '/js/envio-pendientes.js';
import { ESTADO_SYNC } from '/js/cola-envio.js';
import { generarUUID } from '/js/uuid.js';

// Texto de la base de datos (nombres, observaciones) dentro de plantillas HTML:
// se escapa para que no se interprete como HTML.
function escaparHTML(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function registrarPatrullaje() {

  const horaInicio = document.getElementById('hora-inicio').value;
  const tramoId = document.getElementById('tramo').value;
  const Fecha = document.getElementById('fecha').value;
  const voluntariosIds = obtenerVoluntariosSeleccionados();



  if (!Fecha || !horaInicio || !tramoId) {
    alert('Completa la fecha, la hora de inicio y el tramo');
    return;
  }

  const inicio = new Date(`${Fecha}T${horaInicio}:00`);
  const ahora = new Date();
  ahora.setSeconds(0, 0);

  if (inicio < ahora) {
    alert('La fecha y hora de inicio no pueden ser anteriores al momento actual.');
    return;
  }


  if (voluntariosIds.length === 0) {
    alert('Selecciona al menos un voluntario');
    return;
  }

  // client_id generado al crearlo, no al enviarlo: un reenvío no duplica el patrullaje.
  const patrullaje = {
    client_id: generarUUID(),
    fecha: Fecha,
    hora_inicio: horaInicio,
    tramo_id: Number(tramoId),
    voluntarios: voluntariosIds.map(Number),
    creado_en: new Date().toISOString(),
    sync: { estado: ESTADO_SYNC.PENDIENTE, intentos: 0, ultimo_error: null },
  };

  try {
    await guardarPatrullajeLocal(patrullaje);
  } catch (error) {
    console.error(error);
    alert('No se pudo guardar el patrullaje en el teléfono. Intenta de nuevo.');
    return;
  }
  await avisarPendientes().catch(() => {});

  // Con señal se intenta enviar ya (máx. 5 s); si no, queda en "Enviar pendientes".
  let enviado = false;
  if (navigator.onLine) {
    await Promise.race([
      enviarPendientes().then((r) => { enviado = r.estado === 'ok' && r.fallidos === 0; }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  alert(enviado ? 'Patrullaje guardado con éxito' : 'Patrullaje guardado en el teléfono. Queda pendiente de envío.');
    window.location.href = 'patrullajes.html';

}


async function cargarVoluntarios() {

    console.log('cargarVoluntarios se ejecutó');

  // Vista con solo id y nombre (directorio_usuarios); sin señal, la copia local.
  const data = (await cargarCatalogo('directorio_usuarios'))
    .filter((u) => u.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

  const contenedor = document.getElementById('voluntarios-list');
  contenedor.innerHTML = data.map(u => `
    <label class="checkbox-item">
      <input type="checkbox" value="${u.id}" name="voluntario">
      ${escaparHTML(u.nombre)}
    </label>
  `).join('');
}

cargarVoluntarios();

function obtenerVoluntariosSeleccionados(){
  const checkboxes = document.querySelectorAll('input[name="voluntario"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}




async function cargarTramos() {


  const data = (await cargarCatalogo('tramos'))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

  const selectEl = document.getElementById('tramo');
  selectEl.innerHTML =
    '<option value="">Selecciona un tramo</option>' +
    data.map(t => `<option value="${t.id}">${escaparHTML(t.nombre)}</option>`).join('');
}
cargarTramos();

const hoy = new Date();
const hoyTexto = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

const fechaEl = document.getElementById('fecha');
fechaEl.value = hoyTexto;
fechaEl.min = hoyTexto;

const ahorita = new Date();
const horaEl = document.getElementById('hora-inicio');
horaEl.value = `${String(ahorita.getHours()).padStart(2, '0')}:${String(ahorita.getMinutes()).padStart(2, '0')}`;





document.getElementById('btn-guardar').addEventListener('click', registrarPatrullaje);
    
