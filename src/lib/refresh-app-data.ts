import type { QueryClient } from "@tanstack/react-query";

/** Ponovo učitava aktivne React Query upite (Supabase/API) bez reload-a stranice. */
export async function refreshAppDataFromApi(queryClient: QueryClient): Promise<void> {
  await queryClient.refetchQueries({ type: "active" });
}
