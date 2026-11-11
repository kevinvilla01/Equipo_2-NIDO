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

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm run build` | Copia `src/` a `dist/` y genera `dist/config.js` (necesita las variables de entorno). |
| `npm run lint` | Revisa la sintaxis de todo el JavaScript con `node --check`, incluidos los `<script type="module">` de los `.html`. Sin dependencias. |
| `npm test` | Pruebas unitarias con `node --test` (carpeta `tests/`). |

## Migraciones de base de datos

Los cambios al esquema de Supabase viven en `supabase/migrations/` y se corren **a mano**, completos, en Supabase → SQL Editor. Todas son re-ejecutables.

| Migración | HU | Qué hace |
|---|---|---|
| `20261110000000_hu10_reubicar_nido.sql` | HU-10 | `fecha_reubicacion`, `UNIQUE (clave)`, CHECKs de estado, trigger de la máquina de estados y RPC `reubicar_nido`. |

## Máquina de estados del nido

```
registrado ──► en_corral ──► eclosionado
     │             │
     └──► perdido ◄┘
```

`eclosionado` y `perdido` son finales. La tabla de transiciones está en dos lugares que deben coincidir:

- **Cliente:** `src/js/estados-nido.js` (`TRANSICIONES`, probado en `tests/estados-nido.test.js`).
- **Servidor:** trigger `nidos_validar_transicion` sobre `public.nidos`. Valida **cualquier** escritura (REST, RPC, SQL Editor, `service_role`): un nido solo puede insertarse como `registrado` y solo cambia de estado por una transición permitida. Al pasar a `en_corral` el servidor recalcula `fecha_estimada_eclosion = fecha_reubicacion + especies.dias_incubacion_estimados` e ignora la que mande el cliente.

### RPC `reubicar_nido` (contrato para HU-16)

La app no tiene permiso de `UPDATE` sobre `nidos` (RLS solo da `SELECT` a `anon`); la reubicación se envía **solo** por esta función.

```js
const { data, error } = await supabase.rpc('reubicar_nido', {
  p_clave: nido.clave,                         // text: UUID del nido generado en el teléfono
  p_corral: nido.corral,                       // text: clave del corral, se recorta
  p_huevos: nido.huevos_contados,              // integer > 0
  p_fecha_reubicacion: nido.fecha_reubicacion, // 'YYYY-MM-DD', fecha local del teléfono
});
```

**Requisito previo:** el nido ya debe existir en el servidor como `registrado`. HU-16 primero hace upsert del nido (por `clave`, mandando `estado: 'registrado'` aunque localmente ya esté en corral) y después llama a esta RPC.

**Éxito** (HTTP 200, `error === null`): `data` es la fila completa de `nidos` ya en `en_corral`, con la `fecha_estimada_eclosion` calculada por el servidor. HU-16 debe guardar esa fecha en IndexedDB y poner `pendiente_envio: false`.
Es **idempotente**: si el nido ya está en corral con el mismo corral, los mismos huevos y la misma fecha, devuelve la fila sin cambios. Reenviar después de un timeout es seguro.

**Rechazo** (HTTP 400, `error.code` con un código conocido): el servidor recibió la petición y dijo que no. **Reintentar no lo arregla.**

| `error.code` | Significa |
|---|---|
| `NE001` | No existe un nido con esa clave (falta el upsert previo). |
| `NE002` | Transición no permitida: el nido no está `registrado`, o ya está en corral **con otros datos**. |
| `NE003` | Datos inválidos: falta el corral, huevos ≤ 0 o nulos, fecha nula, futura o anterior al hallazgo. |
| `NE004` | La especie del nido no tiene días de incubación. |
| `22P02` | Tipo inválido (por ejemplo, huevos = `2.5`); lo rechaza PostgREST antes de entrar a la función. |

Con cualquier rechazo, HU-16 debe marcar el nido como **conflicto** en IndexedDB (por ejemplo `conflicto: { code, message, en: <fecha> }` y `pendiente_envio: false`), sacarlo de la cola y mostrarlo al voluntario para que lo resuelva. **No debe quedar pendiente para siempre.** `NE001` es la excepción: se reintenta después de subir el nido.

**Error de red** (sin respuesta del servidor: `error.message` tipo `Failed to fetch`, sin `error.code`, o HTTP 5xx/408/429): el nido sigue con `pendiente_envio: true` y se reintenta en la siguiente sincronización.

> Seguridad: la función es `SECURITY DEFINER` porque RLS no permite `UPDATE` a `anon`, y una política de `UPDATE` abriría todas las columnas. Dentro valida todos los parámetros, usa `search_path` vacío y bloquea la fila con `FOR UPDATE`; el trigger vuelve a validar la transición. Cuando la app use Supabase Auth, aquí habrá que revisar también el rol de quien llama.
