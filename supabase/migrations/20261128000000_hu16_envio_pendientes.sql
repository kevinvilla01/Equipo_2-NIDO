-- HU-16 · Enviar lo pendiente al recuperar señal sin duplicar registros (issue #17).
--
-- Cada registro creado sin señal lleva un identificador de cliente (UUID) generado en el
-- teléfono al crearlo:
--   patrullajes.client_id · nidos.clave (ya era UUID y UNIQUE desde HU-10) · liberaciones.client_id
-- y se envía con una RPC idempotente: un reenvío regresa la misma fila, no crea otra.
--
-- Las FK se resuelven en el servidor con el identificador de cliente del padre:
--   registrar_nido(p_patrullaje_client_id) → nidos.patrullaje_id
--   registrar_liberacion(p_nido_clave)     → liberaciones.nido_id
-- Si el padre aún no existe responde NE001 y el teléfono deja el hijo pendiente.
--
-- Códigos nuevos:
--   NE007 · el identificador ya lo usó otro usuario (no se regresa su fila).
--   NE008 · sin sesión (auth.uid() nulo o sin usuario ligado).
--
-- Requiere auth_1 a auth_3, HU-10, HU-12 y HU-13. Re-ejecutable.
-- Correr completo en Supabase → SQL Editor.

begin;

-- 1. Identificadores de cliente. Las filas viejas quedan con null (UNIQUE admite varios null).
alter table public.patrullajes  add column if not exists client_id uuid;
alter table public.liberaciones add column if not exists client_id uuid;

-- nidos.creado_por: para saber de quién es una clave al reenviar. Mismo tipo que usuarios.id.
do $$
declare
  v_tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format(
    'alter table public.nidos add column if not exists creado_por %s
       references public.usuarios (id) on delete set null', v_tipo_usuario);

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.patrullajes'::regclass and conname = 'patrullajes_client_id_key') then
    alter table public.patrullajes add constraint patrullajes_client_id_key unique (client_id);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.liberaciones'::regclass and conname = 'liberaciones_client_id_key') then
    alter table public.liberaciones add constraint liberaciones_client_id_key unique (client_id);
  end if;
end $$;

-- Sesión obligatoria: auth.uid() y un usuario ligado. Devuelve usuarios.id.
create or replace function public.usuario_de_sesion()
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = 'NE008', message = 'Se necesita una sesión para enviar registros.';
  end if;
  v_id := public.usuario_actual_id();
  if v_id is null then
    raise exception using errcode = 'NE008', message = 'La sesión no está ligada a un usuario activo.';
  end if;
  return v_id;
end;
$$;
revoke all on function public.usuario_de_sesion() from public, anon;
grant execute on function public.usuario_de_sesion() to authenticated;

-- 2. registrar_patrullaje. SECURITY INVOKER: aplica la RLS de auth_3 tal cual
--    (creado_por = quien llama por default; asignar voluntarios = puede_editar_patrullaje).
--    Patrullaje y voluntarios en una sola transacción: o quedan los dos o ninguno.
create or replace function public.registrar_patrullaje(
  p_client_id uuid,
  p_fecha date,
  p_hora_inicio time,
  p_tramo_id bigint,
  p_voluntarios bigint[]
)
returns public.patrullajes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usuario bigint := public.usuario_de_sesion();
  v_fila public.patrullajes;
begin
  if p_client_id is null or p_fecha is null or p_hora_inicio is null or p_tramo_id is null then
    raise exception using errcode = 'NE003', message = 'Faltan el identificador, la fecha, la hora de inicio o el tramo.';
  end if;
  if p_voluntarios is null or cardinality(p_voluntarios) = 0 then
    raise exception using errcode = 'NE003', message = 'Selecciona al menos un voluntario.';
  end if;

  insert into public.patrullajes (client_id, fecha, hora_inicio, tramo_id, pendiente_envio)
  values (p_client_id, p_fecha, p_hora_inicio, p_tramo_id, false)
  on conflict (client_id) do nothing
  returning * into v_fila;

  if v_fila.id is null then
    -- Reenvío: solo se regresa la fila si es de quien llama.
    select * into v_fila from public.patrullajes where client_id = p_client_id;
    if v_fila.creado_por is distinct from v_usuario then
      raise exception using errcode = 'NE007', message = 'Ese patrullaje ya lo registró otro usuario.';
    end if;
    return v_fila;
  end if;

  insert into public.patrullaje_voluntario (patrullaje_id, usuario_id)
  select v_fila.id, distinct_id
    from (select distinct unnest(p_voluntarios) as distinct_id) v;

  return v_fila;
end;
$$;
revoke all on function public.registrar_patrullaje(uuid, date, time, bigint, bigint[]) from public, anon;
grant execute on function public.registrar_patrullaje(uuid, date, time, bigint, bigint[]) to authenticated;

-- 3. registrar_nido. SECURITY DEFINER, justificación: desde auth_3 nadie inserta en nidos
--    directo (una política de INSERT abriría todas las columnas). Mitigaciones: sesión
--    obligatoria, creado_por lo pone el servidor, el tramo tiene que ser del campamento de
--    quien llama (como la RLS de lectura de HU-13), estado fijo 'registrado' (el trigger
--    de la máquina de estados lo vuelve a validar), search_path vacío.
create or replace function public.registrar_nido(
  p_clave text,
  p_tramo_id bigint,
  p_especie_id bigint,
  p_referencia_ubicacion text,
  p_fecha_hallazgo date,
  p_creado_en timestamptz default null,
  p_patrullaje_client_id uuid default null
)
returns public.nidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario bigint := public.usuario_de_sesion();
  v_patrullaje_id bigint;
  v_fila public.nidos;
begin
  if p_clave is null or btrim(p_clave) = '' or p_tramo_id is null or p_especie_id is null
     or p_referencia_ubicacion is null or btrim(p_referencia_ubicacion) = '' or p_fecha_hallazgo is null then
    raise exception using errcode = 'NE003', message = 'Faltan la clave, el tramo, la especie, la ubicación o la fecha.';
  end if;
  if p_fecha_hallazgo > current_date + 1 then
    raise exception using errcode = 'NE003', message = 'La fecha del hallazgo está en el futuro.';
  end if;

  -- Reenvío: la clave ya existe.
  select * into v_fila from public.nidos where clave = p_clave;
  if found then
    if v_fila.creado_por is distinct from v_usuario then
      raise exception using errcode = 'NE007', message = 'Esa clave de nido ya la registró otro usuario.';
    end if;
    return v_fila;
  end if;

  if not public.es_coordinador() and not exists (
       select 1 from public.tramos t
        where t.id = p_tramo_id and t.campamento_id = public.campamento_actual_id()) then
    raise exception using errcode = 'NE003', message = 'El tramo no es de tu campamento.';
  end if;

  if p_patrullaje_client_id is not null then
    select id into v_patrullaje_id from public.patrullajes where client_id = p_patrullaje_client_id;
    if v_patrullaje_id is null then
      raise exception using errcode = 'NE001', message = 'El patrullaje del nido aún no está en el servidor.';
    end if;
  end if;

  insert into public.nidos (clave, tramo_id, especie_id, referencia_ubicacion, fecha_hallazgo,
                            estado, pendiente_envio, creado_en, patrullaje_id, creado_por)
  values (p_clave, p_tramo_id, p_especie_id, btrim(p_referencia_ubicacion), p_fecha_hallazgo,
          'registrado', false, coalesce(p_creado_en, now()), v_patrullaje_id, v_usuario)
  on conflict (clave) do nothing
  returning * into v_fila;

  if v_fila.id is null then
    -- Otro envío de la misma clave ganó la carrera.
    select * into v_fila from public.nidos where clave = p_clave;
    if v_fila.creado_por is distinct from v_usuario then
      raise exception using errcode = 'NE007', message = 'Esa clave de nido ya la registró otro usuario.';
    end if;
  end if;
  return v_fila;
end;
$$;
revoke all on function public.registrar_nido(text, bigint, bigint, text, date, timestamptz, uuid) from public, anon;
grant execute on function public.registrar_nido(text, bigint, bigint, text, date, timestamptz, uuid) to authenticated;

-- 4. registrar_liberacion. SECURITY INVOKER: aplica la RLS de auth_3
--    (responsable_id = quien llama) y la de lectura de nidos por campamento (HU-13):
--    un nido de otro campamento no se ve y responde NE001.
create or replace function public.registrar_liberacion(
  p_client_id uuid,
  p_nido_clave text,
  p_cantidad_liberada integer,
  p_fecha date,
  p_hora time,
  p_sitio text default null,
  p_creado_en timestamptz default null
)
returns public.liberaciones
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usuario bigint := public.usuario_de_sesion();
  v_nido_id bigint;
  v_fila public.liberaciones;
begin
  if p_client_id is null or p_nido_clave is null or p_fecha is null or p_hora is null then
    raise exception using errcode = 'NE003', message = 'Faltan el identificador, el nido, la fecha o la hora.';
  end if;
  if p_cantidad_liberada is null or p_cantidad_liberada <= 0 then
    raise exception using errcode = 'NE003', message = 'La cantidad de crías debe ser un entero mayor que 0.';
  end if;

  -- Reenvío: la liberación ya existe.
  select * into v_fila from public.liberaciones where client_id = p_client_id;
  if found then
    if v_fila.responsable_id is distinct from v_usuario then
      raise exception using errcode = 'NE007', message = 'Esa liberación ya la registró otro usuario.';
    end if;
    return v_fila;
  end if;

  select id into v_nido_id from public.nidos where clave = p_nido_clave;
  if v_nido_id is null then
    raise exception using errcode = 'NE001', message = 'El nido de la liberación aún no está en el servidor.';
  end if;

  insert into public.liberaciones (client_id, nido_id, fecha, hora, cantidad_liberada, sitio,
                                   responsable_id, pendiente_envio, creado_en)
  values (p_client_id, v_nido_id, p_fecha, p_hora, p_cantidad_liberada, nullif(btrim(p_sitio), ''),
          v_usuario, false, coalesce(p_creado_en, now()))
  on conflict (client_id) do nothing
  returning * into v_fila;

  if v_fila.id is null then
    select * into v_fila from public.liberaciones where client_id = p_client_id;
    if v_fila.responsable_id is distinct from v_usuario then
      raise exception using errcode = 'NE007', message = 'Esa liberación ya la registró otro usuario.';
    end if;
  end if;
  return v_fila;
end;
$$;
revoke all on function public.registrar_liberacion(uuid, text, integer, date, time, text, timestamptz) from public, anon;
grant execute on function public.registrar_liberacion(uuid, text, integer, date, time, text, timestamptz) to authenticated;

commit;

notify pgrst, 'reload schema';
