-- =====================================================
-- SalaMangaS · Avisos por mail del saldo de Leonardo
-- PASO 1 de 2. Correr en Supabase > SQL Editor > Run
-- (se puede repetir sin problema)
-- Guarda cuándo se mandó el último aviso, para no
-- mandarte el mismo mail cada hora (máximo 1 cada 24 h).
-- =====================================================
create table if not exists public.avisos_leonardo (
  id          bigint generated always as identity primary key,
  enviado_en  timestamptz not null default now(),
  saldo       numeric,
  umbral      numeric
);
-- Privada: con la seguridad (RLS) activada y SIN políticas, nadie la ve desde
-- el navegador. Solo la usa el servidor.
alter table public.avisos_leonardo enable row level security;
