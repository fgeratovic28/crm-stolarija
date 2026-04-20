import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { mapDbToFile, type FileRow } from "@/hooks/use-files";
import type { AppFile } from "@/types";

/**
 * Fajlovi priloženi narudžbinama (kolona `files.material_order_id`).
 */
export function useMaterialOrderAttachments(orderIds: string[]) {
  const key = [...new Set(orderIds.filter(Boolean))].sort().join(",");

  return useQuery({
    queryKey: ["material-order-files", key],
    queryFn: async (): Promise<Record<string, AppFile[]>> => {
      const ids = [...new Set(orderIds.filter(Boolean))];
      if (ids.length === 0) return {};

      const { data, error } = await supabase
        .from("files")
        .select(`
          *,
          users (name)
        `)
        .in("material_order_id", ids);

      if (error) throw error;

      const by: Record<string, AppFile[]> = {};
      for (const row of data ?? []) {
        const oid = row.material_order_id as string | null;
        if (!oid) continue;
        if (!by[oid]) by[oid] = [];
        by[oid].push(mapDbToFile(row as FileRow));
      }
      return by;
    },
    enabled: orderIds.filter(Boolean).length > 0,
  });
}
