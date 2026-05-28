-- Više priloga po jednoj ponudi (otpremanja na R2); `file_url` / `file_storage_key` = prvi prilog (kompatibilnost).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS file_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.quotes.file_attachments IS
  'JSON niz [{ "url", "storage_key?", "filename?" }, …] za sve fajlove jedne ponude.';

UPDATE public.quotes q
SET file_attachments = jsonb_build_array(
  jsonb_strip_nulls(
    jsonb_build_object(
      'url', trim(both from q.file_url),
      'storage_key', NULLIF(trim(both from coalesce(q.file_storage_key, '')), ''),
      'filename', NULL::text
    )
  )
)
WHERE q.file_url IS NOT NULL AND trim(both from q.file_url) <> '';
