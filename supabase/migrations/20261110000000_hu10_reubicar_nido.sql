-- HU-10 · Reubicar el nido al corral (issue #11).
--
-- Máquina de estados del nido en el servidor, espejo de src/js/estados-nido.js:
--   registrado → en_corral | perdido
--   en_corral  → eclosionado | perdido
--   eclosionado y perdido son finales.
--
-- Qué agrega:
--   1. Valores del enum de estado (solo si `estado` es enum; si es texto no hace nada).
--   2. Columna fecha_reubicacion.
--   3. UNIQUE (clave), con revisión previa de duplicados.
--   4. CHECKs de estado válido y de nido en corral completo.
--   5. Trigger que valida toda transición (por cualquier vía: REST, RPC, SQL Editor)
--      y recalcula la fecha estimada de eclosión con los días de la especie.
--   6. RPC reubicar_nido(): única vía de escritura para la app. Contrato en el README
--      ("Máquina de estados del nido").
--
-- Re-ejecutable: cada paso revisa si ya existe antes de crearlo.
-- Correr completo en Supabase → SQL Editor.

begin;

-- 1. Si `estado` es un enum, se asegura de que tenga los cuatro valores.
--    Todo lo demás compara estado::text, así que no usa los valores nuevos en esta transacción.
do $$
declare
  v_tipo regtype;
  v_es_enum boolean;
  v_valor text;
begin
  select a.atttypid::regtype, t.typtype = 'e'
    into v_tipo, v_es_enum
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.nidos'::regclass
     and a.attname = 'estado'
     and not a.attisdropped;

  if v_es_enum then
    foreach v_valor in array array['registrado', 'en_corral', 'eclosionado', 'perdido'] loop
      execute format('alter type %s add value if not exists %L', v_tipo, v_valor);
    end loop;
  end if;
end $$;

-- 2. Fecha en que el nido se movió al corral (fecha local del teléfono).
alter table public.nidos add column if not exists fecha_reubicacion date;

-- 3. La clave identifica al nido desde el teléfono (UUID de cliente) y es la llave
--    del upsert idempotente de HU-16. Si hay duplicados se aborta y se listan.
do $$
declare
  v_duplicadas text;
begin
  if exists (
    select 1
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indrelid = 'public.nidos'::regclass
       and i.indisunique
       and i.indnkeyatts = 1
       and a.attname = 'clave'
  ) then
    return;
  end if;

  select string_agg(format('%s (%s filas)', clave, total), ', ')
    into v_duplicadas
    from (
      select clave, count(*) as total
        from public.nidos
       where clave is not null
       group by clave
      having count(*) > 1
    ) d;

  if v_duplicadas is not null then
    raise exception 'Hay claves de nido duplicadas: %. Corrígelas y vuelve a correr la migración.', v_duplicadas;
  end if;

  alter table public.nidos add constraint nidos_clave_unica unique (clave);
end $$;

-- 4. Red de seguridad a nivel de fila, además del trigger.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.nidos'::regclass and conname = 'nidos_estado_valido') then
    alter table public.nidos add constraint nidos_estado_valido
      check (estado::text in ('registrado', 'en_corral', 'eclosionado', 'perdido'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.nidos'::regclass and conname = 'nidos_en_corral_completo') then
    alter table public.nidos add constraint nidos_en_corral_completo
      check (
        estado::text <> 'en_corral'
        or (
          corral is not null and btrim(corral) <> ''
          and huevos_contados is not null and huevos_contados > 0
          and fecha_reubicacion is not null
          and fecha_estimada_eclosion is not null
        )
      );
  end if;
end $$;

-- 5. Trigger de la máquina de estados.
--    Códigos de error propios (PostgREST los devuelve como HTTP 400 con `code`):
--      NE001 nido no encontrado · NE002 transición no permitida
--      NE003 datos de reubicación inválidos · NE004 especie sin días de incubación
create or replace function public.nidos_validar_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dias integer;
begin
  -- Todo nido nace registrado; los demás estados solo se alcanzan por transición.
  if tg_op = 'INSERT' then
    if new.estado is null or new.estado::text <> 'registrado' then
      raise exception using
        errcode = 'NE002',
        message = format('Un nido nuevo debe entrar como registrado, no como %s.', coalesce(new.estado::text, 'null'));
    end if;
    return new;
  end if;

  if new.estado::text is distinct from old.estado::text then
    if not coalesce(case old.estado::text
                      when 'registrado' then new.estado::text in ('en_corral', 'perdido')
                      when 'en_corral' then new.estado::text in ('eclosionado', 'perdido')
                      else false
                    end, false) then
      raise exception using
        errcode = 'NE002',
        message = format('Transición de estado no permitida: %s → %s.', old.estado, coalesce(new.estado::text, 'null'));
    end if;
  end if;

  -- Al entrar al corral (o si cambian los datos de los que depende) la fecha estimada
  -- la calcula el servidor; lo que mande el cliente en esa columna se ignora.
  if new.estado::text = 'en_corral' and (
       old.estado::text is distinct from 'en_corral'
       or new.fecha_reubicacion is distinct from old.fecha_reubicacion
       or new.especie_id is distinct from old.especie_id
       or new.fecha_estimada_eclosion is distinct from old.fecha_estimada_eclosion
     ) then
    if new.corral is null or btrim(new.corral) = '' then
      raise exception using errcode = 'NE003', message = 'Falta la clave del corral.';
    end if;
    if new.huevos_contados is null or new.huevos_contados <= 0 then
      raise exception using errcode = 'NE003', message = 'El número de huevos debe ser un entero mayor que 0.';
    end if;
    if new.fecha_reubicacion is null then
      raise exception using errcode = 'NE003', message = 'Falta la fecha de reubicación.';
    end if;

    select e.dias_incubacion_estimados into v_dias
      from public.especies e
     where e.id = new.especie_id;
    if v_dias is null or v_dias <= 0 then
      raise exception using
        errcode = 'NE004',
        message = 'La especie del nido no tiene días de incubación registrados.';
    end if;

    new.fecha_estimada_eclosion := new.fecha_reubicacion + v_dias;
  end if;

  return new;
end;
$$;

drop trigger if exists nidos_validar_transicion on public.nidos;
create trigger nidos_validar_transicion
  before insert or update on public.nidos
  for each row execute function public.nidos_validar_transicion();

-- 6. RPC de reubicación.
--
-- SECURITY DEFINER, justificación: las políticas RLS de nidos solo permiten SELECT a anon
-- y la app todavía no usa Supabase Auth (todo llega como anon). Dar a anon una política de
-- UPDATE sobre nidos le permitiría cambiar cualquier columna de cualquier nido. Con esta
-- función, anon solo puede hacer esta transición, con estos datos y validados aquí.
-- Mitigaciones: search_path vacío y nombres calificados, validación de todos los
-- parámetros, FOR UPDATE contra carreras, el trigger vuelve a validar y EXECUTE solo
-- para anon/authenticated. Cuando exista Supabase Auth, revisar aquí el rol de quien llama.
--
-- Idempotente: si el nido ya está en corral con los mismos datos, devuelve la fila sin cambios.
create or replace function public.reubicar_nido(
  p_clave text,
  p_corral text,
  p_huevos integer,
  p_fecha_reubicacion date
)
returns public.nidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nido public.nidos;
  v_corral text := btrim(p_corral);
begin
  if p_clave is null or btrim(p_clave) = '' then
    raise exception using errcode = 'NE003', message = 'Falta la clave del nido.';
  end if;
  if v_corral is null or v_corral = '' then
    raise exception using errcode = 'NE003', message = 'Falta la clave del corral.';
  end if;
  if p_huevos is null or p_huevos <= 0 then
    raise exception using errcode = 'NE003', message = 'El número de huevos debe ser un entero mayor que 0.';
  end if;
  -- El servidor está en UTC y México va detrás: un día de margen para la fecha local.
  if p_fecha_reubicacion is null or p_fecha_reubicacion > current_date + 1 then
    raise exception using errcode = 'NE003', message = 'La fecha de reubicación falta o está en el futuro.';
  end if;

  select * into v_nido
    from public.nidos
   where clave = p_clave
   for update;

  if not found then
    raise exception using errcode = 'NE001', message = format('No existe un nido con la clave %s.', p_clave);
  end if;

  if v_nido.estado::text = 'en_corral' then
    if v_nido.corral = v_corral
       and v_nido.huevos_contados = p_huevos
       and v_nido.fecha_reubicacion = p_fecha_reubicacion then
      return v_nido;
    end if;
    raise exception using
      errcode = 'NE002',
      message = 'El nido ya está en corral con otros datos.';
  end if;

  if v_nido.estado::text <> 'registrado' then
    raise exception using
      errcode = 'NE002',
      message = format('Solo se puede reubicar un nido registrado; este está %s.', v_nido.estado);
  end if;

  if v_nido.fecha_hallazgo is not null and p_fecha_reubicacion < v_nido.fecha_hallazgo then
    raise exception using
      errcode = 'NE003',
      message = 'La fecha de reubicación no puede ser anterior al hallazgo.';
  end if;

  update public.nidos
     set estado = 'en_corral',
         corral = v_corral,
         huevos_contados = p_huevos,
         fecha_reubicacion = p_fecha_reubicacion
   where id = v_nido.id
  returning * into v_nido;

  return v_nido;
end;
$$;

revoke all on function public.reubicar_nido(text, text, integer, date) from public, anon, authenticated;
grant execute on function public.reubicar_nido(text, text, integer, date) to anon, authenticated;

commit;

-- Que PostgREST vea la columna y la función nuevas sin esperar.
notify pgrst, 'reload schema';
