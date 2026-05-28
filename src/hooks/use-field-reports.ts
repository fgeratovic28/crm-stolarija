import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { FieldReport, FieldReportDetails, WorkOrderType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { formatQueryError } from "@/lib/utils";
import { submitFieldWorkerFieldReport } from "@/lib/job-workflow-actions";
import { URGENT_SITE_MISSING_QUERY_KEY } from "@/hooks/use-urgent-site-missing-notifications";
import { fieldReportFlowForWorkOrderType, isFieldExecutionRole } from "@/lib/field-team-access";
import { fieldReportEverythingOkFromDbRow } from "@/lib/field-report-mappers";

function parseFieldReportDetails(raw: unknown): FieldReportDetails {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const rawCompletedItems = o.productionCompletedItems;
  const productionCompletedItems = Array.isArray(rawCompletedItems)
    ? rawCompletedItems
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const row = entry as Record<string, unknown>;
          const profileTitle = typeof row.profileTitle === "string" ? row.profileTitle.trim() : "";
          const barcode = typeof row.barcode === "string" ? row.barcode.trim() : "";
          if (!profileTitle || !barcode) return null;
          return {
            profileCode: typeof row.profileCode === "string" ? row.profileCode : undefined,
            profileTitle,
            barcode,
            completedAt: typeof row.completedAt === "string" ? row.completedAt : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
    : undefined;
  return {
    arrivedAt: pick("arrivedAt"),
    canceledAt: pick("canceledAt"),
    finishedAt: pick("finishedAt"),
    issueReportedAt: pick("issueReportedAt"),
    additionalReqAt: pick("additionalReqAt"),
    productionCompletedItems,
  };
}

function parseEstimatedHours(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function useFieldReports(jobId?: string, workOrderId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const realtimeInstanceIdRef = useRef(
    `field-reports-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const fieldTeamScoped = !!(user && isFieldExecutionRole(user.role) && user.teamId);
  const fieldTeamNoTeam = !!(user && isFieldExecutionRole(user.role) && !user.teamId);

  const { data: reports, isLoading, isError, error } = useQuery({
    queryKey: ["field-reports", jobId, workOrderId, user?.id, user?.role, user?.teamId],
    enabled: !!user && !fieldTeamNoTeam,
    retry: 1,
    queryFn: async () => {
      if (!user) return [];
      if (isFieldExecutionRole(user.role) && !user.teamId) return [];

      const jobsEmbed =
        "jobs ( id, job_number, installation_address, customers (name) )";
      /** Za timske uloge: samo izveštaji vezani za RN njihovog tima (usklađeno sa RLS). */
      const workOrderNested = fieldTeamScoped
        ? `work_orders!field_reports_work_order_id_fkey!inner ( job_id, type, team_id, ${jobsEmbed} )`
        : jobId
          ? `work_orders!field_reports_work_order_id_fkey!inner ( job_id, type, team_id, ${jobsEmbed} )`
          : `work_orders!field_reports_work_order_id_fkey ( job_id, type, team_id, ${jobsEmbed} )`;

      let query = supabase.from("field_reports").select(`*, ${workOrderNested}`);

      if (jobId) {
        query = query.eq("work_orders.job_id", jobId);
      }

      if (fieldTeamScoped) {
        query = query.eq("work_orders.team_id", user.teamId);
      }

      if (workOrderId) {
        query = query.eq("work_order_id", workOrderId);
      }

      query = query.order("created_at", { ascending: false });

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const rows = Array.isArray(data) ? data : [];

      const workOrderIds = [
        ...new Set(
          rows
            .map((d) => d.work_order_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ];
      const teamIdByWorkOrderId = new Map<string, string | null>();
      if (workOrderIds.length > 0) {
        const { data: woTeamRows, error: woTeamError } = await supabase
          .from("work_orders")
          .select("id, team_id")
          .in("id", workOrderIds);
        if (woTeamError) throw woTeamError;
        for (const wo of woTeamRows ?? []) {
          teamIdByWorkOrderId.set(wo.id, wo.team_id ?? null);
        }
      }

      return rows.map((d) => {
        const wo = d.work_orders;
        const woRow = Array.isArray(wo) ? wo[0] : wo;
        const jobEmb = woRow?.jobs;
        const jobRow = Array.isArray(jobEmb) ? jobEmb[0] : jobEmb;
        const custRaw = jobRow?.customers;
        const customer = Array.isArray(custRaw) ? custRaw[0] : custRaw;

        const workOrderId =
          typeof d.work_order_id === "string" ? d.work_order_id : undefined;
        const embeddedTeamId =
          typeof woRow?.team_id === "string" && woRow.team_id.length > 0
            ? woRow.team_id
            : undefined;
        const batchTeamId = workOrderId
          ? teamIdByWorkOrderId.get(workOrderId) ?? undefined
          : undefined;
        const resolvedTeamId =
          embeddedTeamId ||
          (typeof batchTeamId === "string" && batchTeamId.length > 0
            ? batchTeamId
            : undefined);

        const resolvedJobId =
          (d.job_id as string | undefined) ?? woRow?.job_id ?? jobId ?? "";

        const row = d as Record<string, unknown>;
        const savedAddress =
          typeof row.address === "string" ? row.address.trim() : "";
        const installAddr =
          typeof jobRow?.installation_address === "string"
            ? jobRow.installation_address.trim()
            : "";
        const displayAddress =
          savedAddress || installAddr || "Adresa nije upisana";

        return {
          id: d.id,
          jobId: resolvedJobId,
          address: displayAddress,
          arrived: !!d.arrived,
          arrivalDate: d.arrival_datetime,
          siteCanceled: !!d.site_canceled,
          cancelReason: typeof d.cancel_reason === "string" ? d.cancel_reason : undefined,
          jobCompleted: !!d.completed,
          everythingOk: fieldReportEverythingOkFromDbRow({
            everything_ok: d.everything_ok,
            issues: d.issues,
            missing_items: d.missing_items,
          }),
          issueDescription: d.issues,
          details: parseFieldReportDetails(d.details),
          estimatedInstallationHours: parseEstimatedHours(d.estimated_installation_hours),
          images: d.images || [],
          missingItems: d.missing_items || [],
          additionalNeeds: d.additional_needs || [],
          measurements: d.measurements,
          generalNotes: d.general_report,
          workOrderId: d.work_order_id,
          workOrderType: woRow?.type as WorkOrderType | undefined,
          teamId: resolvedTeamId,
          job: jobRow
            ? {
                id: jobRow.id,
                jobNumber: jobRow.job_number,
                customer: customer
                  ? {
                      fullName: customer.name || "Nepoznat",
                    }
                  : undefined,
              }
            : undefined,
        };
      }) as FieldReport[];
    },
  });

  useEffect(() => {
    const channelName = `field-reports-live:${jobId ?? "all"}:${workOrderId ?? "all"}:${user?.id ?? "anon"}:${realtimeInstanceIdRef.current}`;
    const filter = workOrderId
      ? `work_order_id=eq.${workOrderId}`
      : jobId
        ? `job_id=eq.${jobId}`
        : undefined;

    const channel = supabase.channel(channelName).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "field_reports",
        ...(filter ? { filter } : {}),
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["field-reports"] });
        if (jobId) {
          void queryClient.invalidateQueries({ queryKey: ["field-reports", jobId] });
          void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
          void queryClient.invalidateQueries({ queryKey: ["work-orders", jobId] });
        }
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["activities"] });
      },
    ).subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, queryClient, user?.id, workOrderId]);

  const createReport = useMutation({
    mutationFn: async (report: Omit<FieldReport, "id"> & { workOrderId?: string }) => {
      const data = await submitFieldWorkerFieldReport(supabase, report, user?.id ?? null);
      return data;
    },
    onSuccess: async (_, variables) => {
      const reportFlow = fieldReportFlowForWorkOrderType(variables.workOrderType);
      queryClient.invalidateQueries({ queryKey: ["field-reports"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["field-reports", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (variables.jobId) {
        await queryClient.refetchQueries({ queryKey: ["job", variables.jobId] });
        queryClient.invalidateQueries({ queryKey: ["work-orders", variables.jobId] });
      }
      void queryClient.invalidateQueries({ queryKey: [...URGENT_SITE_MISSING_QUERY_KEY] });
      toast({
        title: "Izveštaj sačuvan",
        description:
          reportFlow === "production"
            ? "Izveštaj proizvodnje je uspešno sačuvan."
            : reportFlow === "mounting"
              ? "Montažni izveštaj je uspešno sačuvan."
              : "Terenski izveštaj je uspešno dodat.",
      });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: formatQueryError(error),
        variant: "destructive",
      });
    },
  });

  return {
    reports,
    isLoading,
    isError,
    error,
    createReport,
  };
}
