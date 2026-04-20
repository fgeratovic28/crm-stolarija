-- Više stavki po narudžbini (porudžbenica / štampa)
ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS nb_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.material_orders.nb_lines IS 'Stavke: [{ description, quantity, unit, lineNet, materialType? }], iznosi bez PDV-a.';

-- Migracija postojećih jednolinijskih podataka u niz
UPDATE public.material_orders mo
SET nb_lines = jsonb_build_array(
  jsonb_build_object(
    'description', COALESCE(
      NULLIF(trim(COALESCE(mo.nb_line_description, '')), ''),
      mo.material_type::text,
      'Stavka'
    ),
    'quantity', mo.nb_quantity,
    'unit', mo.nb_unit,
    'lineNet', COALESCE(mo.supplier_price, 0)::numeric
  )
)
WHERE mo.nb_lines = '[]'::jsonb
  AND (
    COALESCE(mo.supplier_price, 0) <> 0
    OR NULLIF(trim(COALESCE(mo.nb_line_description, '')), '') IS NOT NULL
  );

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
    'supplierAddress', COALESCE(s.address, ''),
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
    'customerPib', NULLIF(TRIM(c.pib), ''),
    'installationAddress', COALESCE(NULLIF(TRIM(j.installation_address), ''), NULLIF(TRIM(c.installation_address), '')),
    'billingAddress', NULLIF(TRIM(c.billing_address), ''),
    'customerPhone', NULLIF(TRIM(COALESCE(j.customer_phone, c.phones[1])), ''),
    'publicShareToken', mo.public_share_token::text,
    'nbLineDescription', mo.nb_line_description,
    'nbQuantity', mo.nb_quantity,
    'nbUnit', mo.nb_unit,
    'nbVatRatePercent', mo.nb_vat_rate_percent,
    'nbBuyerBankAccount', mo.nb_buyer_bank_account,
    'nbShippingMethod', mo.nb_shipping_method,
    'nbPaymentDueDate', mo.nb_payment_due_date::text,
    'nbPaymentNote', mo.nb_payment_note,
    'nbLegalReference', mo.nb_legal_reference,
    'nbDeliveryAddressOverride', mo.nb_delivery_address_override,
    'nbLines', mo.nb_lines
  )
  FROM public.material_orders mo
  LEFT JOIN public.suppliers s ON s.id = mo.supplier_id
  LEFT JOIN public.jobs j ON j.id = mo.job_id
  LEFT JOIN public.customers c ON c.id = j.customer_id
  WHERE mo.public_share_token = p_token;
$$;
