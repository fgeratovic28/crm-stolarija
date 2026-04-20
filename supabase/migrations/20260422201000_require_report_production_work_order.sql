-- RN proizvodnje: izveštaj u fabrici — obavezan opšti tekst (general_report), bez obaveznih fotografija i bez merenja.
-- Ranije je uslov „instalacija ili mere“ tretirao proizvodnju kao teren i blokirao čuvanje.

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
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.type = 'production'::public.work_order_type
          OR COALESCE(array_length(fr.images, 1), 0) > 0
        )
        AND (
          NEW.status = 'canceled'::public.work_order_status
          OR NEW.type = 'installation'::public.work_order_type
          OR NEW.type = 'production'::public.work_order_type
          OR COALESCE(BTRIM(fr.measurements), '') <> ''
        )
    );

    IF NOT has_valid_report THEN
      RAISE EXCEPTION
        'Nalog ne može biti završen bez popunjenog izveštaja (uvek je obavezan opšti tekst; fotografije i mere zavise od tipa naloga — proizvodnja: samo tekst).';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;
