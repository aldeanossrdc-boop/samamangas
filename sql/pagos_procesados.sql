-- Ejecutar UNA vez en Supabase > SQL Editor. Evita que un pago se acredite dos veces cuando
-- Mercado Pago / PayPal reenvían el aviso. Sin políticas: solo la service_role (el servidor) la usa.
create table if not exists public.pagos_procesados (
  clave       text primary key,
  created_at  timestamptz not null default now()
);
alter table public.pagos_procesados enable row level security;
