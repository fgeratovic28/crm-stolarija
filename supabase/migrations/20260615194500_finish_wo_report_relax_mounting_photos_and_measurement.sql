-- Uskladiti zaštitu sa UI (NewFieldReportModal):
-- • Ugradnja: foto obavezne samo ako je izveštaj „sve u redu“ bez otkaza na lokaciji i bez additional_needs.
-- • Merenje: mere obavezne pod istim uslovima; ako sve nije u redu ili ima otkaz lokacije → mere opcione.

CREATE OR REPLACE FUNCTION public.require_field_report_before_finishing_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.get_current_user_role();

  IF v_role IN ('montaza', 'teren', 'production')
     AND NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN

    IF NOT EXISTS (
      SELECT 1
      FROM public.field_reports fr
      WHERE fr.work_order_id = NEW.id
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.status = 'canceled'::public.work_order_status
          OR (
            (
              NEW.type <> 'installation'::public.work_order_type
              OR COALESCE(array_length(fr.images, 1), 0) > 0
              OR COALESCE(fr.site_canceled, false)
              OR fr.everything_ok IS FALSE
              OR COALESCE(array_length(fr.additional_needs, 1), 0) > 0
            )
            AND (
              NEW.type NOT IN (
                'measurement'::public.work_order_type,
                'measurement_verification'::public.work_order_type
              )
              OR COALESCE(BTRIM(fr.measurements), '') <> ''
              OR COALESCE(fr.site_canceled, false)
              OR fr.everything_ok IS FALSE
            )
          )
        )
    ) THEN
      RAISE EXCEPTION
        'Nalog ne može biti završen bez odgovarajućeg izveštaja (uvek je obavezan opšti tekst; za ugradnju su fotografije obavezne samo ako je sve u redu na lokaciji bez otkaza i dopunskih potrebi; mere su obavezne za merenje u istim uslovima).';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.require_field_report_before_finishing_work_order() IS
  'Pre završetka RN proverava postojanje field_reports opštek teksta; slike kod ugradnje i mere kod merenja samo ako je sve u redu, bez site_canceled i bez additional_needs. Za status WO canceled ili problem na izveštaju pravila za slike/mere su opuštena.';
