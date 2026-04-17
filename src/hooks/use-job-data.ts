import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Payment, MaterialOrder, WorkOrder, FieldReport } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { mapDbToActivity } from "@/hooks/use-activities";
import { mapDbToFile } from "@/hooks/use-files";
import {
  isMontazaRole,
  isTerenRole,
  TEREN_WORK_ORDER_TYPES,
} from "@/lib/field-team-access";
import { upsertSystemActivity } from "@/lib/activity-automation";

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
          suppliers (id, name, contact_person)
        `)
        .eq("job_id", jobId)
        .order("request_date", { ascending: false });

      if (error) throw error;
      return data.map(d => {
        const supplierData = Array.isArray(d.suppliers) ? d.suppliers[0] : d.suppliers;
        return {
          id: d.id,
          jobId: d.job_id,
          materialType: d.material_type,
          supplierId: d.supplier_id || "",
          supplier: supplierData?.name || d.supplier,
          supplierContact: supplierData?.contact_person || d.supplier_contact,
          orderDate: d.request_date,
          requestDate: d.request_date,
          expectedDelivery: d.expected_delivery_date || d.delivery_date,
          deliveryDate: d.delivery_date,
          supplierPrice: d.supplier_price,
          price: d.supplier_price,
          paid: d.paid,
          barcode: d.barcode,
          deliveryStatus: d.delivery_status,
          quantityVerified: d.delivered_ok,
          deliveryVerified: d.delivered_ok,
          allDelivered: d.delivery_status === "delivered",
          requestFile: d.request_file,
          quoteFile: d.quote_file,
          notes: d.notes,
        };
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
        return {
          id: d.id,
          jobId: d.job_id,
          type: d.type,
          description: d.description,
          assignedTeamId: d.team_id,
          date: d.date,
          status: d.status,
        };
      }) as WorkOrder[];
    },
    enabled,
  });

  const fieldReports = useQuery({
    queryKey: ["field-reports", jobId, user?.id, user?.role],
    queryFn: async () => {
      const isMontaza = isMontazaRole(user?.role);
      const isTeren = isTerenRole(user?.role);
      const isFieldScoped = isMontaza || isTeren;
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
        if (isMontaza) {
          query = query.eq("work_orders.type", "installation");
        } else if (isTeren) {
          query = query.in("work_orders.type", [...TEREN_WORK_ORDER_TYPES]);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      return data.map(d => {
        const woData = d.work_orders;
        return {
          id: d.id,
          jobId: d.job_id,
          address: d.address,
          arrived: d.arrived,
          arrivalDate: d.arrival_datetime,
          siteCanceled: d.site_canceled,
          cancelReason: d.cancel_reason,
          jobCompleted: d.completed,
          everythingOk: d.everything_ok,
          issueDescription: d.issues,
          handoverDate: d.handover_date,
          images: d.images || [],
          missingItems: d.missing_items || [],
          additionalNeeds: [],
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
