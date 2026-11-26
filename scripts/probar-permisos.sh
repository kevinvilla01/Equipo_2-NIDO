#!/usr/bin/env bash
# Pruebas de permisos contra Supabase con curl: RLS de usuarios, Edge Function
# usuarios-admin y CORS. Nunca imprime contraseñas ni tokens.
#
# Credenciales (variables de entorno o un archivo .env.pruebas, ignorado por git):
#   SUPABASE_URL, SUPABASE_ANON_KEY            (las de .env.local)
#   PRUEBA_VOLUNTARIO_CORREO,   PRUEBA_VOLUNTARIO_CONTRASENA
#   PRUEBA_COORDINADOR_CORREO,  PRUEBA_COORDINADOR_CONTRASENA
#   PRUEBA_ORIGEN               (opcional; por defecto http://localhost:5500)
#
#   bash scripts/probar-permisos.sh
#
# Efectos: crea un usuario temporal prueba-<fecha>@nido.test con el coordinador y lo
# elimina al final. Las demás pruebas no cambian datos: las escrituras que deben
# fallar se verifican releyendo la fila.
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
FUNCION="$URL/functions/v1/usuarios-admin"
ORIGEN="${PRUEBA_ORIGEN:-http://localhost:5500}"
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

echo "== Sesiones"
TOKEN_VOL="$(iniciar_sesion "$PRUEBA_VOLUNTARIO_CORREO" "$PRUEBA_VOLUNTARIO_CONTRASENA")"
TOKEN_COORD="$(iniciar_sesion "$PRUEBA_COORDINADOR_CORREO" "$PRUEBA_COORDINADOR_CONTRASENA")"
verificar "el voluntario inicia sesión" '[[ -n "$TOKEN_VOL" ]]'
verificar "el coordinador inicia sesión" '[[ -n "$TOKEN_COORD" ]]'
[[ -n "$TOKEN_VOL" && -n "$TOKEN_COORD" ]] || { echo "Sin sesiones no se puede seguir."; exit 1; }

peticion GET "$URL/rest/v1/usuarios?select=id,rol&correo=eq.$PRUEBA_VOLUNTARIO_CORREO" "$TOKEN_COORD"
ID_VOL="$(jq -r '.[0].id // empty' <<<"$cuerpo")"
peticion GET "$URL/rest/v1/usuarios?select=id&correo=eq.$PRUEBA_COORDINADOR_CORREO" "$TOKEN_COORD"
ID_COORD="$(jq -r '.[0].id // empty' <<<"$cuerpo")"
[[ -n "$ID_VOL" && -n "$ID_COORD" ]] || { echo "No se encontraron las filas de las cuentas de prueba."; exit 1; }

echo "== anon (sin sesión)"
peticion GET "$URL/rest/v1/usuarios?select=id" "$SUPABASE_ANON_KEY"
verificar "anon no lee usuarios (HTTP $codigo, $(jq 'if type=="array" then length else 0 end' <<<"$cuerpo") filas)" \
  '[[ "$codigo" != 200 ]] || [[ "$(jq length <<<"$cuerpo")" == 0 ]]'

echo "== Voluntario"
peticion GET "$URL/rest/v1/usuarios?select=id" "$TOKEN_VOL"
verificar "lee solo su propia fila de usuarios (HTTP $codigo, filas: $(jq -c '[.[]?.id]' <<<"$cuerpo"))" \
  '[[ "$codigo" == 200 && "$(jq -c "[.[].id]" <<<"$cuerpo")" == "[$ID_VOL]" ]]'

peticion GET "$URL/rest/v1/usuarios?select=id,correo,rol&id=eq.$ID_COORD" "$TOKEN_VOL"
verificar "no lee la fila del coordinador aunque la pida por id (HTTP $codigo)" \
  '[[ "$codigo" != 200 ]] || [[ "$(jq length <<<"$cuerpo")" == 0 ]]'

peticion GET "$URL/rest/v1/directorio_usuarios?select=id,nombre" "$TOKEN_VOL"
verificar "sí ve los nombres en directorio_usuarios (HTTP $codigo, $(jq 'length? // 0' <<<"$cuerpo") filas)" \
  '[[ "$codigo" == 200 && "$(jq length <<<"$cuerpo")" -gt 1 ]]'

