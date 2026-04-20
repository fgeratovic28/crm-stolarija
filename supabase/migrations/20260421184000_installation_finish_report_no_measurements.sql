-- Završetak RN tipa „ugradnja“: dovoljne su fotografija + opšti izveštaj (mere nisu obavezne).
-- Terenski RN i dalje zahtevaju mere pri completed (osim otkazivanja).

CREATE OR REPLACE FUNCTION public.require_field_report_before_finishing_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
  has_valid_report boolean;
BEGIN
  v_role := public.get_current_user_role();

  IF v_role IN ('montaza', 'teren')
     AND NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    has_valid_report := EXISTS (
      SELECT 1
      FROM public.field_reports fr
      WHERE fr.work_order_id = NEW.id
        AND COALESCE(array_length(fr.images, 1), 0) > 0
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.status = 'canceled'
          OR NEW.type = 'installation'
          OR COALESCE(BTRIM(fr.measurements), '') <> ''
        )
    );

    IF NOT has_valid_report THEN
      RAISE EXCEPTION
        'Nalog ne može biti završen bez popunjenog izveštaja (fotografija i opšti tekst obavezni; mere su obavezne samo za terenske naloge koji nisu ugradnja).';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;
