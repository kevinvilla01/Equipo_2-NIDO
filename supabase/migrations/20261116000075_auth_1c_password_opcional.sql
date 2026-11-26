-- Autenticación · paso 1c: usuarios.password deja de ser obligatoria.
--
-- Correr ANTES de desplegar la Edge Function usuarios-admin.
--
-- Por qué: las contraseñas ya viven en Supabase Auth y la Edge Function crea la fila de
-- usuarios sin password. Con el NOT NULL original, el alta de un voluntario fallaba con
-- "null value in column "password" ... violates not-null constraint". La columna se borra
-- del todo en auth_2; mientras tanto solo la sigue usando el login viejo (y el script de
-- cuentas, para conservar las contraseñas actuales).
--
-- Re-ejecutable: si la columna ya no existe (auth_2 ya corrió) o ya acepta null, no hace nada.

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'usuarios'
       and column_name = 'password'
       and is_nullable = 'NO'
  ) then
    alter table public.usuarios alter column password drop not null;
  end if;
end $$;
