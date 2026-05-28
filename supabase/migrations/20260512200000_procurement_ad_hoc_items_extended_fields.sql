-- Vanredne stavke (procurement_ad_hoc_items): dodatna nabavna polja (NALOG, POZ, BOJA, DUŽ)
-- radi paritetnosti sa formom za kreiranje narudžbine. Polja su opciona; prikazuju se u PDF-u
-- samo ako bar jedna stavka u grupi ima vrednost.

ALTER TABLE public.procurement_ad_hoc_items
  ADD COLUMN IF NOT EXISTS work_order text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS length_mm numeric;

COMMENT ON COLUMN public.procurement_ad_hoc_items.work_order IS
  'Radni nalog (NALOG) — opciono polje, isto značenje kao kod material_orders.nb_lines.procurementMeta.work_order.';
COMMENT ON COLUMN public.procurement_ad_hoc_items.position IS
  'Pozicija (POZ) — opciono polje za referencu na pozicioni broj iz krojne liste.';
COMMENT ON COLUMN public.procurement_ad_hoc_items.color IS 'Boja / dekor stavke — opciono.';
COMMENT ON COLUMN public.procurement_ad_hoc_items.length_mm IS
  'Dužina u milimetrima — opciono numeričko polje za stavke kojima je važan podatak (profili / lajsne).';

DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid);
DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.create_procurement_ad_hoc_item(
  p_order_id uuid,
  p_description text,
  p_article_code text,
  p_quantity numeric,
  p_unit text,
  p_notes text,
  p_attachment_file_id uuid,
  p_work_order text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_length_mm numeric DEFAULT NULL
)
RETURNS public.procurement_ad_hoc_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
  v_new_id uuid := gen_random_uuid();
  v_barcode text;
  v_row public.procurement_ad_hoc_items;
  v_length numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;

  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za dodavanje vanredne stavke';
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) < 1 THEN
    RAISE EXCEPTION 'Naziv vanredne stavke je obavezan';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Količina mora biti veća od 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_orders WHERE id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Narudžbina nije pronađena';
  END IF;

  IF p_length_mm IS NOT NULL AND p_length_mm <= 0 THEN
    v_length := NULL;
  ELSE
    v_length := p_length_mm;
  END IF;

  v_barcode := public.procurement_short_barcode('A', v_new_id);

  INSERT INTO public.procurement_ad_hoc_items (
    id,
    order_id,
    description,
    article_code,
    quantity,
    unit,
    notes,
    attachment_file_id,
    barcode,
    status,
    created_by,
    work_order,
    position,
    color,
    length_mm
  )
  VALUES (
    v_new_id,
    p_order_id,
    trim(p_description),
    nullif(trim(coalesce(p_article_code, '')), ''),
    p_quantity,
    coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'kom'),
    nullif(trim(coalesce(p_notes, '')), ''),
    p_attachment_file_id,
    v_barcode,
    'reported_issue',
    auth.uid(),
    nullif(trim(coalesce(p_work_order, '')), ''),
    nullif(trim(coalesce(p_position, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''),
    v_length
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) TO service_role;

COMMENT ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) IS
  'Kreira vanrednu stavku sa A-barkodom i opcionim nabavnim poljima (NALOG, POZ, BOJA, DUŽ, JM).';

NOTIFY pgrst, 'reload schema';
