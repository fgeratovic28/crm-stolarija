import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { WorkOrder } from "@/types";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import type { LatestFieldReportBriefForMontazaCard } from "@/lib/installation-montaza-card-photos";

export type FieldTeamJobEmbed = {
  id: string;
  jobNumber: string;
  /** Telefon za ovaj posao (često jedini unos ako se razlikuje od kartice klijenta). */
  customerPhone?: string | null;
  installationAddress?: string;
  installationApartment?: string;
  installationFloor?: string;
  summary?: string;
  installationLat?: number | null;
  installationLng?: number | null;
  /** Zakazana ugradnja (ISO) — za prikaz vremena na terenskoj kartici. */
  scheduledAt?: string | null;
  customer?: { fullName: string; phones?: string[]; installationAddress?: string };
};

export type FieldTeamWorkOrder = WorkOrder & {
  job?: FieldTeamJobEmbed;
  latestFieldReportBrief: LatestFieldReportBriefForMontazaCard;
};

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapWorkOrderRow(d: Record<string, unknown>): FieldTeamWorkOrder {
  const jobRaw = d.job as Record<string, unknown> | null | undefined;
  const custRaw = jobRaw?.customer as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const cust = Array.isArray(custRaw) ? custRaw[0] : custRaw;

  const fileEmbed = (d as { files?: { id?: string; filename?: string } | { id?: string; filename?: string }[] | null })
    .files;
  const fileRow = Array.isArray(fileEmbed) ? fileEmbed[0] : fileEmbed;
  const rawFid = d.file_id;
  const fileIdFromRow = typeof rawFid === "string" ? rawFid : undefined;
  const attachmentFileId = fileRow?.id ?? fileIdFromRow ?? undefined;
  const attachmentName =
    typeof fileRow?.filename === "string" && fileRow.filename.trim()
      ? fileRow.filename
      : attachmentFileId
        ? "Prilog"
        : undefined;

  const rawFrNested = (d.field_reports ??
    []) as Array<Record<string, unknown>> | Record<string, unknown> | null;
  const frList = Array.isArray(rawFrNested) ? rawFrNested : rawFrNested ? [rawFrNested] : [];
  const frSorted = [...frList].sort((a, b) => {
    const ta = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
    const tb = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  const head = frSorted[0];
  let latestFieldReportBrief: LatestFieldReportBriefForMontazaCard = null;
  if (head) {
    const needs = head.additional_needs as string[] | null | undefined;
    const additionalNeedsCount = Array.isArray(needs) ? needs.filter((x) => String(x ?? "").trim() !== "").length : 0;
    const rawOk = head.everything_ok as boolean | null | undefined;
    latestFieldReportBrief = {
      everythingOk: typeof rawOk === "boolean" ? rawOk : null,
      siteCanceled: head.site_canceled === true,
      additionalNeedsCount,
    };
  }

  return {
    id: d.id as string,
    jobId: d.job_id as string,
    type: d.type as FieldTeamWorkOrder["type"],
    description: (d.description as string) || "",
    measurementLocation: (d.measurement_location as string) || undefined,
    measurementScope: (d.measurement_scope as string) || undefined,
    assignedTeamId: d.team_id as string | undefined,
    date: d.date as string,
    status: d.status as FieldTeamWorkOrder["status"],
    attachmentFileId,
    attachmentName,
    fieldStartedAt:
      typeof (d as { field_started_at?: string | null }).field_started_at === "string"
        ? (d as { field_started_at: string }).field_started_at
        : undefined,
    fieldCompletedAt:
      typeof (d as { field_completed_at?: string | null }).field_completed_at === "string"
        ? (d as { field_completed_at: string }).field_completed_at
        : undefined,
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
          installationApartment:
            typeof jobRaw.installation_apartment === "string" ? jobRaw.installation_apartment : undefined,
          installationFloor:
            typeof jobRaw.installation_floor === "string" ? jobRaw.installation_floor : undefined,
          summary: typeof jobRaw.summary === "string" ? jobRaw.summary : undefined,
          installationLat: parseNullableNumber(jobRaw.installation_lat),
          installationLng: parseNullableNumber(jobRaw.installation_lng),
          scheduledAt:
            typeof jobRaw.scheduled_date === "string" && jobRaw.scheduled_date.trim()
              ? jobRaw.scheduled_date.trim()
              : null,
          customer: cust
            ? {
                fullName: (cust.name as string) || "",
                phones: (cust.phones as string[]) || [],
                installationAddress:
                  typeof cust.installation_address === "string" ? cust.installation_address : undefined,
              }
            : undefined,
        }
      : undefined,
    latestFieldReportBrief,
  };
}

const WORK_ORDERS_FIELD_TEAM_SELECT = `
          *,
          files (id, filename, storage_key, storage_url),
          job:jobs (
            id,
            job_number,
            customer_phone,
            installation_address,
            installation_apartment,
            installation_floor,
            summary,
            scheduled_date,
            installation_lat,
            installation_lng,
            customer:customers (
              name,
              phones,
              installation_address
            )
          ),
          field_reports!field_reports_work_order_id_fkey (
            everything_ok,
            site_canceled,
            additional_needs,
            created_at
          )
        `;

/** Promeni kada se menja fetch (bust keša / starog bundle-a). */
export const FIELD_TEAM_WORK_ORDERS_QUERY_VERSION = 8 as const;

export function fieldTeamWorkOrdersQueryKey(
  teamId: string | null | undefined,
  role: string | null | undefined,
): readonly ["field-team-work-orders", typeof FIELD_TEAM_WORK_ORDERS_QUERY_VERSION, string, string] {
  return ["field-team-work-orders", FIELD_TEAM_WORK_ORDERS_QUERY_VERSION, teamId ?? "", role ?? ""] as const;
}

export function useFieldTeamData() {
  const { user } = useAuthStore();

  const { data: workOrders, isLoading: isLoadingOrders, error: ordersError } = useQuery({
    queryKey: fieldTeamWorkOrdersQueryKey(user?.teamId, user?.role),
    /** Brzo povlačenje posle Realtime invalidacije; fokus na prozor vraća sveže dodele. */
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!user?.teamId || !isFieldExecutionRole(user.role)) return [] as FieldTeamWorkOrder[];

      const { data, error } = await supabase
        .from("work_orders")
        .select(WORK_ORDERS_FIELD_TEAM_SELECT)
        .eq("team_id", user.teamId)
        .order("date", { ascending: true });

      if (error) throw error;
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
