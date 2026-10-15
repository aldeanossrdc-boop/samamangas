-- =====================================================
-- SalaMangaS · Segunda moneda: SAKURAS IA
-- Correr UNA vez en Supabase > SQL Editor > Run
-- (se puede repetir sin problema)
-- =====================================================

-- 1) Columna nueva en profiles (empieza en 0 para todos, nunca queda vacía)
alter table public.profiles
  add column if not exists sakuras_ia integer not null default 0;

-- 2) Candado: nadie puede cambiarse las Sakuras IA desde el navegador
--    (ni desde la consola). Solo las pueden mover el servidor de pagos
--    (service_role) y las funciones de Supabase del propio sistema.
create or replace function public.proteger_sakuras_ia()
returns trigger
language plpgsql
as $$
begin
  if new.sakuras_ia is distinct from old.sakuras_ia
     and current_user in ('anon', 'authenticated') then
    raise exception 'Las Sakuras IA solo se pueden modificar desde el servidor';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_sakuras_ia on public.profiles;
create trigger trg_proteger_sakuras_ia
  before update on public.profiles
  for each row execute function public.proteger_sakuras_ia();

-- 3) Función que usa el SERVIDOR DE PAGOS (Mercado Pago / PayPal) para acreditar
--    las Sakuras IA compradas. Solo el servidor puede llamarla (no el navegador).
create or replace function public.dar_sakuras_ia(uid uuid, cant integer, origen text default 'compra')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if cant is null or cant <= 0 then raise exception 'cantidad inválida'; end if;
  update public.profiles set sakuras_ia = coalesce(sakuras_ia, 0) + cant where id = uid;
end;
$$;

revoke all on function public.dar_sakuras_ia(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.dar_sakuras_ia(uuid, integer, text) to service_role;
