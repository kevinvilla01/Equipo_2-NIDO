#!/usr/bin/env bash
# Pruebas de HU-12 (nido perdido) contra Supabase con curl. Nunca imprime contraseñas ni tokens.
#
# Credenciales: las mismas que scripts/probar-permisos.sh (.env.local y .env.pruebas).
# Necesita un nido de prueba en estado registrado, creado antes en el SQL Editor:
#
#   insert into public.nidos (clave, especie_id, tramo_id, fecha_hallazgo, referencia_ubicacion)
#   select 'PRUEBA-HU12', (select min(id) from especies), (select min(id) from tramos),
#          current_date - 1, 'Nido de prueba de HU-12';
#
#   PRUEBA_NIDO_CLAVE=PRUEBA-HU12 bash scripts/probar-perdida.sh   (por defecto PRUEBA-HU12)
#
# Efectos: deja ese nido PERDIDO por marea. Un nido perdido no se puede cambiar ni borrar
# (NE005); para limpiarlo, en el SQL Editor:
#
#   begin;
#   alter table public.nidos disable trigger nidos_validar_transicion;
#   delete from public.nidos where clave = 'PRUEBA-HU12';
#   alter table public.nidos enable trigger nidos_validar_transicion;
#   commit;
set -uo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
for archivo in "$raiz/.env.local" "$raiz/.env.pruebas"; do
  # shellcheck disable=SC1090
  [[ -f "$archivo" ]] && { set -a; . "$archivo"; set +a; }
done

for variable in SUPABASE_URL SUPABASE_ANON_KEY PRUEBA_VOLUNTARIO_CORREO PRUEBA_VOLUNTARIO_CONTRASENA \
                PRUEBA_COORDINADOR_CORREO PRUEBA_COORDINADOR_CONTRASENA; do
  [[ -n "${!variable:-}" ]] || { echo "Falta $variable (entorno o .env.pruebas)."; exit 2; }
done

URL="${SUPABASE_URL%/}"
CLAVE="${PRUEBA_NIDO_CLAVE:-PRUEBA-HU12}"
HOY="$(date +%F)"
CURL=(curl -s --max-time 20)
pasaron=0
fallaron=0

ok()    { echo "  ✔ $1"; pasaron=$((pasaron + 1)); }
falla() { echo "  ✘ $1"; fallaron=$((fallaron + 1)); }
verificar() { # verificar <descripción> <condición bash>
  if eval "$2"; then ok "$1"; else falla "$1"; fi
}

# peticion <metodo> <url> <token> [cuerpo] → deja el código en $codigo y el cuerpo en $cuerpo
peticion() {
  local metodo="$1" destino="$2" token="$3" datos="${4:-}"
  local args=(-X "$metodo" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $token"
              -H "Content-Type: application/json" -w $'\n%{http_code}')
  [[ -n "$datos" ]] && args+=(-d "$datos")
  local salida
  salida="$("${CURL[@]}" "${args[@]}" "$destino")"
  codigo="${salida##*$'\n'}"
  cuerpo="${salida%$'\n'*}"
}

iniciar_sesion() { # iniciar_sesion <correo> <contraseña> → imprime el access_token
  jq -n --arg email "$1" --arg password "$2" '{email: $email, password: $password}' |
    "${CURL[@]}" -X POST "$URL/auth/v1/token?grant_type=password" \
      -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d @- |
    jq -r '.access_token // empty'
}

marcar() { # marcar <token> <causa>
  peticion POST "$URL/rest/v1/rpc/marcar_nido_perdido" "$1" \
    "$(jq -nc --arg c "$CLAVE" --arg causa "$2" --arg f "$HOY" '{p_clave: $c, p_causa: $causa, p_fecha_perdida: $f}')"
}

estado_nido() { # estado_nido <token> → "estado|causa|perdido_por"
  peticion GET "$URL/rest/v1/nidos?select=estado,causa_perdida,perdido_por&clave=eq.$CLAVE" "$1"
  jq -r '.[0] | "\(.estado)|\(.causa_perdida)|\(.perdido_por)"' <<<"$cuerpo"
}

