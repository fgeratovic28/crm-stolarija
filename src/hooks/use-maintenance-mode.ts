import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const MAINTENANCE_MODE_QUERY_KEY = ["maintenance_mode"] as const;

async function fetchMaintenanceMode(): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_maintenance_mode");
  if (error) {
    console.error("get_maintenance_mode:", error);
    throw error;
  }
  return data === true;
}

/**
 * Globalni režim održavanja (anon RPC na loginu + ulogovani).
 */
export function useMaintenanceModeQuery(enabled: boolean) {
  return useQuery({
    queryKey: MAINTENANCE_MODE_QUERY_KEY,
    queryFn: fetchMaintenanceMode,
    enabled,
    staleTime: 30_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
