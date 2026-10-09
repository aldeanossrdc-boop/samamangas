-- =====================================================
-- SalaMangaS · Generaciones IA (reconstruido desde cero)
-- Correr en Supabase > SQL Editor > Run, DESPUÉS de sakuras_ia.sql
-- (se puede repetir sin problema)
--
-- REGLAS:
--  • Gratis 0 · Pro 20 · Súper Pro 50 · Semi Dios 150 · Dios 300 gen/mes
--  • Las del plan se renuevan el 1° de cada mes (hora UTC) y NO se acumulan
--  • Orden de gasto: 1° las del plan, 2° las Sakuras IA compradas
--  • Gratis (o plan vencido) no puede generar, ni siquiera con Sakuras IA
-- =====================================================

-- 1) Columnas necesarias (si ya existen, no pasa nada)
alter table public.profiles add column if not exists generaciones_ia   integer not null default 0;
alter table public.profiles add column if not exists ultima_recarga_ia timestamptz;
alter table public.profiles add column if not exists generaciones_extra integer not null default 0;
alter table public.profiles add column if not exists sakuras_ia        integer not null default 0;
alter table public.profiles add column if not exists ia_ultimo_uso     text;
alter table public.profiles add column if not exists ia_ultimo_uso_en  timestamptz;

-- 2) Pasar las generaciones compradas con el sistema viejo a Sakuras IA (una sola vez)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='profiles' and column_name='generaciones_extra') then
    update public.profiles
       set sakuras_ia = coalesce(sakuras_ia,0) + generaciones_extra,
           generaciones_extra = 0
     where coalesce(generaciones_extra,0) > 0;
  end if;
end $$;

-- 3) Borrar las versiones anteriores de las 2 funciones (sin importar cómo estaban definidas)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('usar_generacion_ia','devolver_generacion_ia')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- 4) usar_generacion_ia: gasta UNA generación. Devuelve cuántas le quedan (plan + Sakuras IA),
--    o -1 si no puede generar (sin plan, o sin generaciones).
create function public.usar_generacion_ia(modo text default 'ia')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  p         public.profiles%rowtype;
  vigente   boolean;
  cupo      integer;
  mes_ok    boolean;
  plan_rest integer;
  extra     integer;
begin
  if uid is null then raise exception 'Iniciá sesión para usar la IA'; end if;

  -- bloquea la fila del usuario: evita gastar 2 veces con doble toque
  select * into p from public.profiles where id = uid for update;
  if not found then raise exception 'Perfil no encontrado'; end if;

  -- ¿plan vigente? (misma regla que la app)
  vigente := p.tier is not null and p.tier <> 'gratis'
             and not (p.tier_hasta is not null and p.tier_hasta < now())
             and not (coalesce(p.creador_gratis,false) and p.vence_gratis is not null and p.vence_gratis < now());

  cupo := case when not vigente then 0
               else case p.tier
                      when 'pro'       then 20
                      when 'superpro'  then 50
                      when 'semidios'  then 150
                      when 'semi_dios' then 150
                      when 'dios'      then 300
                      else 0 end
          end;

  if cupo = 0 then return -1; end if;   -- Gratis / plan vencido: sin IA

  -- ¿ya se renovó este mes? (si no, arranca el mes con el cupo completo)
  mes_ok := p.ultima_recarga_ia is not null
            and to_char(p.ultima_recarga_ia::timestamptz at time zone 'UTC', 'YYYY-MM')
              = to_char(now() at time zone 'UTC', 'YYYY-MM');
  plan_rest := case when mes_ok then greatest(coalesce(p.generaciones_ia,0), 0) else cupo end;
  extra     := greatest(coalesce(p.sakuras_ia,0), 0);

  if plan_rest > 0 then
    -- 1° se gasta una del plan
    update public.profiles
       set generaciones_ia   = plan_rest - 1,
           ultima_recarga_ia = case when mes_ok then ultima_recarga_ia else now() end,
           ia_ultimo_uso     = 'plan',
           ia_ultimo_uso_en  = now()
     where id = uid;
    return (plan_rest - 1) + extra;
  elsif extra > 0 then
    -- 2° se acabaron las del plan: se gasta una Sakura IA
    update public.profiles
       set sakuras_ia       = extra - 1,
           ia_ultimo_uso    = 'sakuras',
           ia_ultimo_uso_en = now()
     where id = uid;
    return extra - 1;
  end if;

  return -1;   -- sin generaciones
end;
$$;

-- 5) devolver_generacion_ia: si la generación falló, devuelve la que se gastó.
--    Solo devuelve UNA, solo la última, y solo si pasaron menos de 15 minutos.
create function public.devolver_generacion_ia()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  p      public.profiles%rowtype;
  mes_ok boolean;
begin
  if uid is null then return 0; end if;

  select * into p from public.profiles where id = uid for update;
  if not found or p.ia_ultimo_uso is null or p.ia_ultimo_uso_en is null
     or p.ia_ultimo_uso_en < now() - interval '15 minutes' then
    return 0;
  end if;

  if p.ia_ultimo_uso = 'plan' then
    mes_ok := p.ultima_recarga_ia is not null
              and to_char(p.ultima_recarga_ia::timestamptz at time zone 'UTC', 'YYYY-MM')
                = to_char(now() at time zone 'UTC', 'YYYY-MM');
    if mes_ok then
      update public.profiles
         set generaciones_ia = coalesce(generaciones_ia,0) + 1, ia_ultimo_uso = null
       where id = uid;
    else
      update public.profiles set ia_ultimo_uso = null where id = uid;  -- cambió el mes: no hay qué devolver
      return 0;
    end if;
  else
    update public.profiles
       set sakuras_ia = coalesce(sakuras_ia,0) + 1, ia_ultimo_uso = null
     where id = uid;
  end if;
  return 1;
end;
$$;

-- 6) Permisos: solo usuarios con sesión iniciada
revoke all on function public.usar_generacion_ia(text)  from public, anon;
revoke all on function public.devolver_generacion_ia()  from public, anon;
grant execute on function public.usar_generacion_ia(text)  to authenticated;
grant execute on function public.devolver_generacion_ia()  to authenticated;

-- 7) Candado: nadie puede tocar estos contadores desde el navegador/consola
create or replace function public.proteger_columnas_ia()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon','authenticated') and (
       new.generaciones_ia    is distinct from old.generaciones_ia
    or new.ultima_recarga_ia  is distinct from old.ultima_recarga_ia
    or new.generaciones_extra is distinct from old.generaciones_extra
    or new.ia_ultimo_uso      is distinct from old.ia_ultimo_uso
    or new.ia_ultimo_uso_en   is distinct from old.ia_ultimo_uso_en
  ) then
    raise exception 'Las generaciones IA solo se pueden modificar desde el servidor';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_columnas_ia on public.profiles;
create trigger trg_proteger_columnas_ia
  before update on public.profiles
  for each row execute function public.proteger_columnas_ia();

-- 8) Avisar a la API que hay funciones nuevas
notify pgrst, 'reload schema';

-- 9) COMPROBACIÓN: al terminar tiene que mostrar 4 filas (si falta alguna, avisame)
select proname as funcion
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('usar_generacion_ia','devolver_generacion_ia','dar_sakuras_ia','comprar_tema')
 order by 1;
