-- HU-12 · Marcar un nido como perdido indicando la causa (issue #13).
--
-- Máquina de estados del nido (espejo de src/js/estados-nido.js):
--   registrado  → en_corral | perdido
--   en_corral   → eclosionado | perdido
--   eclosionado → perdido
--   perdido es final: el nido queda cerrado y ya no cambia nada (NE005).
--
-- Qué agrega:
--   1. Columnas fecha_perdida y perdido_por; CHECKs de causa válida y de nido perdido con causa.
--   2. Trigger nidos_validar_transicion: nuevas transiciones, NE005 sobre nidos perdidos
--      (UPDATE y DELETE) y validación de la causa al marcar perdido.
--   3. reubicar_nido: responde NE005 si el nido está perdido.
--   4. RPC marcar_nido_perdido(): solo el coordinador (NE006, por auth.uid()).
--
-- Requiere las migraciones de HU-10 y auth_1 a auth_3.
-- Re-ejecutable. Correr completo en Supabase → SQL Editor.

begin;

-- 1. Columnas y CHECKs. causa_perdida ya existe; se crea si faltara.
alter table public.nidos add column if not exists causa_perdida text;
alter table public.nidos add column if not exists fecha_perdida date;

-- perdido_por: mismo tipo que usuarios.id (se lee del catálogo, como en auth_3).
do $$
declare
  v_tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format(
    'alter table public.nidos add column if not exists perdido_por %s
       references public.usuarios (id) on delete set null', v_tipo_usuario);
end $$;

-- Si hay nidos perdidos sin causa o con una causa fuera del catálogo, se aborta y se listan.
do $$
declare
  v_invalidos text;
begin
  select string_agg(format('%s (%s)', clave, coalesce(causa_perdida, 'sin causa')), ', ')
    into v_invalidos
    from public.nidos
   where (causa_perdida is not null and causa_perdida not in ('depredacion', 'saqueo', 'marea', 'inviable'))
      or (estado::text = 'perdido' and causa_perdida is null);
  if v_invalidos is not null then
    raise exception 'Nidos con causa de pérdida inválida o faltante: %. Corrígelos y vuelve a correr la migración.', v_invalidos;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.nidos'::regclass and conname = 'nidos_causa_perdida_valida') then
    alter table public.nidos add constraint nidos_causa_perdida_valida
      check (causa_perdida is null or causa_perdida in ('depredacion', 'saqueo', 'marea', 'inviable'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.nidos'::regclass and conname = 'nidos_perdido_con_causa') then
    alter table public.nidos add constraint nidos_perdido_con_causa
      check (estado::text <> 'perdido' or causa_perdida is not null);
  end if;
end $$;

-- 2. Trigger de la máquina de estados.
--    Códigos: NE001 nido no encontrado · NE002 transición no permitida · NE003 datos inválidos
--             NE004 especie sin días · NE005 nido perdido (cerrado) · NE006 solo coordinador
create or replace function public.nidos_validar_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dias integer;
begin
  -- Un nido perdido queda cerrado: ni cambios ni borrado, por ninguna vía.
  if tg_op in ('UPDATE', 'DELETE') and old.estado::text = 'perdido' then
    raise exception using
      errcode = 'NE005',
      message = format('El nido %s está perdido y ya no se puede modificar.', old.clave);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

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
                      when 'eclosionado' then new.estado::text = 'perdido'
                      else false
                    end, false) then
      raise exception using
        errcode = 'NE002',
        message = format('Transición de estado no permitida: %s → %s.', old.estado, coalesce(new.estado::text, 'null'));
    end if;
  end if;

  if new.estado::text = 'perdido' then
    if new.causa_perdida is null or new.causa_perdida not in ('depredacion', 'saqueo', 'marea', 'inviable') then
      raise exception using
        errcode = 'NE003',
        message = 'La causa de pérdida debe ser depredacion, saqueo, marea o inviable.';
    end if;
    if new.fecha_perdida is null then
      raise exception using errcode = 'NE003', message = 'Falta la fecha de la pérdida.';
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
  before insert or update or delete on public.nidos
  for each row execute function public.nidos_validar_transicion();

-- 3. reubicar_nido (HU-10): igual que antes, pero un nido perdido responde NE005.
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

  if v_nido.estado::text = 'perdido' then
    raise exception using
      errcode = 'NE005',
      message = format('El nido %s está perdido y ya no se puede modificar.', v_nido.clave);
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

-- 4. RPC marcar_nido_perdido.
--
-- SECURITY DEFINER, justificación: RLS de nidos solo da SELECT a authenticated (auth_3) y
-- una política de UPDATE abriría todas las columnas a cualquier usuario. Aquí la única
-- escritura posible es esta transición, y solo para el coordinador.
-- Mitigaciones: el rol se valida con es_coordinador(), que lee usuarios por auth.uid()
-- (nada que mande el cliente); search_path vacío y nombres calificados; validación de
-- todos los parámetros; FOR UPDATE contra carreras; el trigger vuelve a validar;
-- EXECUTE solo para authenticated.
--
-- Idempotente: si el nido ya está perdido con la misma causa, devuelve la fila sin cambios.
create or replace function public.marcar_nido_perdido(
  p_clave text,
  p_causa text,
  p_fecha_perdida date
)
returns public.nidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nido public.nidos;
begin
  if not public.es_coordinador() then
    raise exception using
      errcode = 'NE006',
      message = 'Solo el coordinador puede marcar un nido como perdido.';
  end if;

  if p_clave is null or btrim(p_clave) = '' then
    raise exception using errcode = 'NE003', message = 'Falta la clave del nido.';
  end if;
  if p_causa is null or p_causa not in ('depredacion', 'saqueo', 'marea', 'inviable') then
    raise exception using
      errcode = 'NE003',
      message = 'La causa de pérdida debe ser depredacion, saqueo, marea o inviable.';
  end if;
  -- El servidor está en UTC y México va detrás: un día de margen para la fecha local.
  if p_fecha_perdida is null or p_fecha_perdida > current_date + 1 then
    raise exception using errcode = 'NE003', message = 'La fecha de la pérdida falta o está en el futuro.';
  end if;

  select * into v_nido
    from public.nidos
   where clave = p_clave
   for update;

  if not found then
    raise exception using errcode = 'NE001', message = format('No existe un nido con la clave %s.', p_clave);
  end if;

  if v_nido.estado::text = 'perdido' then
    if v_nido.causa_perdida = p_causa then
      return v_nido;
    end if;
    raise exception using
      errcode = 'NE005',
      message = format('El nido %s ya está perdido por %s.', v_nido.clave, v_nido.causa_perdida);
  end if;

  if v_nido.fecha_hallazgo is not null and p_fecha_perdida < v_nido.fecha_hallazgo then
    raise exception using
      errcode = 'NE003',
      message = 'La fecha de la pérdida no puede ser anterior al hallazgo.';
  end if;

  update public.nidos
     set estado = 'perdido',
         causa_perdida = p_causa,
         fecha_perdida = p_fecha_perdida,
         perdido_por = public.usuario_actual_id()
   where id = v_nido.id
  returning * into v_nido;

  return v_nido;
end;
$$;

revoke all on function public.marcar_nido_perdido(text, text, date) from public, anon, authenticated;
grant execute on function public.marcar_nido_perdido(text, text, date) to authenticated;

commit;

-- Que PostgREST vea las columnas y la función nuevas sin esperar.
notify pgrst, 'reload schema';
