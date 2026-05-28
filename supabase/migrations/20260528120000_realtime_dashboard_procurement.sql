-- Realtime: dashboard + hitni triage osvežavaju se preko postgres_changes u klijentu.
-- Ako tabela nije u `supabase_realtime` publikaciji, pretplate neće primati događaje.

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'procurement_ad_hoc_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.procurement_ad_hoc_items;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'invoice_missing_site_procurement'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_missing_site_procurement;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'procurement_complaints'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.procurement_complaints;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
    END IF;
  END IF;
END;
$migration$;
