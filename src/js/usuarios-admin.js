// Cliente de la Edge Function usuarios-admin (supabase/functions/usuarios-admin).
// Altas, cambios y bajas de usuarios: el navegador nunca escribe public.usuarios ni
// toca Auth directo; la función verifica que quien llama sea coordinador.
import { supabase } from '/js/supabase.js';
import { conSesionVigente, ErrorSesion } from '/js/sesion.js';

export class ErrorAdmin extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo; // los de la función (correo_duplicado, no_coordinador, …) o 'red'
  }
}

// accion: 'crear' | 'actualizar' | 'eliminar'. Devuelve la fila de usuarios resultante.
export async function administrarUsuario(accion, datos) {
  try {
    return await conSesionVigente(async () => {
      const { data, error } = await supabase.functions.invoke('usuarios-admin', {
        body: { accion, ...datos },
      });
      if (!error) return data.usuario;

      // FunctionsHttpError trae la Response de la función con { error, codigo }.
      let detalle = null;
      try {
        detalle = await error.context?.json();
      } catch {
        // Sin cuerpo JSON: falla de red o CORS.
      }
      if (detalle?.error) throw new ErrorAdmin(detalle.codigo, detalle.error);
      throw new ErrorAdmin('red', 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
    });
  } catch (error) {
    // Los cambios de usuarios no se encolan: sin señal no se guardan.
    if (error instanceof ErrorSesion) {
      throw new ErrorAdmin(error.codigo, error.codigo === 'red'
        ? 'Necesitas señal para guardar cambios de usuarios.'
        : error.message);
    }
    throw error;
  }
}
