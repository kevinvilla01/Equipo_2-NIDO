-- Autenticación · paso 3: RLS de las demás tablas de public.
--
-- Correr después de 20261116000100_auth_2_cerrar_usuarios.sql y con el frontend nuevo
-- desplegado (toda la app ya llega como `authenticated`).
--
-- Reglas:
--   - anon: sin escritura en ninguna tabla. Solo conserva SELECT en keepalive
--     (lo usa .github/workflows/keep-alive.yml para que el proyecto no se pause).
--   - authenticated: solo lo que la app usa hoy (inventario en el README, "Permisos").
--   - Se borran TODAS las políticas existentes de estas tablas y se crean de nuevo
--     con nombres en español, para que no queden plantillas {public} sueltas.
--
-- Funciones usadas (paso 1): public.es_coordinador(), public.usuario_actual_id().

begin;

-- 0. RLS activada en todas las tablas que se tocan aquí.
alter table public.especies              enable row level security;
alter table public.tramos                enable row level security;
alter table public.keepalive             enable row level security;
alter table public.nidos                 enable row level security;
alter table public.liberaciones          enable row level security;
alter table public.patrullajes           enable row level security;
alter table public.patrullaje_voluntario enable row level security;

-- 1. Borra todas las políticas de estas tablas.
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('especies', 'tramos', 'keepalive', 'nidos', 'liberaciones',
                         'patrullajes', 'patrullaje_voluntario')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- 2. GRANTs. Supabase da por defecto ALL a anon y authenticated, y RLS no aplica a
--    TRUNCATE (ni a REFERENCES/TRIGGER), así que se cierran aquí para todo el esquema.
--
--    anon: solo SELECT en keepalive. Nada en secuencias ni funciones de public.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select on public.keepalive to anon;

--    authenticated: nunca TRUNCATE / TRIGGER / REFERENCES. SELECT/INSERT/UPDATE/DELETE
--    quedan a cargo de RLS (y de los REVOKE puntuales de más abajo).
revoke truncate, trigger, references on all tables in schema public from authenticated;

--    Las funciones internas no se llaman por RPC.
revoke execute on function public.nidos_validar_transicion() from authenticated;
revoke execute on function public.usuarios_proteger() from authenticated;

--    Default privileges: que una tabla, secuencia o función nueva no nazca abierta.
--    Se ajustan para cada rol que crea objetos en public (postgres desde el SQL Editor,
--    supabase_admin desde el Dashboard). Si un rol no se puede alterar desde aquí,
--    se avisa en vez de abortar; la verificación del final lo muestra.
do $$
declare
  v_rol text;
begin
  foreach v_rol in array array['postgres', 'supabase_admin'] loop
    begin
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', v_rol);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', v_rol);
      execute format('alter default privileges for role %I in schema public revoke all on functions from anon, public', v_rol);
      execute format('alter default privileges for role %I in schema public revoke truncate, trigger, references on tables from authenticated', v_rol);
    exception when insufficient_privilege then
      raise warning 'No se pudieron ajustar los default privileges de %: %', v_rol, sqlerrm;
    end;
  end loop;
end $$;

create policy keepalive_leer on public.keepalive
  for select to anon, authenticated using (true);

-- 3. Catálogos (especies, tramos): todos los leen; solo el coordinador los edita
--    (pantallas alta-especie / alta-tramo de Catálogos).
create policy especies_leer on public.especies
  for select to authenticated using (true);
create policy especies_coordinador_inserta on public.especies
  for insert to authenticated with check (public.es_coordinador());
create policy especies_coordinador_edita on public.especies
  for update to authenticated using (public.es_coordinador()) with check (public.es_coordinador());
create policy especies_coordinador_borra on public.especies
  for delete to authenticated using (public.es_coordinador());

create policy tramos_leer on public.tramos
  for select to authenticated using (true);
create policy tramos_coordinador_inserta on public.tramos
  for insert to authenticated with check (public.es_coordinador());
create policy tramos_coordinador_edita on public.tramos
  for update to authenticated using (public.es_coordinador()) with check (public.es_coordinador());
create policy tramos_coordinador_borra on public.tramos
  for delete to authenticated using (public.es_coordinador());

