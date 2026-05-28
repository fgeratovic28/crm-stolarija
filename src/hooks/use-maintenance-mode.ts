import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const MAINTENANCE_MODE_QUERY_KEY = ["maintenance_mode"] as const;

/** Ne blokiraj ceo UI predugo — isto ponašanje kao greška mreže (app se otvara; refetch na fokusu/intervalu). */
const MAINTENANCE_RPC_TIMEOUT_MS = 2_000;

function sleep(ms: number) {
  return new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms));
}

async function fetchMaintenanceMode(): Promise<boolean> {
  const rpc = supabase.rpc("get_maintenance_mode").then((result) => {
    const { data, error } = result;
    if (error) {
      console.error("get_maintenance_mode:", error);
      throw error;
    }
    return data === true;
  });

  const outcome = await Promise.race([rpc, sleep(MAINTENANCE_RPC_TIMEOUT_MS)]);
  if (outcome === "timeout") {
    console.warn("get_maintenance_mode: timeout — releasing splash (same as unreachable server)");
    throw new Error("get_maintenance_mode_timeout");
  }
  return outcome;
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
    retry: 0,
  });
}