peticion PATCH "$URL/rest/v1/usuarios?id=eq.$ID_VOL" "$TOKEN_VOL" '{"rol":"coordinador"}'
codigo_patch="$codigo"
peticion GET "$URL/rest/v1/usuarios?select=rol&id=eq.$ID_VOL" "$TOKEN_COORD"
verificar "no puede ponerse rol coordinador por REST (PATCH HTTP $codigo_patch; rol sigue: $(jq -r '.[0].rol' <<<"$cuerpo"))" \
  '[[ "$(jq -r ".[0].rol" <<<"$cuerpo")" == voluntario ]]'

peticion POST "$FUNCION" "$TOKEN_VOL" "{\"accion\":\"actualizar\",\"id\":$ID_VOL,\"rol\":\"coordinador\"}"
verificar "usuarios-admin rechaza que se cambie su rol (HTTP $codigo, $(jq -r '.codigo // .code // "?"' <<<"$cuerpo"))" \
  '[[ "$codigo" == 403 ]]'

peticion POST "$FUNCION" "$TOKEN_VOL" '{"accion":"crear","nombre":"No","correo":"no-debe@nido.test","rol":"coordinador","password":"NoDebe123"}'
verificar "usuarios-admin rechaza que cree usuarios (HTTP $codigo, $(jq -r '.codigo // .code // "?"' <<<"$cuerpo"))" \
  '[[ "$codigo" == 403 ]]'

echo "== Coordinador"
peticion GET "$URL/rest/v1/usuarios?select=id" "$TOKEN_COORD"
verificar "lee todas las filas de usuarios (HTTP $codigo, $(jq 'length? // 0' <<<"$cuerpo") filas)" \
  '[[ "$codigo" == 200 && "$(jq length <<<"$cuerpo")" -gt 1 ]]'

peticion POST "$FUNCION" "$TOKEN_COORD" "{\"accion\":\"actualizar\",\"id\":$ID_COORD,\"rol\":\"voluntario\"}"
verificar "usuarios-admin no le deja cambiar su propio rol (HTTP $codigo, $(jq -r '.codigo // "?"' <<<"$cuerpo"))" \
  '[[ "$codigo" == 403 ]]'

temporal="prueba-$(date +%Y%m%d%H%M%S)@nido.test"
peticion POST "$FUNCION" "$TOKEN_COORD" \
  "{\"accion\":\"crear\",\"nombre\":\"Prueba temporal\",\"correo\":\"$temporal\",\"rol\":\"voluntario\",\"password\":\"Temporal-$RANDOM-x\"}"
ID_TEMP="$(jq -r '.usuario.id // empty' <<<"$cuerpo")"
verificar "usuarios-admin crea un voluntario (HTTP $codigo)" '[[ "$codigo" == 200 && -n "$ID_TEMP" ]]'

if [[ -n "$ID_TEMP" ]]; then
  peticion POST "$FUNCION" "$TOKEN_COORD" "{\"accion\":\"actualizar\",\"id\":$ID_TEMP,\"activo\":false}"
  verificar "usuarios-admin lo desactiva (HTTP $codigo)" '[[ "$codigo" == 200 && "$(jq -r .usuario.activo <<<"$cuerpo")" == false ]]'
  peticion POST "$FUNCION" "$TOKEN_COORD" "{\"accion\":\"eliminar\",\"id\":$ID_TEMP}"
  verificar "usuarios-admin lo elimina (HTTP $codigo)" '[[ "$codigo" == 200 ]]'
fi

echo "== CORS (Origin: $ORIGEN)"
cabeceras="$("${CURL[@]}" -o /dev/null -D - -X OPTIONS "$FUNCION" -H "Origin: $ORIGEN" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,apikey,content-type")"
verificar "el preflight permite $ORIGEN" 'grep -qi "^access-control-allow-origin: $ORIGEN" <<<"$cabeceras"'
cabeceras="$("${CURL[@]}" -o /dev/null -D - -X OPTIONS "$FUNCION" -H "Origin: https://otro-sitio.example" \
  -H "Access-Control-Request-Method: POST")"
verificar "el preflight no permite https://otro-sitio.example" '! grep -qi "^access-control-allow-origin" <<<"$cabeceras"'

echo
echo "Pasaron $pasaron, fallaron $fallaron."
[[ "$fallaron" == 0 ]]
