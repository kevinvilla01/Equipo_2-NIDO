-- Autenticación · paso 1 de 2: preparar el cambio a Supabase Auth SIN romper el login actual.
--
-- Orden del despliegue (detalle en el README, "Iniciar sesión"):
--   1. Esta migración y 20261116000050_auth_1b_directorio_activo.sql
--                                           ← el login viejo sigue funcionando
--   2. scripts/migrar-cuentas-auth.mjs      ← crea las cuentas de Auth y llena auth_id
--   3. Desplegar la Edge Function usuarios-admin y el frontend nuevo (signInWithPassword).
--   4. 20261116000100_auth_2_cerrar_usuarios.sql ← RLS estricta y borra usuarios.password
--   5. 20261116000200_auth_3_politicas_tablas.sql ← RLS y GRANTs del resto de tablas
--
-- Qué agrega:
--   1. usuarios.auth_id → auth.users(id).
--   2. Funciones usuario_actual_id() y es_coordinador(), que leen el rol del usuario
--      autenticado (auth.uid()). Las usan las políticas y las RPC (HU-12).
--   3. Vista directorio_usuarios (id, nombre) para mostrar compañeros de patrulla
--      sin dar acceso a la fila completa de otros usuarios.
--   4. Las políticas que hoy solo aplican a `anon` pasan a aplicar también a
--      `authenticated`. Sin esto, al iniciar sesión la app perdería acceso a tablas
--      que hoy lee como anon. No amplía nada: authenticated recibe lo mismo que anon.
--      (usuarios queda fuera; se rehace completa en el paso 2.)
--
-- Re-ejecutable. Correr completo en Supabase → SQL Editor.

begin;

-- 1. Liga con la cuenta de Auth. on delete set null: borrar la cuenta en Auth no borra
--    el historial (patrullajes, liberaciones) que apunta a usuarios.id.
alter table public.usuarios
  add column if not exists auth_id uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.usuarios'::regclass and conname = 'usuarios_auth_id_unico') then
    alter table public.usuarios add constraint usuarios_auth_id_unico unique (auth_id);
  end if;
end $$;

-- 2. Identidad de quien llama. SECURITY DEFINER para leer usuarios sin pasar por su RLS
--    (si no, la política de usuarios que usa es_coordinador() se llamaría a sí misma).
--    Solo devuelven datos del propio usuario autenticado; con anon devuelven null/false.
create or replace function public.usuario_actual_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.id::bigint
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.activo
$$;

create or replace function public.es_coordinador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.rol = 'coordinador'
      from public.usuarios u
     where u.auth_id = auth.uid()
       and u.activo
  ), false)
$$;

revoke all on function public.usuario_actual_id() from public, anon;
revoke all on function public.es_coordinador() from public, anon;
grant execute on function public.usuario_actual_id() to authenticated;
grant execute on function public.es_coordinador() to authenticated;

-- 3. Directorio mínimo: solo id y nombre. La vista corre con los permisos de su dueño
--    (security_invoker = false), así que no depende de la RLS de usuarios; por eso
--    se le quita todo a anon y solo la lee authenticated.
create or replace view public.directorio_usuarios
with (security_invoker = false) as
  select id, nombre
    from public.usuarios
   where activo;

revoke all on public.directorio_usuarios from public, anon, authenticated;
grant select on public.directorio_usuarios to authenticated;

-- 4. Políticas solo-anon → anon + authenticated (excepto usuarios).
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename <> 'usuarios'
       and 'anon' = any (roles)
       and not 'authenticated' = any (roles)
  loop
    execute format('alter policy %I on %I.%I to anon, authenticated',
                   p.policyname, p.schemaname, p.tablename);
    raise notice 'Política % en % ahora aplica a anon y authenticated', p.policyname, p.tablename;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';

-- Resultado para revisar: políticas de public y a quién aplican.
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