echo "== Sesiones"
TOKEN_VOL="$(iniciar_sesion "$PRUEBA_VOLUNTARIO_CORREO" "$PRUEBA_VOLUNTARIO_CONTRASENA")"
TOKEN_COORD="$(iniciar_sesion "$PRUEBA_COORDINADOR_CORREO" "$PRUEBA_COORDINADOR_CONTRASENA")"
verificar "el voluntario inicia sesión" '[[ -n "$TOKEN_VOL" ]]'
verificar "el coordinador inicia sesión" '[[ -n "$TOKEN_COORD" ]]'
[[ -n "$TOKEN_VOL" && -n "$TOKEN_COORD" ]] || { echo "Sin sesiones no se puede seguir."; exit 1; }

peticion GET "$URL/rest/v1/usuarios?select=id&correo=eq.$PRUEBA_COORDINADOR_CORREO" "$TOKEN_COORD"
ID_COORD="$(jq -r '.[0].id // empty' <<<"$cuerpo")"
inicial="$(estado_nido "$TOKEN_COORD")"
[[ "$inicial" == registrado\|* ]] || {
  echo "El nido $CLAVE no existe o no está registrado ($inicial). Créalo con el insert de la cabecera."; exit 1; }
echo "  nido $CLAVE: registrado"

echo "== anon"
marcar "$SUPABASE_ANON_KEY" marea
verificar "anon no puede llamar a marcar_nido_perdido (HTTP $codigo)" '[[ "$codigo" == 401 || "$codigo" == 403 ]]'

echo "== Voluntario"
marcar "$TOKEN_VOL" marea
verificar "recibe NE006 (HTTP $codigo, $(jq -r '.code // "?"' <<<"$cuerpo"))" \
  '[[ "$codigo" == 400 && "$(jq -r .code <<<"$cuerpo")" == NE006 ]]'
peticion PATCH "$URL/rest/v1/nidos?clave=eq.$CLAVE" "$TOKEN_VOL" '{"estado":"perdido","causa_perdida":"marea"}'
codigo_patch="$codigo"
verificar "tampoco por REST directo; el nido sigue registrado (PATCH HTTP $codigo_patch)" \
  '[[ "$(estado_nido "$TOKEN_COORD")" == registrado\|* ]]'

echo "== Coordinador"
marcar "$TOKEN_COORD" tormenta
verificar "una causa fuera del catálogo da NE003 (HTTP $codigo, $(jq -r '.code // "?"' <<<"$cuerpo"))" \
  '[[ "$(jq -r .code <<<"$cuerpo")" == NE003 ]]'
marcar "$TOKEN_COORD" marea
verificar "marca el nido perdido por marea (HTTP $codigo)" \
  '[[ "$codigo" == 200 && "$(jq -r .estado <<<"$cuerpo")" == perdido && "$(jq -r .causa_perdida <<<"$cuerpo")" == marea ]]'
verificar "perdido_por es el coordinador ($(estado_nido "$TOKEN_COORD"))" \
  '[[ "$(estado_nido "$TOKEN_COORD")" == "perdido|marea|$ID_COORD" ]]'
marcar "$TOKEN_COORD" marea
verificar "reenviar la misma pérdida es idempotente (HTTP $codigo)" '[[ "$codigo" == 200 ]]'

echo "== Nido perdido: ya no cambia"
marcar "$TOKEN_COORD" saqueo
verificar "cambiar la causa da NE005 (HTTP $codigo, $(jq -r '.code // "?"' <<<"$cuerpo"))" \
  '[[ "$(jq -r .code <<<"$cuerpo")" == NE005 ]]'
peticion POST "$URL/rest/v1/rpc/reubicar_nido" "$TOKEN_COORD" \
  "$(jq -nc --arg c "$CLAVE" --arg f "$HOY" '{p_clave: $c, p_corral: "C-1", p_huevos: 10, p_fecha_reubicacion: $f}')"
verificar "reubicarlo da NE005 (HTTP $codigo, $(jq -r '.code // "?"' <<<"$cuerpo"))" \
  '[[ "$(jq -r .code <<<"$cuerpo")" == NE005 ]]'
peticion PATCH "$URL/rest/v1/nidos?clave=eq.$CLAVE" "$TOKEN_COORD" '{"estado":"registrado"}'
codigo_patch="$codigo"
verificar "ni el coordinador lo regresa por REST (PATCH HTTP $codigo_patch; sigue $(estado_nido "$TOKEN_COORD"))" \
  '[[ "$(estado_nido "$TOKEN_COORD")" == perdido\|marea\|* ]]'

echo
echo "Pasaron $pasaron, fallaron $fallaron."
[[ "$fallaron" == 0 ]]
