import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { FieldReport, FieldReportDetails, WorkOrderType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { formatQueryError } from "@/lib/utils";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import {
  applyFieldReportWorkflowBranching,
  ensureWorkflowWorkOrders,
} from "@/lib/work-order-workflow-automation";
import { fieldReportFlowForWorkOrderType, isFieldExecutionRole } from "@/lib/field-team-access";

function parseFieldReportDetails(raw: unknown): FieldReportDetails {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  return {
    arrivedAt: pick("arrivedAt"),
    canceledAt: pick("canceledAt"),
    finishedAt: pick("finishedAt"),
    issueReportedAt: pick("issueReportedAt"),
    additionalReqAt: pick("additionalReqAt"),
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
        ? `work_orders!inner ( job_id, type, team_id, ${jobsEmbed} )`
        : jobId
          ? `work_orders!inner ( job_id, type, team_id, ${jobsEmbed} )`
          : `work_orders ( job_id, type, team_id, ${jobsEmbed} )`;

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

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const rows = Array.isArray(data) ? data : [];

      return rows.map((d) => {
        const wo = d.work_orders;
        const woRow = Array.isArray(wo) ? wo[0] : wo;
        const jobEmb = woRow?.jobs;
        const jobRow = Array.isArray(jobEmb) ? jobEmb[0] : jobEmb;
        const custRaw = jobRow?.customers;
        const customer = Array.isArray(custRaw) ? custRaw[0] : custRaw;

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
          everythingOk: d.everything_ok !== false,
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

  const createReport = useMutation({
    mutationFn: async (report: Omit<FieldReport, "id"> & { workOrderId?: string }) => {
      // report.images = javni R2 URL-ovi (TEXT[]), generisani pri otpremanju u NewFieldReportModal
      const detailsJson = report.details && Object.keys(report.details).length > 0 ? report.details : {};
      const reportData = {
        work_order_id: report.workOrderId || null,
        job_id: report.jobId || null,
        address: report.address?.trim() || null,
        arrived: report.arrived,
        arrival_datetime: report.arrivalDate ?? null,
        site_canceled: report.siteCanceled,
        cancel_reason: report.cancelReason?.trim() || null,
        completed: report.jobCompleted,
        everything_ok: report.everythingOk,
        issues: report.issueDescription?.trim() || null,
        images: report.images,
        missing_items: report.missingItems,
        additional_needs: report.additionalNeeds,
        measurements: report.measurements?.trim() || null,
        general_report: report.generalNotes,
        details: detailsJson,
        estimated_installation_hours:
          report.estimatedInstallationHours != null && Number.isFinite(report.estimatedInstallationHours)
            ? report.estimatedInstallationHours
            : null,
      };

      const { data, error } = await supabase
        .from("field_reports")
        .insert([reportData])
        .select()
        .single();

      if (error) throw error;

      if (report.workOrderId) {
        // Sačuvan izveštaj = završen radni nalog (osim eksplicitnog otkazivanja na terenu).
        const nextStatus: "completed" | "canceled" = report.siteCanceled ? "canceled" : "completed";

        const { error: statusError } = await supabase
          .from("work_orders")
          .update({ status: nextStatus })
          .eq("id", report.workOrderId);

        if (statusError) throw statusError;
      }

      if (report.jobId) {
        const reportFlow = fieldReportFlowForWorkOrderType(report.workOrderType);
        await upsertSystemActivity({
          jobId: report.jobId,
          description:
            reportFlow === "production"
              ? "Dodat izveštaj proizvodnje"
              : reportFlow === "mounting"
                ? "Dodat montažni izveštaj"
                : "Dodat terenski izveštaj",
          systemKey: `field-report-created:${data.id}`,
          authorId: user?.id ?? null,
        });
        try {
          await applyFieldReportWorkflowBranching(data.id as string);
        } catch (err) {
          console.warn("applyFieldReportWorkflowBranching posle terenskog izveštaja:", err);
        }
        try {
          await ensureWorkflowWorkOrders(report.jobId);
        } catch (err) {
          console.warn("ensureWorkflowWorkOrders posle terenskog izveštaja:", err);
        }
        try {
          await recomputeJobStatus(report.jobId, user?.id ?? null);
        } catch (err) {
          console.warn("Auto status recompute failed after field report:", err);
        }
      }

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
