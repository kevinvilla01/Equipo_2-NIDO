# NIDO_pwa

[![Deploy](https://github.com/kevinvilla01/Equipo_2-NIDO/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/kevinvilla01/Equipo_2-NIDO/actions/workflows/deploy.yml)

Proyecto NIDO - Campamentos Tortugueros para 10.- CUatrimestre de la Ing. Entornos VIrtuales y Negocios DIgitales (UTBB)

## Equipo y módulos

| Módulo | Tablas | Responsable | Rama |
|---|---|---|---|
| Módulo 1 · Patrullajes | `patrullajes`, `patrullaje_voluntario` | Diego ([@yxyossj](https://github.com/yxyossj)) | `diego` |
| Módulo 2 · Nidos | `nidos` + flujo de estados | Kevin ([@kevinvilla01](https://github.com/kevinvilla01)) | `kevin` |
| Módulo 3 · Liberaciones y catálogos | `liberaciones`, `tramos`, `especies`, `usuarios` (incluye autenticación y permisos) | Luis Carlos Martínez Castillo ([@LoqCortt](https://github.com/LoqCortt)) | `luis` |

## Flujo de trabajo

- Cada quien trabaja solo en su rama (`kevin`, `luis`, `diego`).
- Los cambios entran a `develop` por Pull Request; `develop` pasa a `main` solo en hitos estables.
- Una historia está terminada cuando cumple la [Definition of Done](docs/definition-of-done.md).

## App en producción

**https://nido.klkdigitalvallarta.com**

Se despliega automáticamente con cada push a `main` mediante el workflow [Deploy](.github/workflows/deploy.yml) (Vercel CLI). Vercel no despliega por su cuenta: `vercel.json` desactiva los despliegues automáticos desde Git.

## Ver la app en local

### a) Sin Node

1. Descarga el repositorio: `git clone https://github.com/kevinvilla01/Equipo_2-NIDO.git` o, en GitHub, **Code → Download ZIP** y descomprímelo.
2. Desde la carpeta del proyecto, levanta un servidor estático sobre `src/`:

   ```bash
   python3 -m http.server 8080 -d src     # macOS / Linux
   python -m http.server 8080 -d src      # Windows
   ```

3. Abre **http://localhost:8080**.

Alternativa: VS Code con la extensión **Live Server**, agregando en `.vscode/settings.json`:

```json
{ "liveServer.settings.root": "/src" }
```

### b) Con Node

```bash
npm run build                          # genera dist/ (sin variables de entorno usa src/config.js)
python3 -m http.server 8080 -d dist    # o cualquier servidor estático sobre dist/
```

### Avisos

- **No abras los `.html` con doble clic.** Con `file://` el navegador bloquea los módulos de JavaScript y el service worker; siempre usa un servidor.
- Si el puerto 8080 está ocupado, usa otro (por ejemplo `8081`) y abre esa dirección.
- Si ves una versión vieja, recarga con **Ctrl+Shift+R** (Cmd+Shift+R en macOS): el service worker guarda copias en caché.

## Variables de entorno

| Variable | Dónde vive | Uso |
|---|---|---|
| `SUPABASE_URL` | `src/config.js`, Vercel y GitHub Secrets | URL del proyecto de Supabase. Es pública: está en `src/config.js`; en producción el build la sobrescribe en `dist/config.js` con la de Vercel. |
| `SUPABASE_ANON_KEY` | `src/config.js`, Vercel y GitHub Secrets | Publishable (anon) key de Supabase. Es pública por diseño (está en `src/config.js`); la protección real de los datos la dan las políticas RLS. En producción el build la sobrescribe con la de Vercel. |
| `VERCEL_TOKEN` | GitHub Secrets | Token para que el workflow despliegue con el CLI de Vercel. |
| `VERCEL_ORG_ID` | GitHub Secrets | ID del equipo/cuenta en Vercel. |
| `VERCEL_PROJECT_ID` | GitHub Secrets | ID del proyecto en Vercel. |

- La URL y la anon key de Supabase están en `src/config.js` porque son públicas; así la app funciona con un servidor estático sin Node. `npm run build` las sobrescribe en `dist/config.js` si existen las variables de entorno (en Vercel, las suyas); si no, usa `src/config.js` y lo avisa en consola.
- Los tokens de Vercel no se guardan en el repositorio. `.env.example` solo lista los nombres; `.env.local` está ignorado por git.
- La **secret / `service_role` key** de Supabase **nunca** va en el frontend ni en el repositorio: salta las políticas RLS y da acceso total a la base de datos.
