-- Timske uloge ne smeju da zatvore nalog bez popunjenog izveštaja.
-- Važi za prelaz statusa na completed/canceled.

CREATE OR REPLACE FUNCTION public.require_field_report_before_finishing_work_order()
RETURNS trigger AS $$
DECLARE
  v_role public.user_role;
  has_valid_report boolean;
BEGIN
  v_role := get_current_user_role();

  IF v_role IN ('montaza', 'teren')
     AND NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.field_reports fr
      WHERE fr.work_order_id = NEW.id
        AND COALESCE(array_length(fr.images, 1), 0) > 0
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.status = 'canceled'
          OR COALESCE(BTRIM(fr.measurements), '') <> ''
        )
    ) INTO has_valid_report;

    IF NOT has_valid_report THEN
      RAISE EXCEPTION 'Nalog ne može biti završen bez popunjenog izveštaja (slika + izveštaj + mere).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_require_report_before_finishing_work_order ON public.work_orders;
CREATE TRIGGER trg_require_report_before_finishing_work_order
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.require_field_report_before_finishing_work_order();
