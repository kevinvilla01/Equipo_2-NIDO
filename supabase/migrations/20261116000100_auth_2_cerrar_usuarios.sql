-- Autenticación · paso 2 de 2: cerrar la tabla usuarios y borrar las contraseñas en texto plano.
--
-- Correr SOLO después de:
--   - scripts/migrar-cuentas-auth.mjs (todas las cuentas activas tienen auth_id), y
--   - desplegar el frontend que inicia sesión con Supabase Auth.
-- Si falta algún usuario activo por ligar, la migración se aborta y los lista.
--
-- Después de esto:
--   - anon no tiene ningún acceso a usuarios.
--   - Cada usuario autenticado lee solo su fila; el coordinador lee todas.
--   - Nadie escribe usuarios desde el cliente: altas y cambios van por la
--     Edge Function `usuarios-admin` (service_role, verifica que llama un coordinador).
--   - usuarios.password deja de existir; las contraseñas viven en Supabase Auth.

begin;

do $$
declare
  v_sin_ligar text;
begin
  select string_agg(format('%s (id %s)', correo, id), ', ')
    into v_sin_ligar
    from public.usuarios
   where activo and auth_id is null;

  if v_sin_ligar is not null then
    raise exception 'Usuarios activos sin cuenta de Auth: %. Corre scripts/migrar-cuentas-auth.mjs antes.', v_sin_ligar;
  end if;
end $$;

alter table public.usuarios enable row level security;

-- Se quitan todas las políticas anteriores de usuarios (incluida la que dejaba a anon
-- leer y filtrar por password) y se dejan solo las de lectura.
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'usuarios' loop
    execute format('drop policy %I on public.usuarios', p.policyname);
  end loop;
end $$;

create policy usuarios_leer_propia on public.usuarios
  for select to authenticated
  using (auth_id = auth.uid());

create policy usuarios_coordinador_lee_todas on public.usuarios
  for select to authenticated
  using (public.es_coordinador());

revoke all on public.usuarios from anon;
revoke insert, update, delete, truncate on public.usuarios from authenticated;
grant select on public.usuarios to authenticated;

-- Un REVOKE a nivel de tabla no quita los grants por columna (p. ej. GRANT UPDATE (rol)).
do $$
declare
  c record;
begin
  for c in
    select distinct grantee, privilege_type, column_name
      from information_schema.column_privileges
     where table_schema = 'public'
       and table_name = 'usuarios'
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
  loop
    execute format('revoke %s (%I) on public.usuarios from %I',
                   c.privilege_type, c.column_name, c.grantee);
  end loop;
end $$;

-- Tercera barrera, por si un día alguien vuelve a abrir una política o un grant:
--   - anon y authenticated nunca escriben usuarios (solo service_role / postgres).
--   - Nadie cambia su propio rol ni se desactiva a sí mismo, ni siquiera vía service_role
--     con el JWT de un usuario (auth.uid() es el dueño de la fila).
create or replace function public.usuarios_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'Los usuarios solo se modifican con la función usuarios-admin.';
  end if;

  if tg_op = 'UPDATE'
     and old.auth_id is not null
     and old.auth_id = auth.uid()
     and (new.rol is distinct from old.rol or new.activo is distinct from old.activo) then
    raise exception using
      errcode = '42501',
      message = 'Nadie puede cambiar su propio rol ni desactivarse a sí mismo.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists usuarios_proteger on public.usuarios;
create trigger usuarios_proteger
  before insert or update or delete on public.usuarios
  for each row execute function public.usuarios_proteger();

alter table public.usuarios drop column if exists password;

commit;

notify pgrst, 'reload schema';