-- 4. Nidos: solo lectura. Los cambios de estado van por RPC (reubicar_nido, HU-12).
create policy nidos_leer on public.nidos
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.nidos from authenticated;
revoke execute on function public.reubicar_nido(text, text, integer, date) from anon;

-- 5. Liberaciones: todos leen; cada quien registra a su nombre.
create policy liberaciones_leer on public.liberaciones
  for select to authenticated using (true);
create policy liberaciones_registrar_propia on public.liberaciones
  for insert to authenticated
  with check (responsable_id = public.usuario_actual_id());
revoke update, delete, truncate on public.liberaciones from authenticated;

-- 6. Patrullajes. No tenían dueño, así que cualquiera podía editar o borrar cualquiera.
--    creado_por lo pone el servidor (default) y no se puede falsificar (with check).
--    Editar / borrar: quien lo creó, un voluntario asignado a él, o el coordinador.
--    Las filas viejas quedan con creado_por null: solo el coordinador (o los asignados).
-- Los tipos se leen del catálogo (usuarios.id, patrullajes.id) para no suponerlos.
do $$
declare
  v_tipo_usuario text;
  v_tipo_patrullaje text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into v_tipo_patrullaje
    from pg_attribute a
   where a.attrelid = 'public.patrullajes'::regclass and a.attname = 'id' and not a.attisdropped;

  execute format(
    'alter table public.patrullajes add column if not exists creado_por %s
       references public.usuarios (id) on delete set null', v_tipo_usuario);

  execute format($f$
    create or replace function public.puede_editar_patrullaje(p_patrullaje_id %1$s)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $b$
      select public.es_coordinador()
          or exists (select 1 from public.patrullajes p
                      where p.id = p_patrullaje_id
                        and p.creado_por = public.usuario_actual_id())
          or exists (select 1 from public.patrullaje_voluntario pv
                      where pv.patrullaje_id = p_patrullaje_id
                        and pv.usuario_id = public.usuario_actual_id())
    $b$;
    revoke all on function public.puede_editar_patrullaje(%1$s) from public, anon;
    grant execute on function public.puede_editar_patrullaje(%1$s) to authenticated;
  $f$, v_tipo_patrullaje);
end $$;

alter table public.patrullajes
  alter column creado_por set default public.usuario_actual_id();

create policy patrullajes_leer on public.patrullajes
  for select to authenticated using (true);
create policy patrullajes_registrar on public.patrullajes
  for insert to authenticated
  with check (public.usuario_actual_id() is not null
              and creado_por = public.usuario_actual_id());
create policy patrullajes_editar on public.patrullajes
  for update to authenticated
  using (public.puede_editar_patrullaje(id))
  with check (public.puede_editar_patrullaje(id));
create policy patrullajes_borrar on public.patrullajes
  for delete to authenticated
  using (public.puede_editar_patrullaje(id));

create policy patrullaje_voluntario_leer on public.patrullaje_voluntario
  for select to authenticated using (true);
create policy patrullaje_voluntario_asignar on public.patrullaje_voluntario
  for insert to authenticated
  with check (public.puede_editar_patrullaje(patrullaje_id));
create policy patrullaje_voluntario_quitar on public.patrullaje_voluntario
  for delete to authenticated
  using (public.puede_editar_patrullaje(patrullaje_id));
revoke update, truncate on public.patrullaje_voluntario from authenticated;

commit;

notify pgrst, 'reload schema';

-- Resultado para revisar (el SQL Editor solo muestra la última consulta, por eso va todo junto):
--   politica  → cada política y a quién aplica
--   grant     → privilegios de anon / authenticated por tabla
--   default   → privilegios que recibirá un objeto nuevo en public
select 'politica' as tipo, tablename as objeto,
       policyname || ' · ' || cmd || ' · ' || array_to_string(roles, ',') as detalle
  from pg_policies
 where schemaname = 'public'
union all
select 'grant', table_name,
       grantee || ': ' || string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
 group by table_name, grantee
union all
select 'default', pg_get_userbyid(d.defaclrole) || ' · ' ||
       case d.defaclobjtype when 'r' then 'tablas' when 'S' then 'secuencias'
                            when 'f' then 'funciones' else d.defaclobjtype::text end,
       array_to_string(d.defaclacl, ' ')
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public'
 order by 1, 2, 3;
