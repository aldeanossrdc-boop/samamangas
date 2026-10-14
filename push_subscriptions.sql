-- Ejecutar UNA vez en Supabase > SQL Editor (necesario para /api/push/suscribir)
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
