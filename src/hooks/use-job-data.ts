import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Payment, MaterialOrder, WorkOrder, FieldReport, FieldReportDetails, Quote, JobItem } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { fieldReportEverythingOkFromDbRow } from "@/lib/field-report-mappers";
import { mapDbToActivity } from "@/hooks/use-activities";
import { mapDbToFile } from "@/hooks/use-files";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { mapMaterialOrderRow } from "@/lib/map-material-order";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { normalizeDbQuoteAttachments } from "@/lib/quote-attachments";
import { parseQuoteDeliveryMethod } from "@/lib/quote-delivery-method";

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

export function useJobRelatedData(jobId: string | undefined) {
  const enabled = !!jobId;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const role = user?.role ?? null;
  const realtimeInstanceRef = useRef(`job-items-live-instance-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!jobId) return;
    const channelName = `job-related-live:${jobId}:${realtimeInstanceRef.current}`;
    const invalidateJobScoped = () => {
      void queryClient.invalidateQueries({ queryKey: ["job-items", jobId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["job", jobId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["work-orders", jobId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["work-orders"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["activities", jobId], refetchType: "active" });
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_items",
          filter: `job_id=eq.${jobId}`,
        },
        invalidateJobScoped,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_orders",
          filter: `job_id=eq.${jobId}`,
        },
        invalidateJobScoped,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

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
      const list = (data ?? []).map((row) => mapDbToActivity(row as Parameters<typeof mapDbToActivity>[0]));
      if (role === "office") {
        return list.filter((a) => {
          const sk = (a.systemKey ?? "").toLowerCase();
          if (sk.startsWith("material-order-")) return false;
          const d = (a.description ?? "").toLowerCase();
          if (d.includes("prilog narudžbine materijala")) return false;
          if (d.includes("prilog narudzbine materijala")) return false;
          return true;
        });
      }
      return list;
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
      /** Ne birati `suppliers.nb_shipping_method` ovde — na starijim bazama kolona još ne postoji; na narudžbini je `material_orders.nb_shipping_method`. */
      const { data, error } = await supabase
        .from("material_orders")
        .select(`
          *,
          suppliers (id, name, contact_person, address, phone, email, bank_account, pib),
          jobs (id, job_number)
        `)
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((d) => {
        const jobData = Array.isArray(d.jobs) ? d.jobs[0] : d.jobs;
        return mapMaterialOrderRow(d as Record<string, unknown>, jobData as { id: string; job_number: string } | null | undefined);
      }) as MaterialOrder[];
    },
    enabled,
  });

  const workOrders = useQuery({
    queryKey: ["work-orders", jobId],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          *,
          teams (name),
          files (id, filename, storage_key, storage_url)
        `)
        .eq("job_id", jobId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data.map((d) => {
        const teamData = Array.isArray(d.teams) ? d.teams[0] : d.teams;
        const teamName =
          teamData && typeof teamData === "object" && teamData !== null && "name" in teamData
            ? String((teamData as { name?: string }).name ?? "").trim()
            : "";
        const fileEmbed = (d as { files?: { id?: string; filename?: string } | { id?: string; filename?: string }[] | null })
          .files;
        const fileRow = Array.isArray(fileEmbed) ? fileEmbed[0] : fileEmbed;
        const rawFid = (d as { file_id?: string | null }).file_id;
        const fileIdFromRow = typeof rawFid === "string" ? rawFid : undefined;
        const attachmentFileId = fileRow?.id ?? fileIdFromRow ?? undefined;
        const attachmentName =
          typeof fileRow?.filename === "string" && fileRow.filename.trim()
            ? fileRow.filename
            : attachmentFileId
              ? "Prilog"
              : undefined;
        return {
          id: d.id,
          jobId: d.job_id,
          type: d.type,
          description: d.description,
          measurementLocation: (d as { measurement_location?: string | null }).measurement_location ?? undefined,
          measurementScope: (d as { measurement_scope?: string | null }).measurement_scope ?? undefined,
          assignedTeamId: d.team_id,
          assignedTeamName: teamName || undefined,
          date: d.date,
          status: d.status,
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
          installationRef: (d as { installation_ref?: string | null }).installation_ref ?? undefined,
          productionRef: (d as { production_ref?: string | null }).production_ref ?? undefined,
          createdAt: (d as { created_at?: string }).created_at,
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
        ? "*, work_orders!field_reports_work_order_id_fkey!inner(id, team_id, type)"
        : "*, work_orders!field_reports_work_order_id_fkey!left(id, team_id, type)";

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
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      return rows.map((d) => {
        const woRaw = (d as { work_orders?: Record<string, unknown> | Record<string, unknown>[] | null })
          .work_orders;
        const woData = Array.isArray(woRaw) ? woRaw[0] : woRaw;
        const teamId =
          typeof woData?.team_id === "string" && woData.team_id.length > 0
            ? woData.team_id
            : undefined;
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
          id: d.id as string,
          jobId: d.job_id as string,
          address: typeof d.address === "string" ? (d.address as string) : "",
          arrived: d.arrived === true,
          arrivalDate: typeof d.arrival_datetime === "string" ? (d.arrival_datetime as string) : undefined,
          siteCanceled: !!d.site_canceled,
          cancelReason: typeof d.cancel_reason === "string" ? (d.cancel_reason as string) : undefined,
          jobCompleted: d.completed === true,
          everythingOk: fieldReportEverythingOkFromDbRow({
            everything_ok: d.everything_ok === true ? true : d.everything_ok === false ? false : null,
            issues: typeof d.issues === "string" ? (d.issues as string) : null,
            missing_items: Array.isArray(d.missing_items) ? (d.missing_items as string[]) : null,
          }),
          issueDescription: typeof d.issues === "string" ? (d.issues as string) : undefined,
          details: detailsParsed,
          estimatedInstallationHours: Number.isFinite(estNum) ? estNum : undefined,
          handoverDate: typeof d.handover_date === "string" ? (d.handover_date as string) : undefined,
          images: Array.isArray(d.images) ? (d.images as string[]) : [],
          missingItems: Array.isArray(d.missing_items) ? (d.missing_items as string[]) : [],
          additionalNeeds: Array.isArray(d.additional_needs) ? (d.additional_needs as string[]) : [],
          measurements: typeof d.measurements === "string" ? (d.measurements as string) : undefined,
          generalNotes: typeof d.general_report === "string" ? (d.general_report as string) : undefined,
          workOrderId: typeof d.work_order_id === "string" ? (d.work_order_id as string) : undefined,
          workOrderType: (woData?.type as WorkOrder["type"] | undefined) ?? undefined,
          teamId,
        };
      }) as FieldReport[];
    },
    enabled,
  });

  const files = useQuery({
    queryKey: ["files", jobId],
    queryFn: async () => {
      let q = supabase
        .from("files")
        .select(`
          *,
          users (name)
        `)
        .eq("job_id", jobId)
        .order("uploaded_at", { ascending: false });

      if (role === "office") {
        q = q.is("material_order_id", null);
      }

      const { data, error } = await q;

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToFile(row as Parameters<typeof mapDbToFile>[0]));
    },
    enabled: enabled && role !== "procurement",
  });

  const quotes = useQuery({
    queryKey: ["quotes", jobId],
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []).map((d) => {
        const fileAttachments = normalizeDbQuoteAttachments(
          (d as Record<string, unknown>).file_attachments,
          d.file_url,
          d.file_storage_key,
        );
        const primary = fileAttachments[0];
        return {
          id: d.id,
          jobId: d.job_id,
          quoteNumber: d.quote_number,
          versionNumber: Number(d.version_number) || 1,
          versionName:
            typeof (d as { version_name?: unknown }).version_name === "string"
              ? (d as { version_name: string }).version_name.trim() || undefined
              : undefined,
          isFinalOffer:
            d.is_final === true ||
            (typeof d.note === "string" && d.note.trim().toLowerCase().startsWith("[final]")),
          pricesIncludeVat: d.prices_include_vat !== false,
          vatRatePercent: Number((d as { vat_rate_percent?: unknown }).vat_rate_percent) === 20 ? 20 : 0,
          status: d.status,
          deliveryMethod: parseQuoteDeliveryMethod((d as Record<string, unknown>).delivery_method),
          totalAmount: Number(d.total_amount) || 0,
          note: d.note ?? undefined,
          fileAttachments,
          fileUrl: primary?.url ?? d.file_url ?? undefined,
          fileStorageKey: primary?.storageKey ?? d.file_storage_key ?? undefined,
          createdBy: d.created_by ?? undefined,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          lines: [],
        };
      })
      ) as Quote[];
    },
    enabled,
  });

  const jobItems = useQuery({
    queryKey: ["job-items", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_items")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.id,
        jobId: d.job_id,
        profileCode: d.profile_code ?? "",
        profileTitle: d.profile_title ?? "",
        color: d.color ?? "",
        cutLength: Number(d.cut_length) || 0,
        quantity: Number(d.quantity) || 0,
        barcode: d.barcode ?? "",
        isCompleted: d.is_completed === true,
        completedAt: d.completed_at ?? undefined,
        metadata:
          d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata)
            ? d.metadata
            : {},
      })) as JobItem[];
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
      try {
        await recomputeJobStatus(newPayment.jobId, user?.id ?? null);
      } catch (err) {
        console.warn("Auto status recompute failed after payment:", err);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Uplata je uspešno evidentirana");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri evidentiranju uplate", { description: getErrorMessage(err) });
    },
  });

  const updatePayment = useMutation({
    mutationFn: async (updated: Payment) => {
      const { error } = await supabase
        .from("payments")
        .update({
          amount: updated.amount,
          date: updated.date,
          vat_included: updated.includesVat,
          note: updated.note?.trim() || null,
        })
        .eq("id", updated.id);

      if (error) throw error;
      await upsertSystemActivity({
        jobId: updated.jobId,
        description: `Izmenjena uplata: ${Number(updated.amount) || 0}`,
        systemKey: `payment-updated:${updated.id}`,
        type: "in_person",
        authorId: user?.id ?? null,
      });
      try {
        await recomputeJobStatus(updated.jobId, user?.id ?? null);
      } catch (err) {
        console.warn("Auto status recompute failed after payment update:", err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments", jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Uplata je izmenjena");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri izmeni uplate", { description: getErrorMessage(err) });
    },
  });

  return {
    activities: activities.data || [],
    payments: payments.data || [],
    materialOrders: materialOrders.data || [],
    workOrders: workOrders.data || [],
    fieldReports: fieldReports.data || [],
    files: files.data || [],
    quotes: quotes.data || [],
    jobItems: jobItems.data || [],
    recordPayment,
    updatePayment,
    isLoading:
      activities.isLoading ||
      payments.isLoading ||
      materialOrders.isLoading ||
      workOrders.isLoading ||
      fieldReports.isLoading ||
      files.isLoading ||
      quotes.isLoading ||
      jobItems.isLoading,
  };
}
