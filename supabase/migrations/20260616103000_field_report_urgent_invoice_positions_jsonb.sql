-- Jedan izvor istine za hitna obaveštenja (bez duplog slanja klijent + trigger).
-- details.invoiceMissingSitePositions: niz stringova; trigger šalje notify po poziciji.
-- Legacy: parsiranje "Pozicije a, b —" ili jedne "Pozicija x" bez hvatanja "1," posle zareza.

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
  v_blob text;
  v_each text;
  v_arr jsonb;
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

  v_arr := NEW.details->'invoiceMissingSitePositions';
  IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) = 'array' AND jsonb_array_length(v_arr) > 0 THEN
    FOR v_each IN
      SELECT nullif(trim(both ' ' FROM u.pos), '')
      FROM unnest(
        ARRAY(
          SELECT jsonb_array_elements_text(v_arr)
        )
      ) AS u(pos)
    LOOP
      IF v_each IS NOT NULL AND length(v_each) > 0 THEN
        BEGIN
          PERFORM public.notify_procurement_production_urgent_site_missing(v_job, v_each);
        EXCEPTION
          WHEN OTHERS THEN
            RAISE WARNING 'trg_field_reports_notify_invoice_missing_predracun json (report %): %', NEW.id, SQLERRM;
        END;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  FOREACH v_line IN ARRAY COALESCE(NEW.missing_items, ARRAY[]::text[])
  LOOP
    IF v_line !~* 'predračun|predracun' THEN
      CONTINUE;
    END IF;

    v_m := regexp_match(v_line, '(?i)Pozicije\s+(.+?)\s*[—-]');
    IF v_m IS NOT NULL AND v_m[1] IS NOT NULL THEN
      v_blob := trim(both ' ' FROM v_m[1]);
      IF length(v_blob) > 0 THEN
        FOR v_each IN
          SELECT nullif(trim(both ' ' FROM u), '')
          FROM unnest(string_to_array(v_blob, ',')) AS u
        LOOP
          IF v_each IS NOT NULL AND length(v_each) > 0 THEN
            BEGIN
              PERFORM public.notify_procurement_production_urgent_site_missing(v_job, v_each);
            EXCEPTION
              WHEN OTHERS THEN
                RAISE WARNING 'trg_field_reports_notify_invoice_missing_predracun plural (report %): %', NEW.id, SQLERRM;
            END;
          END IF;
        END LOOP;
      END IF;
      RETURN NEW;
    END IF;

    v_m := regexp_match(v_line, '(?i)Pozicija\s+([^\s,—-]+)');
    IF v_m IS NOT NULL AND v_m[1] IS NOT NULL THEN
      v_pos := nullif(trim(both ' ' FROM v_m[1]), '');
      IF v_pos IS NOT NULL THEN
        BEGIN
          PERFORM public.notify_procurement_production_urgent_site_missing(v_job, v_pos);
        EXCEPTION
          WHEN OTHERS THEN
            RAISE WARNING 'trg_field_reports_notify_invoice_missing_predracun singular (report %): %', NEW.id, SQLERRM;
        END;
      END IF;
      RETURN NEW;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.trg_field_reports_notify_invoice_missing_predracun() SET search_path TO public;

COMMENT ON FUNCTION public.trg_field_reports_notify_invoice_missing_predracun() IS
  'Posle INSERT terenskog izveštaja sa invoiceMissingDeferAutoInstallationWo: notify po poziciji iz details.invoiceMissingSitePositions ili legacy parsiranje missing_items (bez duplog klijentskog RPC).';
