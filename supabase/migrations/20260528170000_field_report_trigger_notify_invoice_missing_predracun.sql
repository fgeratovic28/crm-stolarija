-- Hitno obaveštenje (user_notifications + meta.position) mora da postoji za tok sa kontrolne table.
-- Ako se oslanja samo na klijentski RPC posle mutacije, obaveštenje može da izostane (ref / redosled).
-- Trigger posle INSERT-a na field_reports šalje notify kada je u details označen odloženi auto-RN ugradnje.

CREATE OR REPLACE FUNCTION public.trg_field_reports_notify_invoice_missing_predracun()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_job uuid;
  v_line text;
  v_pos text;
  v_m text[];
BEGIN
  IF NOT COALESCE((NEW.details->>'invoiceMissingDeferAutoInstallationWo')::boolean, false) THEN
    RETURN NEW;
  END IF;

  v_job := COALESCE(
    NEW.job_id,
    (SELECT w.job_id FROM public.work_orders w WHERE w.id = NEW.work_order_id LIMIT 1)
  );
  IF v_job IS NULL THEN
    RETURN NEW;
  END IF;

  v_pos := NULL;
  FOREACH v_line IN ARRAY COALESCE(NEW.missing_items, ARRAY[]::text[])
  LOOP
    IF v_line ~* 'predračun|predracun' THEN
      v_m := regexp_match(v_line, 'Pozicija\s+(\S+)', 'i');
      IF v_m IS NOT NULL AND v_m[1] IS NOT NULL THEN
        v_pos := NULLIF(trim(both ' ' FROM v_m[1]), '');
        EXIT WHEN v_pos IS NOT NULL;
      END IF;
    END IF;
  END LOOP;

  IF v_pos IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.notify_procurement_production_urgent_site_missing(v_job, v_pos);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_field_reports_notify_invoice_missing_predracun (report %): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.trg_field_reports_notify_invoice_missing_predracun() SET search_path TO public;

DROP TRIGGER IF EXISTS field_reports_notify_invoice_missing_predracun ON public.field_reports;
CREATE TRIGGER field_reports_notify_invoice_missing_predracun
  AFTER INSERT ON public.field_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_field_reports_notify_invoice_missing_predracun();

REVOKE ALL ON FUNCTION public.trg_field_reports_notify_invoice_missing_predracun() FROM PUBLIC;

COMMENT ON FUNCTION public.trg_field_reports_notify_invoice_missing_predracun() IS
  'Posle INSERT terenskog izveštaja sa invoiceMissingDeferAutoInstallationWo: hitno Nabavka/Proizvodnja (meta.position).';
