CREATE TABLE IF NOT EXISTS public.material_item_code_memory (
  normalized_article text PRIMARY KEY,
  article_name text NOT NULL,
  article_code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_material_item_code_memory_updated_at
  ON public.material_item_code_memory(updated_at DESC);

ALTER TABLE public.material_item_code_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_item_code_memory_select_all ON public.material_item_code_memory;
CREATE POLICY material_item_code_memory_select_all
  ON public.material_item_code_memory
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS material_item_code_memory_insert_all ON public.material_item_code_memory;
CREATE POLICY material_item_code_memory_insert_all
  ON public.material_item_code_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS material_item_code_memory_update_all ON public.material_item_code_memory;
CREATE POLICY material_item_code_memory_update_all
  ON public.material_item_code_memory
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

