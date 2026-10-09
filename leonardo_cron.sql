-- =====================================================
-- SalaMangaS · Chequeo AUTOMÁTICO del saldo de Leonardo (cada hora)
-- PASO 2 de 2. Correr DESPUÉS de leonardo_alertas.sql y de crear
-- la variable CRON_SECRET en Cloudflare.
--
-- ANTES DE CORRER, cambiá 2 cosas de este texto:
--   a) PEGAR_AQUI_TU_CRON_SECRET  -> la misma clave que pusiste en Cloudflare
--   b) la dirección https://salamangakers.pages.dev  -> la de tu sitio, si es otra
-- =====================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- si ya existía, lo reemplaza
select cron.unschedule('leonardo-chequeo')
 where exists (select 1 from cron.job where jobname = 'leonardo-chequeo');

select cron.schedule(
  'leonardo-chequeo',
  '0 * * * *',   -- cada hora en punto
  $$
  select net.http_post(
    url     := 'https://salamangakers.pages.dev/api/leonardo-chequeo',
    headers := '{"Content-Type":"application/json","x-cron-secret":"PEGAR_AQUI_TU_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
