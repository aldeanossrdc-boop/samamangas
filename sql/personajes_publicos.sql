-- =====================================================
-- SalaMangaS · Personajes visibles en el perfil público
-- Correr UNA vez en Supabase > SQL Editor > Run
-- (se puede repetir sin problema)
-- Solo agrega permiso de LECTURA pública. Crear/borrar sigue siendo
-- solo del dueño: no toca las reglas que ya existen.
-- =====================================================
alter table public.personajes enable row level security;
drop policy if exists "personajes_lectura_publica" on public.personajes;
create policy "personajes_lectura_publica" on public.personajes
  for select to anon, authenticated using (true);
