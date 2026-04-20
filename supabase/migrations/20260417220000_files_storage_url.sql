-- Javni URL fajla u R2 (snimljen pri otpremi); nullable za stare zapise
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS storage_url TEXT;

COMMENT ON COLUMN files.storage_url IS 'Public URL of the object (R2); paired with storage_key for delete';
