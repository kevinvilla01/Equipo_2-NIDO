-- Autenticación · paso 1b: directorio_usuarios incluye a los inactivos y la columna activo.
--
-- Correr ANTES de desplegar el frontend nuevo (registrar-patrulla.js filtra por activo).
--
-- Por qué: en auth_1 la vista solo tenía usuarios activos, así que el nombre de un
-- voluntario dado de baja desaparecía de los patrullajes viejos. Ahora la vista lista a
-- todos (id, nombre, activo) y el formulario de patrullaje filtra activo = true.
-- activo no es dato sensible; correo, teléfono y rol siguen fuera de la vista.

begin;

create or replace view public.directorio_usuarios
with (security_invoker = false) as
  select id, nombre, activo
    from public.usuarios;

revoke all on public.directorio_usuarios from public, anon, authenticated;
grant select on public.directorio_usuarios to authenticated;

commit;

notify pgrst, 'reload schema';
