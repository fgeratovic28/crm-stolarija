-- Javni link (QR) ka istoj porudžbenici bez prijave u CRM
ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS public_share_token UUID DEFAULT gen_random_uuid();

UPDATE public.material_orders
SET public_share_token = gen_random_uuid()
WHERE public_share_token IS NULL;

ALTER TABLE public.material_orders
  ALTER COLUMN public_share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS material_orders_public_share_token_key
  ON public.material_orders (public_share_token);

COMMENT ON COLUMN public.material_orders.public_share_token IS 'Jedinstveni token za javni prikaz narudžbenice (QR link).';

-- Javni očitavanje podataka (samo uz tačan token)
CREATE OR REPLACE FUNCTION public.get_public_narudzbenica(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', mo.id,
    'materialType', mo.material_type::text,
    'supplier', COALESCE(s.name, mo.supplier, ''),
    'supplierContact', COALESCE(s.contact_person, mo.supplier_contact, ''),
    'requestDate', mo.request_date::text,
    'expectedDelivery', mo.expected_delivery_date::text,
    'deliveryDate', mo.delivery_date::text,
    'price', mo.supplier_price,
    'paid', mo.paid,
    'deliveryStatus', mo.delivery_status::text,
    'notes', mo.notes,
    'barcode', mo.barcode,
    'jobNumber', j.job_number,
    'customerName', c.name,
    'installationAddress', COALESCE(NULLIF(TRIM(j.installation_address), ''), NULLIF(TRIM(c.installation_address), '')),
    'billingAddress', NULLIF(TRIM(c.billing_address), ''),
    'customerPhone', NULLIF(TRIM(COALESCE(j.customer_phone, c.phones[1])), ''),
    'publicShareToken', mo.public_share_token::text
  )
  FROM public.material_orders mo
  LEFT JOIN public.suppliers s ON s.id = mo.supplier_id
  LEFT JOIN public.jobs j ON j.id = mo.job_id
  LEFT JOIN public.customers c ON c.id = j.customer_id
  WHERE mo.public_share_token = p_token;
$$;

REVOKE ALL ON FUNCTION public.get_public_narudzbenica(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_narudzbenica(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_narudzbenica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_narudzbenica(uuid) TO service_role;
