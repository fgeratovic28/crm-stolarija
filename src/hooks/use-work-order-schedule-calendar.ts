import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  groupScheduleEntriesByDay,
  monthDateRangeYmd,
  normalizeWorkOrderDateYmd,
  parseScheduledTimeFromDescription,
  scheduledTimeFromIso,
  workOrderTypesForScheduleDisplayKind,
  workOrderTypesForScheduleKind,
  type WorkOrderScheduleCalendarEntry,
  type WorkOrderScheduleDisplayKind,
  type WorkOrderScheduleKind,
} from "@/lib/work-order-schedule-calendar";
import type { WorkOrderType } from "@/types";
import { formatJobInstallationLocationDisplay } from "@/lib/job-installation-location";

function mapCustomerName(raw: unknown): string {
  const row = (Array.isArray(raw) ? raw[0] : raw) as { name?: string } | null | undefined;
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  return name || "—";
}

function mapTeamName(raw: unknown): string {
  const row = (Array.isArray(raw) ? raw[0] : raw) as { name?: string } | null | undefined;
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  return name || "Neraspoređeno";
}

function mapRow(
  row: Record<string, unknown>,
  kind: WorkOrderScheduleKind,
): WorkOrderScheduleCalendarEntry | null {
  const workOrderId = typeof row.id === "string" ? row.id : String(row.id ?? "");
  const jobEmbed = row.jobs as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const job = Array.isArray(jobEmbed) ? jobEmbed[0] : jobEmbed;
  if (!workOrderId || !job) return null;

  const jobId = typeof job.id === "string" ? job.id : String(job.id ?? "");
  const jobNumber = typeof job.job_number === "string" ? job.job_number : String(job.job_number ?? "");
  const scheduledDay = normalizeWorkOrderDateYmd(row.date);
  if (!scheduledDay) return null;

  const teamEmbed = row.teams as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const teamRow = Array.isArray(teamEmbed) ? teamEmbed[0] : teamEmbed;
  const teamId =
    typeof row.team_id === "string" && row.team_id.trim() ? row.team_id.trim() : null;
  const teamName = mapTeamName(teamRow);

  const description = typeof row.description === "string" ? row.description : "";
  const jobScheduledAt =
    typeof job.scheduled_date === "string" ? job.scheduled_date.trim() : null;

  const scheduledTime =
    kind === "installation"
      ? scheduledTimeFromIso(jobScheduledAt) ?? parseScheduledTimeFromDescription(description)
      : parseScheduledTimeFromDescription(description);

  return {
    workOrderId,
    jobId,
    jobNumber,
    customerName: mapCustomerName(job.customers),
    teamId,
    teamName,
    scheduledDay,
    scheduledTime,
    workOrderType: row.type as WorkOrderType,
    status: typeof row.status === "string" ? row.status : "",
    description,
    installationAddress: formatJobInstallationLocationDisplay({
      installationAddress:
        typeof job.installation_address === "string" ? job.installation_address : undefined,
      installationApartment:
        typeof job.installation_apartment === "string" ? job.installation_apartment : undefined,
      installationFloor: typeof job.installation_floor === "string" ? job.installation_floor : undefined,
    }) || undefined,
  };
}

export function useWorkOrderScheduleCalendar(
  kind: WorkOrderScheduleKind,
  visibleMonth: Date,
  enabled: boolean,
  excludeWorkOrderId?: string,
  displayKind?: WorkOrderScheduleDisplayKind,
) {
  const { from, to } = monthDateRangeYmd(visibleMonth);
  const types = displayKind ? workOrderTypesForScheduleDisplayKind(displayKind) : workOrderTypesForScheduleKind(kind);

  const query = useQuery({
    queryKey: ["work-order-schedule-calendar", kind, displayKind ?? kind, from, to],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const base = supabase
        .from("work_orders")
        .select(
          `
          id,
          job_id,
          type,
          status,
          description,
          date,
          team_id,
          teams ( name ),
          jobs (
            id,
            job_number,
            scheduled_date,
            installation_address,
            installation_apartment,
            installation_floor,
            customers ( name )
          )
        `,
        )
        .in("type", [...types])
        .neq("status", "canceled")
        .not("team_id", "is", null)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });

      const { data, error } = await base;
      if (!error) return data ?? [];

      const minimal = await supabase
        .from("work_orders")
        .select(
          "id, job_id, type, status, description, date, team_id, jobs ( id, job_number, scheduled_date, installation_address, installation_apartment, installation_floor )",
        )
        .in("type", [...types])
        .neq("status", "canceled")
        .not("team_id", "is", null)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });

      if (minimal.error) throw minimal.error;
      return minimal.data ?? [];
    },
  });

  const entries = useMemo(() => {
    const rows = Array.isArray(query.data) ? query.data : [];
    const mapped = rows
      .map((row) => mapRow(row as Record<string, unknown>, kind))
      .filter((x): x is WorkOrderScheduleCalendarEntry => x != null)
      .filter((x) => !excludeWorkOrderId || x.workOrderId !== excludeWorkOrderId);
    return mapped;
  }, [query.data, kind, excludeWorkOrderId]);

  const byDay = useMemo(() => groupScheduleEntriesByDay(entries), [entries]);

  return {
    entries,
    byDay,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
