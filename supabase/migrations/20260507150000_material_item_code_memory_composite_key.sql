CREATE TABLE IF NOT EXISTS public.material_item_code_memory (
  normalized_article text PRIMARY KEY,
  article_name text NOT NULL,
  article_code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

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

ALTER TABLE public.material_item_code_memory
  ADD COLUMN IF NOT EXISTS normalized_lookup_key text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS length_mm integer;

UPDATE public.material_item_code_memory
SET normalized_lookup_key = normalized_article
WHERE normalized_lookup_key IS NULL;

ALTER TABLE public.material_item_code_memory
  ALTER COLUMN normalized_lookup_key SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'material_item_code_memory'
      AND constraint_name = 'material_item_code_memory_pkey'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.material_item_code_memory
      DROP CONSTRAINT material_item_code_memory_pkey;
  END IF;
END
$$;

ALTER TABLE public.material_item_code_memory
  ADD CONSTRAINT material_item_code_memory_pkey PRIMARY KEY (normalized_lookup_key);

CREATE INDEX IF NOT EXISTS idx_material_item_code_memory_article
  ON public.material_item_code_memory(normalized_article);

