-- Dozvoli narudzbine materijala koje nisu vezane za konkretan posao.
ALTER TABLE material_orders
  ALTER COLUMN job_id DROP NOT NULL;
