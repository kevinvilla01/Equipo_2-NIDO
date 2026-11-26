-- HU-13 · Nidos activos del campamento sin conexión (issue #14).
--
-- Hasta ahora la base no tenía campamentos: todos veían todos los nidos. Esta migración
-- agrega el campamento y deja que el servidor decida qué nidos ve cada quien.
--
-- Qué agrega:
--   1. Tabla campamentos (catálogo). Si está vacía se crea "Campamento principal".
--   2. campamento_por_defecto(): el primer campamento. Es el DEFAULT de las columnas
--      nuevas, para que las altas actuales (alta-tramo, Edge Function usuarios-admin)
--      sigan funcionando sin mandar el campamento.
--   3. tramos.campamento_id y usuarios.campamento_id (NOT NULL). Los existentes quedan
--      en el campamento por defecto.
--   4. campamento_actual_id(): campamento del usuario que llama (por auth.uid()).
--   5. Política nidos_leer: el voluntario solo lee los nidos cuyos tramos son de su
--      campamento; el coordinador los lee todos. Aplica a toda la app (lista, informe,
--      liberaciones), no solo a esta pantalla.
--   6. Vista nidos_activos (security_invoker: respeta la RLS de nidos): nidos que no
--      están perdidos ni liberados, con el campamento del tramo y las crías por liberar.
--      Es lo que la app descarga al tener señal.
--
-- "Liberado" no es un estado del nido: un nido eclosionado está liberado cuando la suma
-- de liberaciones.cantidad_liberada llega a crias_vivas. Si crias_vivas es null (aún no
-- se cuentan) el nido sigue activo.
--
-- Requiere las migraciones de auth_1 a auth_3 y HU-12.
-- Re-ejecutable. Correr completo en Supabase → SQL Editor ANTES de desplegar el frontend:
-- el login lee usuarios.campamento_id (si falta la columna, sesion.js entra sin ella).

begin;

-- 1. Catálogo de campamentos.
create table if not exists public.campamentos (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  creado_en timestamptz not null default now(),
  constraint campamentos_nombre_unico unique (nombre),
  constraint campamentos_nombre_no_vacio check (btrim(nombre) <> '')
);

insert into public.campamentos (nombre)
select 'Campamento principal'
 where not exists (select 1 from public.campamentos);

alter table public.campamentos enable row level security;

drop policy if exists campamentos_leer on public.campamentos;
drop policy if exists campamentos_coordinador_inserta on public.campamentos;
drop policy if exists campamentos_coordinador_edita on public.campamentos;
drop policy if exists campamentos_coordinador_borra on public.campamentos;

create policy campamentos_leer on public.campamentos
  for select to authenticated using (true);
create policy campamentos_coordinador_inserta on public.campamentos
  for insert to authenticated with check (public.es_coordinador());
create policy campamentos_coordinador_edita on public.campamentos
  for update to authenticated using (public.es_coordinador()) with check (public.es_coordinador());
create policy campamentos_coordinador_borra on public.campamentos
  for delete to authenticated using (public.es_coordinador());

revoke all on public.campamentos from anon, public;
revoke truncate, trigger, references on public.campamentos from authenticated;
grant select, insert, update, delete on public.campamentos to authenticated;

-- 2. Campamento por defecto (el más antiguo). SECURITY DEFINER para que el DEFAULT
--    funcione igual con authenticated y con service_role.
create or replace function public.campamento_por_defecto()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.campamentos c order by c.id limit 1
$$;

revoke all on function public.campamento_por_defecto() from public, anon;
grant execute on function public.campamento_por_defecto() to authenticated;

-- 3. Tramos y usuarios pertenecen a un campamento. El nido hereda el de su tramo.
alter table public.tramos
  add column if not exists campamento_id bigint references public.campamentos (id) on delete restrict;
alter table public.tramos
  alter column campamento_id set default public.campamento_por_defecto();
update public.tramos set campamento_id = public.campamento_por_defecto() where campamento_id is null;
alter table public.tramos alter column campamento_id set not null;

alter table public.usuarios
  add column if not exists campamento_id bigint references public.campamentos (id) on delete restrict;
alter table public.usuarios
  alter column campamento_id set default public.campamento_por_defecto();
update public.usuarios set campamento_id = public.campamento_por_defecto() where campamento_id is null;
alter table public.usuarios alter column campamento_id set not null;

create index if not exists tramos_campamento_id_idx on public.tramos (campamento_id);

-- 4. Campamento de quien llama. Null con anon o con un usuario inactivo.
create or replace function public.campamento_actual_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.campamento_id
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.activo
$$;

revoke all on function public.campamento_actual_id() from public, anon;
grant execute on function public.campamento_actual_id() to authenticated;

-- 5. Lectura de nidos por campamento (antes: using (true)).
drop policy if exists nidos_leer on public.nidos;
create policy nidos_leer on public.nidos
  for select to authenticated
  using (
    public.es_coordinador()
    or exists (
      select 1
        from public.tramos t
       where t.id = nidos.tramo_id
         and t.campamento_id = public.campamento_actual_id()
    )
  );

-- 6. Nidos activos: ni perdidos ni liberados. security_invoker = la RLS de nidos,
--    tramos y liberaciones se aplica con el usuario que consulta.
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

notify pgrst, 'reload schema';

-- Revisión rápida: campamentos y cuántos tramos y usuarios tiene cada uno.
select c.id, c.nombre,
       (select count(*) from public.tramos t where t.campamento_id = c.id)   as tramos,
       (select count(*) from public.usuarios u where u.campamento_id = c.id) as usuarios
  from public.campamentos c
 order by c.id;
