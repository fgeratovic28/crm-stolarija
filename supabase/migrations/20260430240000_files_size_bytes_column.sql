-- Dodaj size_bytes kolonu u files tabelu za bolji tracking skladišnog prostora.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS size_bytes bigint;
