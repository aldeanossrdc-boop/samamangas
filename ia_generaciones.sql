-- Ejecutar UNA vez en Supabase > SQL Editor. Registra quién pagó cada generación de Leonardo
-- para devolverla UNA sola vez si falla. Sin políticas: solo la service_role (el servidor) puede leer/escribir.
create table if not exists public.ia_generaciones (
  id          text primary key,                       -- generationId de Leonardo
  user_id     uuid not null references auth.users(id) on delete cascade,
  devuelta    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.ia_generaciones enable row level security;
