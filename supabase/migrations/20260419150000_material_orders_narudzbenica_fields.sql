-- Polja za štampanu / javnu narudžbenicu (dopuna glavnog unosa)
ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS nb_line_description TEXT,
  ADD COLUMN IF NOT EXISTS nb_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nb_unit TEXT NOT NULL DEFAULT 'kom',
  ADD COLUMN IF NOT EXISTS nb_vat_rate_percent NUMERIC(5, 2) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS nb_buyer_bank_account TEXT,
  ADD COLUMN IF NOT EXISTS nb_shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS nb_payment_due_date DATE,
  ADD COLUMN IF NOT EXISTS nb_payment_note TEXT,
  ADD COLUMN IF NOT EXISTS nb_legal_reference TEXT,
  ADD COLUMN IF NOT EXISTS nb_delivery_address_override TEXT;

COMMENT ON COLUMN public.material_orders.nb_line_description IS 'Puni naziv stavke na narudžbenici (ako prazno — vrsta materijala).';
COMMENT ON COLUMN public.material_orders.nb_quantity IS 'Količina za stavku.';
COMMENT ON COLUMN public.material_orders.nb_unit IS 'Jedinica mere (kom, m2, …).';
COMMENT ON COLUMN public.material_orders.nb_vat_rate_percent IS 'Stopa PDV-a za obračun (podrazumevano 20).';
COMMENT ON COLUMN public.material_orders.nb_buyer_bank_account IS 'Žiro račun naručioca (kupca).';
COMMENT ON COLUMN public.material_orders.nb_shipping_method IS 'Način otpreme.';
COMMENT ON COLUMN public.material_orders.nb_payment_due_date IS 'Rok plaćanja.';
COMMENT ON COLUMN public.material_orders.nb_payment_note IS 'Dodatni uslovi plaćanja.';
COMMENT ON COLUMN public.material_orders.nb_legal_reference IS 'Na temelju (ugovor / zahtev).';
COMMENT ON COLUMN public.material_orders.nb_delivery_address_override IS 'Isporuka na drugu adresu od kupca u CRM-u.';

-- Ažuriran javni prikaz (RPC)
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
    'nbDeliveryAddressOverride', mo.nb_delivery_address_override
  )
  FROM public.material_orders mo
  LEFT JOIN public.suppliers s ON s.id = mo.supplier_id
  LEFT JOIN public.jobs j ON j.id = mo.job_id
  LEFT JOIN public.customers c ON c.id = j.customer_id
  WHERE mo.public_share_token = p_token;
$$;
