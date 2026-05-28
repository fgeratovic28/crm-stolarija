-- Stavke liste zadataka vezane za radni nalog (merenje / ugradnja / terenski RN).

CREATE TABLE IF NOT EXISTS public.work_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  is_completed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_work_order_items_work_order_id ON public.work_order_items(work_order_id);

ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_team_work_order_item_row_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.get_current_user_role() IN ('teren', 'montaza', 'production') THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Nije dozvoljeno menjati pk stavke naloga.';
    END IF;
    IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
      RAISE EXCEPTION 'Nije dozvoljeno menjati vezu stavke naloga.';
    END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN
      RAISE EXCEPTION 'Nije dozvoljeno menjati opis stavke naloga.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_team_work_order_item_row_update ON public.work_order_items;
CREATE TRIGGER trg_prevent_team_work_order_item_row_update
  BEFORE UPDATE ON public.work_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_team_work_order_item_row_update();

DROP POLICY IF EXISTS admin_all_work_order_items ON public.work_order_items;
CREATE POLICY admin_all_work_order_items ON public.work_order_items
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

DROP POLICY IF EXISTS office_all_work_order_items ON public.work_order_items;
CREATE POLICY office_all_work_order_items ON public.work_order_items
  FOR ALL TO authenticated
  USING (
    public.get_current_user_role() = 'office'
    AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = work_order_items.work_order_id)
  )
  WITH CHECK (
    public.get_current_user_role() = 'office'
    AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = work_order_items.work_order_id)
  );

DROP POLICY IF EXISTS teren_sel_work_order_items ON public.work_order_items;
CREATE POLICY teren_sel_work_order_items ON public.work_order_items
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS teren_upd_work_order_items_completion ON public.work_order_items;
CREATE POLICY teren_upd_work_order_items_completion ON public.work_order_items
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS montaza_sel_work_order_items ON public.work_order_items;
CREATE POLICY montaza_sel_work_order_items ON public.work_order_items
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS montaza_upd_work_order_items_completion ON public.work_order_items;
CREATE POLICY montaza_upd_work_order_items_completion ON public.work_order_items
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS production_sel_work_order_items ON public.work_order_items;
CREATE POLICY production_sel_work_order_items ON public.work_order_items
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS production_upd_work_order_items_completion ON public.work_order_items;
CREATE POLICY production_upd_work_order_items_completion ON public.work_order_items
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = work_order_items.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );
