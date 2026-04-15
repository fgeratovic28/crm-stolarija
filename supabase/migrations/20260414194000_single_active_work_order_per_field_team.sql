-- Montaza/Teren tim može imati samo jedan nalog u statusu in_progress u istom trenutku.
-- Pravilo važi kada timska uloga pokreće nalog.

CREATE OR REPLACE FUNCTION public.prevent_multiple_active_field_work_orders()
RETURNS trigger AS $$
DECLARE
  current_role public.user_role;
BEGIN
  current_role := get_current_user_role();

  IF current_role IN ('montaza', 'teren')
     AND NEW.status = 'in_progress'
     AND NEW.team_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.team_id = NEW.team_id
        AND wo.status = 'in_progress'
        AND wo.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'Postoji aktivan radni nalog za vaš tim. Završite postojeći nalog pre pokretanja novog.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_single_active_field_work_order_per_team ON public.work_orders;
CREATE TRIGGER trg_single_active_field_work_order_per_team
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_multiple_active_field_work_orders();
