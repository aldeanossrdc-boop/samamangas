-- =====================================================
-- SalaMangaS · TANDA B
-- Correr UNA vez en Supabase > SQL Editor > Run
-- (se puede repetir sin problema)
-- Hace 3 cosas:
--   1) Deja que cada usuario EDITE sus propios personajes
--   2) Crea los "likes" de personajes (se ven en el perfil público)
--   3) Crea la función para que el CEO regale Sakuras IA
-- Requiere haber corrido antes personajes_publicos.sql y sakuras_ia.sql
-- =====================================================

-- 1) Editar personajes: cada usuario solo puede editar los suyos
alter table public.personajes enable row level security;
drop policy if exists "personajes_editar_propios" on public.personajes;
create policy "personajes_editar_propios" on public.personajes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) Likes de personajes (solo like, sin comentarios)
create table if not exists public.personaje_likes (
  personaje_id text not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (personaje_id, user_id)
);
alter table public.personaje_likes enable row level security;

drop policy if exists "likes_personaje_ver" on public.personaje_likes;
create policy "likes_personaje_ver" on public.personaje_likes
  for select to anon, authenticated using (true);          -- cualquiera ve los contadores

drop policy if exists "likes_personaje_dar" on public.personaje_likes;
create policy "likes_personaje_dar" on public.personaje_likes
  for insert to authenticated with check (auth.uid() = user_id);   -- solo en nombre propio

drop policy if exists "likes_personaje_quitar" on public.personaje_likes;
create policy "likes_personaje_quitar" on public.personaje_likes
  for delete to authenticated using (auth.uid() = user_id);        -- solo quita el propio

-- 3) El CEO regala Sakuras IA (la función verifica en el servidor que sea el CEO)
create or replace function public.ceo_dar_sakuras_ia(destino uuid, cant integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_conf  timestamptz;
  v_nuevo integer;
begin
  select lower(email), email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is null or v_conf is null
     or v_email not in ('aldeanossrdc@gmail.com','srdcceo1992@gmail.com','salamangas.oficial.92@gmail.com') then
    raise exception 'Solo el CEO puede regalar Sakuras IA';
  end if;
  if cant is null or cant <= 0 or cant > 100000 then
    raise exception 'Cantidad inválida';
  end if;
  update public.profiles set sakuras_ia = coalesce(sakuras_ia, 0) + cant where id = destino
    returning sakuras_ia into v_nuevo;
  if not found then raise exception 'Usuario no encontrado'; end if;
  return v_nuevo;
end;
$$;
revoke all on function public.ceo_dar_sakuras_ia(uuid, integer) from public, anon;
grant execute on function public.ceo_dar_sakuras_ia(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

-- COMPROBACIÓN: tiene que mostrar 2 filas (la tabla y la función)
select 'tabla personaje_likes' as cosa where exists (select 1 from information_schema.tables where table_schema='public' and table_name='personaje_likes')
union all
select 'función ceo_dar_sakuras_ia' where exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='ceo_dar_sakuras_ia');
