-- HU-11 · Registrar la eclosión con crías vivas y muertas (issue #12).
--
-- Qué agrega:
--   1. Columnas crias_vivas (si faltara), crias_muertas y fecha_eclosion; CHECKs de no negativos.
--   2. Trigger nidos_validar_transicion: al quedar eclosionado exige crías vivas y muertas,
--      que su suma no pase de huevos_contados y la fecha de eclosión (NE003).
--   3. RPC registrar_eclosion(): solo desde en_corral (NE002), idempotente.
--   4. Vista nidos_activos recreada: `n.*` se expande al crear la vista, así que sin esto
--      no traería las columnas nuevas.
--
-- Requiere HU-10, auth_1 a auth_3, HU-12, HU-13 y HU-16. Re-ejecutable.
-- Correr completo en Supabase → SQL Editor.

begin;

-- 1. Columnas y CHECKs.
alter table public.nidos add column if not exists crias_vivas integer;
alter table public.nidos add column if not exists crias_muertas integer;
alter table public.nidos add column if not exists fecha_eclosion date;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.nidos'::regclass and conname = 'nidos_crias_no_negativas') then
    alter table public.nidos add constraint nidos_crias_no_negativas
      check ((crias_vivas is null or crias_vivas >= 0) and (crias_muertas is null or crias_muertas >= 0));
  end if;
end $$;

-- 2. Trigger de la máquina de estados.
--    Códigos: NE001 nido no encontrado · NE002 transición no permitida · NE003 datos inválidos
--             NE004 especie sin días · NE005 nido perdido (cerrado) · NE006 solo coordinador
--    HU-11: al quedar eclosionado se validan crías y fecha de eclosión.
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

  -- HU-11: eclosión. Se valida al entrar a eclosionado y si cambian sus datos.
  if new.estado::text = 'eclosionado' and (
       old.estado::text is distinct from 'eclosionado'
       or new.crias_vivas is distinct from old.crias_vivas
       or new.crias_muertas is distinct from old.crias_muertas
       or new.fecha_eclosion is distinct from old.fecha_eclosion
       or new.huevos_contados is distinct from old.huevos_contados
     ) then
    if new.crias_vivas is null or new.crias_muertas is null or new.crias_vivas < 0 or new.crias_muertas < 0 then
      raise exception using errcode = 'NE003', message = 'Faltan las crías vivas o las muertas (enteros de 0 en adelante).';
    end if;
    if new.huevos_contados is null or new.crias_vivas + new.crias_muertas > new.huevos_contados then
      raise exception using
        errcode = 'NE003',
        message = format('Crías vivas más muertas (%s) no pueden superar los huevos registrados (%s).',
                         new.crias_vivas + new.crias_muertas, coalesce(new.huevos_contados::text, 'sin registrar'));
    end if;
    if new.fecha_eclosion is null then
      raise exception using errcode = 'NE003', message = 'Falta la fecha de eclosión.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists nidos_validar_transicion on public.nidos;
create trigger nidos_validar_transicion
  before insert or update or delete on public.nidos
  for each row execute function public.nidos_validar_transicion();

-- 3. RPC registrar_eclosion.
--
-- SECURITY DEFINER, justificación: RLS de nidos solo da SELECT a authenticated (auth_3) y
-- una política de UPDATE abriría todas las columnas. Aquí la única escritura posible es
-- en_corral → eclosionado. Mitigaciones: sesión obligatoria (NE008); un voluntario solo
-- puede tocar nidos de tramos de su campamento (como la RLS de HU-13); validación de todos
-- los parámetros; FOR UPDATE contra carreras; el trigger vuelve a validar; search_path vacío;
-- EXECUTE solo para authenticated.
--
-- Idempotente: si el nido ya está eclosionado con los mismos datos, devuelve la fila sin cambios.
create or replace function public.registrar_eclosion(
  p_clave text,
  p_crias_vivas integer,
  p_crias_muertas integer,
  p_fecha_eclosion date
)
returns public.nidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario bigint := public.usuario_de_sesion();
  v_nido public.nidos;
begin
  if p_clave is null or btrim(p_clave) = '' then
    raise exception using errcode = 'NE003', message = 'Falta la clave del nido.';
  end if;
  if p_crias_vivas is null or p_crias_muertas is null or p_crias_vivas < 0 or p_crias_muertas < 0 then
    raise exception using errcode = 'NE003', message = 'Faltan las crías vivas o las muertas (enteros de 0 en adelante).';
  end if;
  -- El servidor está en UTC y México va detrás: un día de margen para la fecha local.
  if p_fecha_eclosion is null or p_fecha_eclosion > current_date + 1 then
    raise exception using errcode = 'NE003', message = 'La fecha de eclosión falta o está en el futuro.';
  end if;

  select * into v_nido
    from public.nidos
   where clave = p_clave
   for update;

  if not found then
    raise exception using errcode = 'NE001', message = format('No existe un nido con la clave %s.', p_clave);
  end if;

  if not public.es_coordinador() and not exists (
       select 1 from public.tramos t
        where t.id = v_nido.tramo_id and t.campamento_id = public.campamento_actual_id()) then
    raise exception using errcode = 'NE003', message = 'El nido no es de tu campamento.';
  end if;

  if v_nido.estado::text = 'perdido' then
    raise exception using
      errcode = 'NE005',
      message = format('El nido %s está perdido y ya no se puede modificar.', v_nido.clave);
  end if;

  if v_nido.estado::text = 'eclosionado' then
    if v_nido.crias_vivas = p_crias_vivas
       and v_nido.crias_muertas = p_crias_muertas
       and v_nido.fecha_eclosion = p_fecha_eclosion then
      return v_nido;
    end if;
    raise exception using errcode = 'NE002', message = 'El nido ya está eclosionado con otros datos.';
  end if;

  if v_nido.estado::text <> 'en_corral' then
    raise exception using
      errcode = 'NE002',
      message = format('Solo se puede registrar la eclosión de un nido en corral; este está %s.', v_nido.estado);
  end if;

  if p_crias_vivas + p_crias_muertas > v_nido.huevos_contados then
    raise exception using
      errcode = 'NE003',
      message = format('Crías vivas más muertas (%s) no pueden superar los huevos registrados (%s).',
                       p_crias_vivas + p_crias_muertas, v_nido.huevos_contados);
  end if;
  if v_nido.fecha_reubicacion is not null and p_fecha_eclosion < v_nido.fecha_reubicacion then
    raise exception using errcode = 'NE003', message = 'La fecha de eclosión no puede ser anterior a la reubicación.';
  end if;

  update public.nidos
     set estado = 'eclosionado',
         crias_vivas = p_crias_vivas,
         crias_muertas = p_crias_muertas,
         fecha_eclosion = p_fecha_eclosion
   where id = v_nido.id
  returning * into v_nido;

  return v_nido;
end;
$$;

revoke all on function public.registrar_eclosion(text, integer, integer, date) from public, anon, authenticated;
grant execute on function public.registrar_eclosion(text, integer, integer, date) to authenticated;

-- 4. Nidos activos (igual que HU-13, recreada para que traiga las columnas nuevas).
drop view if exists public.nidos_activos;
create view public.nidos_activos
with (security_invoker = true)
as
select n.*,
       t.campamento_id,
       case when n.crias_vivas is null then null
            else greatest(n.crias_vivas - coalesce(l.liberadas, 0), 0)
       end as crias_por_liberar
  from public.nidos n
  left join public.tramos t on t.id = n.tramo_id
  left join (
    select nido_id, sum(cantidad_liberada) as liberadas
      from public.liberaciones
     group by nido_id
  ) l on l.nido_id = n.id
 where n.estado::text in ('registrado', 'en_corral')
    or (n.estado::text = 'eclosionado'
        and (n.crias_vivas is null or n.crias_vivas > coalesce(l.liberadas, 0)));

revoke all on public.nidos_activos from public, anon, authenticated;
grant select on public.nidos_activos to authenticated;

commit;

-- Que PostgREST vea las columnas y la función nuevas sin esperar.
notify pgrst, 'reload schema';
