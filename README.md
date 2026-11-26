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

## Iniciar sesión (Supabase Auth)

> **Qué cambió (nov 2026):** el login ya no lee la tabla `usuarios` ni compara contraseñas en texto plano. Ahora usa **Supabase Auth** y la columna `usuarios.password` se eliminó.

**Para usar la app:** se entra con el **mismo correo y la misma contraseña** de antes; las cuentas se migraron tal cual. Si a alguien no le funciona, el coordinador le pone una contraseña nueva en *Voluntarios → editar* (mínimo 8 caracteres).

**Para programar (Luis, Diego):**

- Toda la app llega a Supabase como el rol `authenticated`, con el JWT del usuario. `anon` ya no puede leer ni escribir nada, salvo `SELECT` en `keepalive`.
- Usa siempre el cliente único `import { supabase } from '/js/supabase.js'`. Lleva el JWT solo. **No** hagas `fetch` a `/rest/v1` con la anon key como `Bearer`, porque entra como `anon` y RLS lo rechaza.
- Toda pantalla nueva debe cargar `/config.js`, `/vendor/supabase.js` y `/js/app.js`. `app.js` revisa la sesión y, si no hay, manda al login. El acceso se declara en el `<body>`:

  | `data-acceso` | Quién entra |
  |---|---|
  | (sin atributo) | Cualquier usuario con sesión. |
  | `"coordinador"` | Solo coordinadores (Catálogos, Voluntarios, altas). |
  | `"publico"` | Sin sesión (solo `index.html`). |

  Es comodidad de la UI. **Quién puede leer o escribir qué lo decide RLS en el servidor** (ver [Permisos](#permisos)).
- Perfil del usuario: `leerPerfil()` de `/js/sesion.js` devuelve `{ id, nombre, correo, rol }`. Sigue guardado en `localStorage['nido_usuario']`, así que el código existente no cambia. El servidor **no confía** en ese dato: identifica al usuario con `auth.uid()`.
- Antes de enviar algo al servidor al volver la señal (colas offline, RPC), usa `conSesionVigente(() => …)` de `/js/sesion.js`. Refresca el JWT si está por vencer. Si Auth rechaza la sesión, manda al login **sin borrar lo pendiente** de IndexedDB. Si solo falta red, lanza `ErrorSesion` con código `'red'` y lo pendiente se queda para el siguiente intento. Al recuperar la sesión, `app.js` emite el evento `nido:sesion-vigente` en `window`.
- Nombres de otros usuarios (compañeros de patrulla): lee la vista `directorio_usuarios` (`id`, `nombre`, `activo`). Un voluntario solo puede leer **su propia** fila de `usuarios`; el coordinador las lee todas.
- Altas, cambios y bajas de usuarios: **solo** con la Edge Function `usuarios-admin`, mediante `administrarUsuario(accion, datos)` de `/js/usuarios-admin.js`. Nadie escribe `usuarios` desde el cliente y nadie puede cambiar su propio rol.
- Para ocultar un elemento a los voluntarios, ponle `data-solo-coordinador class="oculto"`. Un botón con `data-cerrar-sesion` cierra la sesión.

### Despliegue del cambio (una sola vez, en este orden)

0. **Rotar las llaves si la service_role se expuso.** Hazlo antes de todo lo demás, porque esa llave da acceso total a la base y a Auth.
   - Si la llave expuesta empieza con `sb_secret_`: en *Settings → API Keys*, revoca esa secret key y crea otra. La anon/publishable y las sesiones no cambian.
   - Si es un JWT (`eyJ…`, llaves *legacy*): en *Settings → JWT Keys*, rota el JWT secret. Esto **invalida la anon key, la service_role y todas las sesiones**. Después:
     - Actualiza `SUPABASE_ANON_KEY` en Vercel (*Settings → Environment Variables*, en todos los entornos donde exista), en GitHub Secrets (la usa `keep-alive.yml`) y en tu `.env.local` (`vercel env pull .env.local`).
     - Vuelve a desplegar `main` (*Actions → Deploy → Run workflow*). `dist/config.js` se genera en el build y hasta entonces producción sigue con la llave vieja.
     - Edge Functions: Supabase les inyecta `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`, así que no hay nada que configurar. Si ya estaba desplegada, vuelve a desplegarla y prueba que responda.
     - La service_role nueva solo va en tu terminal para el paso 2.
1. SQL Editor, en este orden: `20261116000000_auth_1_ligar_usuarios.sql`, `20261116000050_auth_1b_directorio_activo.sql` y `20261116000075_auth_1c_password_opcional.sql`. Sin la 1c, dar de alta un voluntario falla porque `password` era `NOT NULL`.
2. En local, con la **service_role** solo en tu terminal (nunca en el repo, en `.env.local` ni en Vercel):
   ```bash
   export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
   node scripts/migrar-cuentas-auth.mjs --dry-run                     # revisar
   node scripts/migrar-cuentas-auth.mjs --password-para <id-coordinador>
   ```
   El `--dry-run` dice, sin mostrarla, por qué una contraseña actual no sirve. Pasa `--password-para <id>` (se puede repetir) para escribir tú la contraseña de alguien con un prompt oculto. **Hazlo al menos para un coordinador activo**: sin eso nadie puede entrar a poner las demás.
3. Edge Function:
   ```bash
   npx supabase login
   npx supabase secrets set ORIGENES_PERMITIDOS="http://localhost:5500" --project-ref <ref>
   # cuando haya dominio de Vercel: ORIGENES_PERMITIDOS="https://<dominio>,http://localhost:5500"
   npx supabase functions deploy usuarios-admin --project-ref <ref>
   ```
4. Desplegar el frontend (merge a `main`).
5. SQL Editor: `20261116000100_auth_2_cerrar_usuarios.sql`. Se aborta si algún usuario activo quedó sin cuenta.
6. SQL Editor: `20261116000200_auth_3_politicas_tablas.sql`.
7. Pruebas de permisos: `bash scripts/probar-permisos.sh`. Necesita una cuenta de voluntario y otra de coordinador **de prueba**, con sus credenciales en `.env.pruebas`, que está ignorado por git:
   ```bash
   PRUEBA_VOLUNTARIO_CORREO=voluntario.prueba@nido.test
   PRUEBA_VOLUNTARIO_CONTRASENA=…
   PRUEBA_COORDINADOR_CORREO=coordinador.prueba@nido.test
   PRUEBA_COORDINADOR_CONTRASENA=…
   ```
   Revisa que anon y el voluntario no lean usuarios ajenos, que el voluntario no pueda cambiar su rol ni usar `usuarios-admin`, que el coordinador sí pueda (crea, desactiva y borra un usuario temporal) y el preflight CORS. No imprime contraseñas ni tokens.

### Cuentas huérfanas

Si `usuarios-admin` crea una cuenta de Auth y después falla el paso en la base, la función borra la cuenta. Si ese borrado también falla, la cuenta queda **huérfana** y el log de la función (*Edge Functions → usuarios-admin → Logs*) muestra `CUENTA HUÉRFANA auth_id=…`. Una cuenta huérfana no puede usar la app, pero sí ocupa el correo: con ella, volver a dar de alta a esa persona falla con "Ya existe una cuenta con ese correo". Para encontrarlas (SQL Editor):

```sql
select u.id, u.email, u.created_at
  from auth.users u
  left join public.usuarios p on p.auth_id = u.id
 where p.id is null
 order by u.created_at desc;
```

Se borran en *Authentication → Users*.

## Permisos

Lo que cada rol puede hacer en el servidor (RLS + GRANTs, migración `auth_3`). `anon` no tiene acceso a nada, salvo `SELECT` en `keepalive`. A nadie se le permite `TRUNCATE`, `TRIGGER` ni `REFERENCES`.

| Tabla | Leer | Escribir |
|---|---|---|
| `usuarios` | La propia fila; el coordinador, todas | Nadie desde el cliente (Edge Function `usuarios-admin`) |
| `directorio_usuarios` (vista) | Todos (`id`, `nombre`, `activo`) | — |
| `especies`, `tramos` | Todos | Solo el coordinador |
| `nidos` | Todos | Nadie directo; solo RPC (`reubicar_nido`) |
| `liberaciones` | Todos | Insertar, solo a nombre propio (`responsable_id`) |
| `patrullajes` | Todos | Insertar (el servidor llena `creado_por`); editar y borrar: quien lo creó, un voluntario asignado o el coordinador |
| `patrullaje_voluntario` | Todos | Asignar y quitar: quien puede editar ese patrullaje |
| `keepalive` | Todos, incluido `anon` | — |

Funciones para políticas y RPC: `public.es_coordinador()` y `public.usuario_actual_id()`.

### Tablas y funciones nuevas

- **Las crea `postgres`** (SQL Editor, migraciones): nacen **sin** permisos para `anon` y sin `TRUNCATE`, `TRIGGER` ni `REFERENCES` para `authenticated` (default privileges de `auth_3`). Las funciones necesitan un `grant execute ... to authenticated` explícito.
- **Las crea `supabase_admin`:** nacen con **todo** para `anon` y `authenticated`. Sus default privileges no se pueden cambiar desde el SQL Editor, porque `postgres` no es miembro de ese rol (`auth_3` lo intenta y solo deja un warning). Revisa con `select tableowner from pg_tables where tablename = '…'` quién creó una tabla del Dashboard.
- **En cualquier caso**, después de crear o cambiar tablas, vistas o funciones, corre `supabase/verificar-permisos.sql` en el SQL Editor. Solo devuelve problemas:
  - tabla sin RLS;
  - RLS sin políticas;
  - `anon` con cualquier permiso (salvo leer `keepalive`);
  - `authenticated` con `TRUNCATE`, `TRIGGER` o `REFERENCES`;
  - funciones que `anon` puede ejecutar;
  - `SECURITY DEFINER` sin `search_path`.

  **Sin filas = todo en orden.**

## Variables de entorno

| Variable | Dónde vive | Uso |
|---|---|---|
| `SUPABASE_URL` | Vercel y GitHub Secrets | URL del proyecto de Supabase. Se inyecta en `dist/config.js` durante el build. |
| `SUPABASE_ANON_KEY` | Vercel y GitHub Secrets | Publishable (anon) key de Supabase. Es pública por diseño; la protección real de los datos la dan las políticas RLS. |
| `VERCEL_TOKEN` | GitHub Secrets | Token para que el workflow despliegue con el CLI de Vercel. |
| `VERCEL_ORG_ID` | GitHub Secrets | ID del equipo/cuenta en Vercel. |
| `VERCEL_PROJECT_ID` | GitHub Secrets | ID del proyecto en Vercel. |
| `ORIGENES_PERMITIDOS` | Secretos de la Edge Function (`supabase secrets set`) | Orígenes que pueden llamar a `usuarios-admin` desde el navegador (CORS), separados por comas y con esquema y puerto exactos. |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo tu terminal, para `scripts/migrar-cuentas-auth.mjs` | En la Edge Function la inyecta Supabase; no se configura. |

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
| `20261116000000_auth_1_ligar_usuarios.sql` | Auth | `usuarios.auth_id`, `es_coordinador()`, `usuario_actual_id()`, vista `directorio_usuarios`. |
| `20261116000050_auth_1b_directorio_activo.sql` | Auth | `directorio_usuarios` con inactivos y columna `activo`. |
| `20261116000075_auth_1c_password_opcional.sql` | Auth | Quita el `NOT NULL` de `usuarios.password` para que la Edge Function pueda dar altas. |
| `20261116000100_auth_2_cerrar_usuarios.sql` | Auth | RLS de `usuarios`, trigger `usuarios_proteger`, borra `usuarios.password`. |
| `20261116000200_auth_3_politicas_tablas.sql` | Auth | Políticas y GRANTs del resto de tablas, `patrullajes.creado_por`, default privileges. |

Las de Auth se corren en un orden fijo, intercaladas con el script de cuentas y el despliegue: ver [Despliegue del cambio](#despliegue-del-cambio-una-sola-vez-en-este-orden).

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

La app no tiene permiso de `UPDATE` sobre `nidos` (RLS solo da `SELECT` a `authenticated`); la reubicación se envía **solo** por esta función, con la sesión del usuario (`conSesionVigente`).

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
