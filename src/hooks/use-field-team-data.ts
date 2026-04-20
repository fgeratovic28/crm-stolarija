import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { WorkOrder } from "@/types";
import { isFieldExecutionRole } from "@/lib/field-team-access";

export type FieldTeamJobEmbed = {
  id: string;
  jobNumber: string;
  /** Telefon za ovaj posao (često jedini unos ako se razlikuje od kartice klijenta). */
  customerPhone?: string | null;
  installationAddress?: string;
  summary?: string;
  installationLat?: number | null;
  installationLng?: number | null;
  customer?: { fullName: string; phones?: string[] };
};

export type FieldTeamWorkOrder = WorkOrder & { job?: FieldTeamJobEmbed };

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapWorkOrderRow(d: Record<string, unknown>): FieldTeamWorkOrder {
  const jobRaw = d.job as Record<string, unknown> | null | undefined;
  const custRaw = jobRaw?.customer as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const cust = Array.isArray(custRaw) ? custRaw[0] : custRaw;

  return {
    id: d.id as string,
    jobId: d.job_id as string,
    type: d.type as FieldTeamWorkOrder["type"],
    description: (d.description as string) || "",
    assignedTeamId: d.team_id as string | undefined,
    date: d.date as string,
    status: d.status as FieldTeamWorkOrder["status"],
    attachmentName: d.file_id ? "attachment" : undefined,
    installationRef: d.installation_ref as string | undefined,
    productionRef: d.production_ref as string | undefined,
    job: jobRaw
      ? {
          id: jobRaw.id as string,
          jobNumber: jobRaw.job_number as string,
          customerPhone:
            typeof jobRaw.customer_phone === "string" ? jobRaw.customer_phone : null,
          installationAddress:
            typeof jobRaw.installation_address === "string" ? jobRaw.installation_address : undefined,
          summary: typeof jobRaw.summary === "string" ? jobRaw.summary : undefined,
          installationLat: parseNullableNumber(jobRaw.installation_lat),
          installationLng: parseNullableNumber(jobRaw.installation_lng),
          customer: cust
            ? {
                fullName: (cust.name as string) || "",
                phones: (cust.phones as string[]) || [],
              }
            : undefined,
        }
      : undefined,
  };
}

export function useFieldTeamData() {
  const { user } = useAuthStore();

  const { data: workOrders, isLoading: isLoadingOrders, error: ordersError } = useQuery({
    queryKey: ["field-team-work-orders", user?.teamId, user?.role],
    queryFn: async () => {
      if (!user?.teamId || !isFieldExecutionRole(user.role)) return [] as FieldTeamWorkOrder[];

      const selectWithCoords = `
          *,
          job:jobs!inner (
            id,
            job_number,
            customer_phone,
            installation_address,
            installation_lat,
            installation_lng,
            summary,
            customer:customers (
              name,
              phones
            )
          )
        `;

      const selectLegacy = `
          *,
          job:jobs!inner (
            id,
            job_number,
            customer_phone,
            installation_address,
            summary,
            customer:customers (
              name,
              phones
            )
          )
        `;

      const first = await supabase
        .from("work_orders")
        .select(selectWithCoords)
        .eq("team_id", user.teamId)
        .order("date", { ascending: true });

      let data = first.data;
      if (first.error) {
        const retry = await supabase
          .from("work_orders")
          .select(selectLegacy)
          .eq("team_id", user.teamId)
          .order("date", { ascending: true });
        if (retry.error) throw retry.error;
        data = retry.data;
      }

      if (!data) return [];

      return (data as Record<string, unknown>[]).map(mapWorkOrderRow);
    },
    enabled: !!user?.teamId && isFieldExecutionRole(user?.role),
  });

  return {
    workOrders,
    isLoading: isLoadingOrders,
    error: ordersError,
  };
}
