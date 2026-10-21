import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// --- Configura tus credenciales de Supabase ---
const SUPABASE_URL = 'https://gnjwxvaqyajxddchzjnw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imduand4dmFxeWFqeGRkY2h6am53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMTcxOTAsImV4cCI6MjEwNTY5MzE5MH0.yX6BazCEgXKohynuSiE_VMAWVGojfxa5_UA5SelLnik';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);