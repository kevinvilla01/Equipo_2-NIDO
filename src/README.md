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

## Variables de entorno

| Variable | Dónde vive | Uso |
|---|---|---|
| `SUPABASE_URL` | Vercel y GitHub Secrets | URL del proyecto de Supabase. Se inyecta en `dist/config.js` durante el build. |
| `SUPABASE_ANON_KEY` | Vercel y GitHub Secrets | Publishable (anon) key de Supabase. Es pública por diseño; la protección real de los datos la dan las políticas RLS. |
| `VERCEL_TOKEN` | GitHub Secrets | Token para que el workflow despliegue con el CLI de Vercel. |
| `VERCEL_ORG_ID` | GitHub Secrets | ID del equipo/cuenta en Vercel. |
| `VERCEL_PROJECT_ID` | GitHub Secrets | ID del proyecto en Vercel. |

- Ningún valor se guarda en el repositorio. `.env.example` solo lista los nombres; para probar en local, crea un `.env.local` (ignorado por git) o exporta las variables antes de `npm run build`.
- La **secret / `service_role` key** de Supabase **nunca** va en el frontend ni en el repositorio: salta las políticas RLS y da acceso total a la base de datos.
