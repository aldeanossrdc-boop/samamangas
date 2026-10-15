-- ============================================================
-- SalaMangaS · TODO lo nuevo para Supabase (pegar TODO y tocar Run, UNA vez)
-- Se puede repetir sin problema. Crea 3 tablas y al final muestra UNA celda
-- llamada pegame_esto: copiá su contenido y mandámelo.
-- ============================================================

-- ---------- pagos_procesados ----------
-- Mercado Pago / PayPal reenvían el aviso. Sin políticas: solo la service_role (el servidor) la usa.
create table if not exists public.pagos_procesados (
  clave       text primary key,
  created_at  timestamptz not null default now()
);
alter table public.pagos_procesados enable row level security;

-- ---------- ia_generaciones ----------
-- para devolverla UNA sola vez si falla. Sin políticas: solo la service_role (el servidor) puede leer/escribir.
create table if not exists public.ia_generaciones (
  id          text primary key,                       -- generationId de Leonardo
  user_id     uuid not null references auth.users(id) on delete cascade,
  devuelta    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.ia_generaciones enable row level security;

-- ---------- push_subscriptions ----------
create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_propias_insert" on public.push_subscriptions;
drop policy if exists "push_propias_update" on public.push_subscriptions;
drop policy if exists "push_propias_select" on public.push_subscriptions;
drop policy if exists "push_propias_delete" on public.push_subscriptions;
create policy "push_propias_insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push_propias_update" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_propias_select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "push_propias_delete" on public.push_subscriptions for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';

-- ---------- lectura de funciones (no cambia nada) ----------
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
