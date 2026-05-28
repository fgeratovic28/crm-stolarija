import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { WorkOrder } from "@/types";

type WorkOrderList = WorkOrder[] | undefined;

function patchList(list: WorkOrderList, orderId: string, patch: Partial<WorkOrder>): WorkOrderList {
  if (!list) return list;
  let changed = false;
  const next = list.map((wo) => {
    if (wo.id !== orderId) return wo;
    changed = true;
    return { ...wo, ...patch };
  });
  return changed ? next : list;
}

/** Odmah ažurira status RN u svim React Query keševima (lista, detalj posla, terenski dashboard). */
export function patchWorkOrderInAllCaches(
  queryClient: QueryClient,
  orderId: string,
  patch: Partial<WorkOrder>,
): void {
  const prefixes: QueryKey[] = [["work-orders"], ["field-team-work-orders"]];

  for (const prefix of prefixes) {
    const entries = queryClient.getQueriesData<WorkOrderList>({ queryKey: prefix });
    for (const [key, data] of entries) {
      const next = patchList(data, orderId, patch);
      if (next !== data) {
        queryClient.setQueryData(key, next);
      }
    }
  }
}

export function invalidateWorkOrderQueries(queryClient: QueryClient, jobId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ["work-orders"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"], refetchType: "active" });
  if (jobId) {
    void queryClient.invalidateQueries({ queryKey: ["work-orders", jobId], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["job", jobId], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["activities", jobId], refetchType: "active" });
  }
}
