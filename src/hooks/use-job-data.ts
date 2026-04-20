import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Payment, MaterialOrder, WorkOrder, FieldReport, FieldReportDetails } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { mapDbToActivity } from "@/hooks/use-activities";
import { mapDbToFile } from "@/hooks/use-files";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { mapMaterialOrderRow } from "@/lib/map-material-order";

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

export function useJobRelatedData(jobId: string | undefined) {
  const enabled = !!jobId;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const activities = useQuery({
    queryKey: ["activities", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(`
          *,
          users (name)
        `)
        .eq("job_id", jobId)
        .order("date", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToActivity(row as Parameters<typeof mapDbToActivity>[0]));
    },
    enabled,
  });

  const payments = useQuery({
    queryKey: ["payments", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("job_id", jobId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data.map(d => ({
        id: d.id,
        jobId: d.job_id,
        amount: d.amount,
        date: d.date,
        includesVat: d.vat_included,
        note: d.note,
      })) as Payment[];
    },
    enabled,
  });

  const materialOrders = useQuery({
    queryKey: ["material-orders", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("material_orders")
        .select(`
          *,
          suppliers (id, name, contact_person, address),
          jobs (id, job_number)
        `)
        .eq("job_id", jobId)
        .order("request_date", { ascending: false });

      if (error) throw error;
      return data.map((d) => {
        const jobData = Array.isArray(d.jobs) ? d.jobs[0] : d.jobs;
        return mapMaterialOrderRow(d as Record<string, unknown>, jobData as { id: string; job_number: string } | null | undefined);
      }) as MaterialOrder[];
    },
    enabled,
  });

  const workOrders = useQuery({
    queryKey: ["work-orders", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          *,
          teams (name)
        `)
        .eq("job_id", jobId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data.map(d => {
        const teamData = Array.isArray(d.teams) ? d.teams[0] : d.teams;
        const teamName =
          teamData && typeof teamData === "object" && teamData !== null && "name" in teamData
            ? String((teamData as { name?: string }).name ?? "").trim()
            : "";
        return {
          id: d.id,
          jobId: d.job_id,
          type: d.type,
          description: d.description,
          assignedTeamId: d.team_id,
          assignedTeamName: teamName || undefined,
          date: d.date,
          status: d.status,
          installationRef: (d as { installation_ref?: string | null }).installation_ref ?? undefined,
          productionRef: (d as { production_ref?: string | null }).production_ref ?? undefined,
        };
      }) as WorkOrder[];
    },
    enabled,
  });

  const fieldReports = useQuery({
    queryKey: ["field-reports", jobId, user?.id, user?.role, user?.teamId],
    queryFn: async () => {
      const isFieldScoped = isFieldExecutionRole(user?.role);
      const selectStr = isFieldScoped
        ? "*, work_orders!inner(id, team_id, type)"
        : "*, work_orders!left(id, team_id, type)";

      let query = supabase
        .from("field_reports")
        .select(selectStr)
        .eq("job_id", jobId)
        .order("arrival_datetime", { ascending: false });

      if (isFieldScoped) {
        if (!user?.teamId) return [];
        query = query.eq("work_orders.team_id", user.teamId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data.map(d => {
        const woData = d.work_orders;
        const rawDetails = (d as { details?: unknown }).details;
        const detailsParsed =
          rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
            ? (rawDetails as FieldReportDetails)
            : undefined;
        const estH = (d as { estimated_installation_hours?: unknown }).estimated_installation_hours;
        const estNum =
          estH === null || estH === undefined
            ? undefined
            : typeof estH === "number"
              ? estH
              : Number(estH);

        return {
          id: d.id,
          jobId: d.job_id,
          address: d.address,
          arrived: d.arrived,
          arrivalDate: d.arrival_datetime,
          siteCanceled: !!d.site_canceled,
          cancelReason: typeof d.cancel_reason === "string" ? d.cancel_reason : undefined,
          jobCompleted: d.completed,
          everythingOk: d.everything_ok,
          issueDescription: d.issues,
          details: detailsParsed,
          estimatedInstallationHours: Number.isFinite(estNum) ? estNum : undefined,
          handoverDate: d.handover_date,
          images: d.images || [],
          missingItems: d.missing_items || [],
          additionalNeeds: Array.isArray(d.additional_needs) ? d.additional_needs : [],
          measurements: d.measurements,
          generalNotes: d.general_report,
          workOrderId: d.work_order_id,
          workOrderType: woData?.type,
        };
      }) as FieldReport[];
    },
    enabled,
  });

  const files = useQuery({
    queryKey: ["files", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select(`
          *,
          users (name)
        `)
        .eq("job_id", jobId)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToFile(row as Parameters<typeof mapDbToFile>[0]));
    },
    enabled,
  });

  const recordPayment = useMutation({
    mutationFn: async (newPayment: Omit<Payment, "id">) => {
      const { data, error } = await supabase
        .from("payments")
        .insert([{
          job_id: newPayment.jobId,
          amount: newPayment.amount,
          date: newPayment.date,
          vat_included: newPayment.includesVat,
          note: newPayment.note,
        }])
        .select()
        .single();

      if (error) throw error;
      await upsertSystemActivity({
        jobId: newPayment.jobId,
        description: `Evidentirana uplata: ${Number(newPayment.amount) || 0}`,
        systemKey: `payment-recorded:${data.id}`,
        type: "in_person",
        authorId: user?.id ?? null,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId] }); // To update balance
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Uplata je uspešno evidentirana");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri evidentiranju uplate", { description: getErrorMessage(err) });
    },
  });

  return {
    activities: activities.data || [],
    payments: payments.data || [],
    materialOrders: materialOrders.data || [],
    workOrders: workOrders.data || [],
    fieldReports: fieldReports.data || [],
    files: files.data || [],
    recordPayment,
    isLoading: activities.isLoading || payments.isLoading || materialOrders.isLoading || workOrders.isLoading || fieldReports.isLoading || files.isLoading,
  };
}
