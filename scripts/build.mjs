// Copia src/ a dist/ y genera dist/config.js con las variables públicas de Supabase.
// Sin variables de entorno se queda el src/config.js copiado (valores públicos del repo).
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = `${root}src`;
const distDir = `${root}dist`;

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = REQUIRED.filter((name) => !process.env[name]);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });

if (missing.length > 0) {
  console.warn(`Aviso: faltan variables de entorno: ${missing.join(', ')}. Se usa src/config.js.`);
  console.warn('En Vercel defínelas en Settings → Environment Variables para usar las suyas.');
} else {
  const config = {
    SUPABASE_URL: process.env.SUPABASE_URL.replace(/\/+$/, ''),
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  await writeFile(`${distDir}/config.js`, `window.NIDO_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
}

console.log('Build listo en dist/');
