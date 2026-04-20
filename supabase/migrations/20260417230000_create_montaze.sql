-- Fotografije montaže po radnom nalogu (ugradnja); javni R2 URL + ključ za brisanje
CREATE TABLE public.montaze (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_key TEXT,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_montaze_work_order_id ON public.montaze(work_order_id);

ALTER TABLE public.montaze ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_montaze ON public.montaze
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'admin')
  WITH CHECK (get_current_user_role() = 'admin');

CREATE POLICY montaza_montaze_all ON public.montaze
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND work_order_id IN (
      SELECT id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND work_order_id IN (
      SELECT id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

COMMENT ON TABLE public.montaze IS 'Slike radnog naloga (montaža); R2 javni URL u image_url';
