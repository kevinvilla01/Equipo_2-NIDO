// Copia src/ a dist/ y genera dist/config.js con las variables públicas de Supabase.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = `${root}src`;
const distDir = `${root}dist`;

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Error: faltan variables de entorno: ${missing.join(', ')}.`);
  console.error('Defínelas en Vercel (Settings → Environment Variables) o, en local, antes de `npm run build`.');
  process.exit(1);
}

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL.replace(/\/+$/, ''),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });
await writeFile(`${distDir}/config.js`, `window.NIDO_CONFIG = ${JSON.stringify(config, null, 2)};\n`);

console.log('Build listo en dist/');
