-- R2 object key (prefix files/ or field-photos/) for delete and public URL; null = legacy Supabase Storage uploads
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS storage_key TEXT;

COMMENT ON COLUMN files.storage_key IS 'R2 object key (S3 key) within the bucket; used for delete and public URL';
