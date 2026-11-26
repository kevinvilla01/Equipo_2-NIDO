-- Verificación de permisos del esquema public (solo lectura; no es una migración).
--
-- Correr en el SQL Editor después de crear o cambiar tablas, vistas o funciones,
-- sobre todo si se crearon desde el Dashboard (Table Editor). Devuelve SOLO problemas:
-- sin filas = todo en orden.
--
-- Por qué hace falta: auth_3 ajustó los default privileges de `postgres`, pero los de
-- `supabase_admin` no se pueden cambiar desde el SQL Editor (el rol postgres no es
-- miembro de supabase_admin). Lo que cree supabase_admin en public nace con TODO para
-- anon y authenticated. Esta consulta revisa el resultado, sin importar quién creó el objeto.

with tablas as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity,
         pg_get_userbyid(c.relowner) as dueno
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
),
problemas as (
  -- 1. Tablas sin RLS: los GRANTs bastan para leer y escribir todo.
  select relname as objeto, dueno, 'RLS desactivada' as problema
    from tablas where relkind in ('r', 'p') and not relrowsecurity

  -- 2. Tablas con RLS pero sin políticas (nadie lee: suele ser un olvido).
  union all
  select t.relname, t.dueno, 'RLS activa sin ninguna política'
    from tablas t
   where t.relkind in ('r', 'p') and t.relrowsecurity
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname)

  -- 3. anon con algo más que SELECT en keepalive.
  union all
  select t.relname, t.dueno, 'anon tiene ' || priv
    from tablas t
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as priv
   where has_table_privilege('anon', t.oid, priv)
     and not (t.relname = 'keepalive' and priv = 'SELECT')

  -- 4. authenticated con privilegios que RLS no controla.
  union all
  select t.relname, t.dueno, 'authenticated tiene ' || priv
    from tablas t
   cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER']) as priv
   where has_table_privilege('authenticated', t.oid, priv)

  -- 5. Funciones de public que anon puede ejecutar (directo o vía PUBLIC).
  union all
  select p.oid::regprocedure::text, pg_get_userbyid(p.proowner), 'anon puede ejecutarla'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')

  -- 6. SECURITY DEFINER sin search_path fijo (riesgo de secuestro de nombres).
  union all
  select p.oid::regprocedure::text, pg_get_userbyid(p.proowner), 'SECURITY DEFINER sin search_path'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
)
select * from problemas order by objeto, problema;
