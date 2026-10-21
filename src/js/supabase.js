// Cliente único de Supabase para toda la app.
// La página debe cargar antes /config.js (lo genera el build) y /vendor/supabase.js (supabase-js 2.117.2, UMD).
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.NIDO_CONFIG;

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
