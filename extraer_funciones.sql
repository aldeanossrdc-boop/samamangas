-- =====================================================================
-- Correr en Supabase > SQL Editor > Run. Es SOLO LECTURA (no cambia nada).
-- Devuelve UNA celda con el texto de las funciones, permisos, políticas y triggers.
-- Copiá el contenido de esa celda y pegámelo en el chat.
-- =====================================================================
select string_agg(x, E'\n\n') as pegame_esto from (
  select pg_get_functiondef(p.oid) as x
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('usar_generacion_ia','devolver_generacion_ia','asistente_acceso','puede_generar_personaje',
                       'consumir_personaje_ia','devolver_personaje_ia','estado_personajes_ia',
                       'dar_sakuras','acreditar_manga_extra','cobrar_lectura','cobrar_lectura_pagina',
                       'gastar_sakuras_propio','otorgar_bono_propio','comprar_tema','apoyar_creador')
  union all
  select '-- PERMISOS ' || p.proname || ': ' || coalesce(p.proacl::text, '(por defecto: cualquiera puede ejecutarla)')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('usar_generacion_ia','devolver_generacion_ia','asistente_acceso','puede_generar_personaje',
                       'consumir_personaje_ia','devolver_personaje_ia','estado_personajes_ia',
                       'dar_sakuras','acreditar_manga_extra')
  union all
  select '-- POLITICA ' || tablename || ' / ' || policyname || ' / ' || cmd || ' / using=' || coalesce(qual, '') || ' / check=' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename in ('profiles', 'config')
  union all
  select '-- TRIGGER ' || pg_get_triggerdef(t.oid)
    from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
  union all
  select '-- COLUMNA profiles.' || column_name || ' ' || data_type
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
) s;
