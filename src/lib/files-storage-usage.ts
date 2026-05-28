import type { QueryClient } from "@tanstack/react-query";

export const FILES_STORAGE_USAGE_QUERY_KEY = ["files-storage-usage"] as const;

/** Kvota skladišta za CRM (R2: `files` + prilozi `quotes`). Podrazumevano 10 GB; `VITE_STORAGE_QUOTA_GB` u .env. */
export function getStorageQuotaBytes(): number {
  const raw = import.meta.env.VITE_STORAGE_QUOTA_GB as string | undefined;
  const n = raw != null && String(raw).trim() !== "" ? Number(String(raw).replace(",", ".")) : 10;
  if (!Number.isFinite(n) || n <= 0) return 10 * 1024 * 1024 * 1024;
  return Math.round(n * 1024 * 1024 * 1024);
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function invalidateFilesStorageUsage(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [...FILES_STORAGE_USAGE_QUERY_KEY] });
}
