-- Align DB guard with UI report rules:
-- - always require general_report
-- - require images only for installation work orders
-- - require measurements only for measurement work orders
-- - complaint/service/site_visit/control_visit/production do not require measurements

CREATE OR REPLACE FUNCTION public.require_field_report_before_finishing_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
  v_requires_images boolean;
  v_requires_measurements boolean;
  has_valid_report boolean;
BEGIN
  v_role := public.get_current_user_role();

  IF v_role IN ('montaza', 'teren', 'production')
     AND NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_requires_images := NEW.type = 'installation'::public.work_order_type;
    v_requires_measurements := NEW.type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type
    );

    has_valid_report := EXISTS (
      SELECT 1
      FROM public.field_reports fr
      WHERE fr.work_order_id = NEW.id
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.status = 'canceled'::public.work_order_status
          OR (
            (NOT v_requires_images OR COALESCE(array_length(fr.images, 1), 0) > 0)
            AND
            (NOT v_requires_measurements OR COALESCE(BTRIM(fr.measurements), '') <> '')
          )
        )
    );

    IF NOT has_valid_report THEN
      RAISE EXCEPTION
        'Nalog ne može biti završen bez popunjenog izveštaja (uvek je obavezan opšti tekst; fotografije su obavezne za ugradnju, mere samo za merenje).';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;
