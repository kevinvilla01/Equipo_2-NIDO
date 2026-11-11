// Revisa la sintaxis de todo el JavaScript con `node --check`, sin dependencias.
// Incluye los <script type="module"> escritos dentro de los .html.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CARPETAS = ['src', 'scripts', 'tests'];
// Código de terceros ya minificado.
const IGNORAR = [join('src', 'vendor')];

async function archivos(carpeta) {
  const entradas = await readdir(join(root, carpeta), { withFileTypes: true });
  const rutas = await Promise.all(entradas.map((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (IGNORAR.includes(ruta)) return [];
    return entrada.isDirectory() ? archivos(ruta) : [ruta];
  }));
  return rutas.flat();
}

function revisar(ruta, nombre = ruta) {
  try {
    execFileSync(process.execPath, ['--check', ruta], { stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error(`✗ ${nombre}\n${err.stderr.toString()}`);
    return false;
  }
}

const todos = (await Promise.all(CARPETAS.map(archivos))).flat();
const temporal = await mkdtemp(join(tmpdir(), 'nido-lint-'));
let errores = 0;
let revisados = 0;

try {
  for (const ruta of todos) {
    if (/\.(m?js)$/.test(ruta)) {
      revisados += 1;
      if (!revisar(join(root, ruta), ruta)) errores += 1;
    } else if (ruta.endsWith('.html')) {
      const html = await readFile(join(root, ruta), 'utf8');
      const bloques = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
      for (const [indice, [, codigo]] of bloques.entries()) {
        const copia = join(temporal, `${relative('src', ruta).replaceAll('/', '_')}.${indice}.mjs`);
        await writeFile(copia, codigo);
        revisados += 1;
        if (!revisar(copia, `${ruta} (script ${indice + 1})`)) errores += 1;
      }
    }
  }
} finally {
  await rm(temporal, { recursive: true, force: true });
}

if (errores > 0) {
  console.error(`${errores} de ${revisados} scripts con errores de sintaxis.`);
  process.exit(1);
}
console.log(`Lint OK: ${revisados} scripts sin errores de sintaxis.`);
