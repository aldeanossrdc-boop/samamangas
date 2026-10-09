-- =====================================================
-- SalaMangaS · Tienda de temas del chat
-- Correr UNA sola vez en Supabase > SQL Editor > Run
-- Se puede correr de nuevo sin problema (no duplica nada)
-- =====================================================

-- 1) Tabla de temas comprados (queda para siempre, ligada al usuario)
create table if not exists public.temas_comprados (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  tema          text not null,
  fecha_compra  timestamptz not null default now(),
  unique (user_id, tema)
);

-- 2) Seguridad (RLS): cada usuario SOLO LEE lo suyo.
--    Insertar NO se permite desde el navegador: solo lo hace la función
--    comprar_tema (así nadie puede regalarse temas desde la consola).
alter table public.temas_comprados enable row level security;
drop policy if exists "leer mis temas" on public.temas_comprados;
create policy "leer mis temas" on public.temas_comprados
  for select to authenticated using (auth.uid() = user_id);

-- 3) Función del servidor: descuenta Sakuras + guarda el tema, todo junto
create or replace function public.comprar_tema(tema_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  precio int;
  saldo  numeric;
begin
  if uid is null then return 'no_login'; end if;

  precio := case tema_id
              when 'bnsimple' then 150
              when 'bntone'   then 300
              when 'noir'     then 500
              when 'dorado'   then 800
              else null end;
  if precio is null then return 'tema_invalido'; end if;

  -- bloquea la fila del usuario (evita doble compra por doble toque)
  select sakuras into saldo from public.profiles where id = uid for update;
  if not found then return 'no_login'; end if;

  if exists (select 1 from public.temas_comprados where user_id = uid and tema = tema_id) then
    return 'ya_comprado';
  end if;

  if coalesce(saldo, 0) < precio then return 'sin_sakuras'; end if;

  update public.profiles set sakuras = coalesce(sakuras, 0) - precio where id = uid;
  insert into public.temas_comprados (user_id, tema) values (uid, tema_id);
  return 'ok';
end;
$$;

revoke all on function public.comprar_tema(text) from public, anon;
grant execute on function public.comprar_tema(text) to authenticated;
