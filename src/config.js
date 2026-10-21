// Configuración pública de Supabase para ver la app sin Node (servidor estático sobre src/).
// La anon/publishable key es pública por diseño: la protección real de los datos son las políticas RLS.
// La service_role key NUNCA va aquí ni en ningún otro archivo del repo.
// En producción, scripts/build.mjs sobrescribe dist/config.js con las variables de Vercel.
window.NIDO_CONFIG = {
  "SUPABASE_URL": "https://gnjwxvaqyajxddchzjnw.supabase.co",
  "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imduand4dmFxeWFqeGRkY2h6am53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTcxOTAsImV4cCI6MjEwNTY5MzE5MH0.yX6BazCEgXKohynuSiE_VMAWVGojfxa5_UA5SelLnik"
};
