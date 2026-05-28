import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  FILES_STORAGE_USAGE_QUERY_KEY,
  formatStorageBytes,
  getStorageQuotaBytes,
} from "@/lib/files-storage-usage";

function isMissingRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42883" || e.code === "PGRST202") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return msg.includes("files_storage_total_bytes") && msg.includes("Could not find");
}

export function useFilesStorageUsage(enabled: boolean) {
  const quotaBytes = getStorageQuotaBytes();

  return useQuery({
    queryKey: [...FILES_STORAGE_USAGE_QUERY_KEY],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const rpc = await supabase.rpc("files_storage_total_bytes");
      if (!rpc.error && rpc.data != null) {
        const usedBytes = typeof rpc.data === "number" ? rpc.data : Number(rpc.data) || 0;
        return {
          usedBytes,
          quotaBytes,
          usedLabel: formatStorageBytes(usedBytes),
          quotaLabel: formatStorageBytes(quotaBytes),
          percentFull: quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0,
        };
      }
      if (isMissingRpcError(rpc.error)) {
        const [{ data: fileRows, error: fileErr }, { data: quoteRows, error: quoteErr }] = await Promise.all([
          supabase.from("files").select("size_bytes"),
          supabase.from("quotes").select("attachments_total_bytes"),
        ]);
        if (fileErr) throw fileErr;
        if (quoteErr) throw quoteErr;
        const fromFiles = (fileRows ?? []).reduce(
          (s, r) => s + (Number((r as { size_bytes?: unknown }).size_bytes) || 0),
          0,
        );
        const fromQuotes = (quoteRows ?? []).reduce(
          (s, r) =>
            s + (Number((r as { attachments_total_bytes?: unknown }).attachments_total_bytes) || 0),
          0,
        );
        const usedBytes = fromFiles + fromQuotes;
        return {
          usedBytes,
          quotaBytes,
          usedLabel: formatStorageBytes(usedBytes),
          quotaLabel: formatStorageBytes(quotaBytes),
          percentFull: quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0,
        };
      }
      throw rpc.error ?? new Error("Nije moguće učitati zauzeće skladišta.");
    },
  });
}
