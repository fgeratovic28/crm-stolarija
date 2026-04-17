import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MaterialOrder } from "@/types";
import { toast } from "sonner";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelDeliveryStatus, labelMaterialType } from "@/lib/activity-labels";
import { recomputeJobStatus } from "@/lib/job-status-automation";

type SupplierLite = { name?: string; contact_person?: string };
type JobLite = { id: string; job_number: string };

function toNullableDate(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const maybePostgrest = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof maybePostgrest.message === "string" ? maybePostgrest.message : "";
    const details = typeof maybePostgrest.details === "string" ? maybePostgrest.details : "";
    const hint = typeof maybePostgrest.hint === "string" ? maybePostgrest.hint : "";
    const code = typeof maybePostgrest.code === "string" ? maybePostgrest.code : "";
    const parts = [message, details, hint, code ? `(${code})` : ""].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  return "Došlo je do neočekivane greške.";
}

export function useMaterialOrders(jobId?: string) {
  const queryClient = useQueryClient();

  const runStatusAutomation = async (targetJobId?: string) => {
    if (!targetJobId) return;
    try {
      await recomputeJobStatus(targetJobId);
    } catch (err) {
      console.warn("Auto status recompute failed after material order change:", err);
    }
  };

  const { data: orders, isLoading } = useQuery({
    queryKey: jobId ? ["material-orders", jobId] : ["material-orders"],
    queryFn: async () => {
      let query = supabase
        .from("material_orders")
        .select(`
          *,
          suppliers (id, name, contact_person),
          jobs (id, job_number)
        `)
        .order("request_date", { ascending: false });

      if (jobId) {
        query = query.eq("job_id", jobId);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      return data.map(d => {
        const supplierData = Array.isArray(d.suppliers) ? d.suppliers[0] : d.suppliers;
        const jobData = Array.isArray(d.jobs) ? d.jobs[0] : d.jobs;
        return {
          id: d.id,
          jobId: d.job_id,
          materialType: d.material_type,
          supplierId: d.supplier_id,
          supplier: (supplierData as SupplierLite | null | undefined)?.name || d.supplier,
          supplierContact: (supplierData as SupplierLite | null | undefined)?.contact_person || d.supplier_contact,
          orderDate: d.request_date,
          requestDate: d.request_date,
          deliveryDate: d.delivery_date,
          expectedDelivery: d.expected_delivery_date || d.delivery_date,
          price: d.supplier_price,
          supplierPrice: d.supplier_price,
          paid: d.paid,
          barcode: d.barcode,
          deliveryStatus: d.delivery_status,
          deliveryVerified: d.delivered_ok,
          quantityVerified: d.delivered_ok,
          allDelivered: d.delivery_status === "delivered",
          requestFile: d.request_file,
          quoteFile: d.quote_file,
          notes: d.notes,
          job: jobData ? {
            id: (jobData as JobLite).id,
            jobNumber: (jobData as JobLite).job_number
          } : undefined
        };
      }) as MaterialOrder[];
    },
  });

  const createOrder = useMutation({
    mutationFn: async (newOrder: Omit<MaterialOrder, "id">) => {
      const { data, error } = await supabase
        .from("material_orders")
        .insert([{
          job_id: newOrder.jobId || null,
          material_type: newOrder.materialType,
          supplier_id: newOrder.supplierId,
          supplier: newOrder.supplier,
          supplier_contact: newOrder.supplierContact,
          request_date: toNullableDate(newOrder.requestDate) || new Date().toISOString().split("T")[0],
          delivery_date: toNullableDate(newOrder.deliveryDate),
          expected_delivery_date: toNullableDate(newOrder.expectedDelivery),
          supplier_price: newOrder.price,
          paid: newOrder.paid,
          barcode: newOrder.barcode,
          delivery_status: newOrder.deliveryStatus,
          delivered_ok: newOrder.deliveryVerified,
          request_file: newOrder.requestFile,
          quote_file: newOrder.quoteFile,
          notes: newOrder.notes,
        }])
        .select()
        .single();

      if (error) throw error;
      if (newOrder.jobId) {
        await upsertSystemActivity({
          jobId: newOrder.jobId,
          description: `Kreirana narudžbina materijala: ${labelMaterialType(newOrder.materialType)}`,
          systemKey: `material-order-created:${data.id}`,
        });
        await runStatusAutomation(newOrder.jobId);
      }
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Narudžbina uspešno kreirana");
    },
    onError: (error) => {
      toast.error(`Greška pri kreiranju narudžbine: ${getErrorMessage(error)}`);
    },
  });

  const updateOrder = useMutation({
    mutationFn: async (updatedOrder: MaterialOrder) => {
      const prev = await supabase
        .from("material_orders")
        .select("delivery_status")
        .eq("id", updatedOrder.id)
        .single();
      if (prev.error) throw prev.error;
      const previousDeliveryStatus = prev.data?.delivery_status as string | undefined;

      const { error } = await supabase
        .from("material_orders")
        .update({
          material_type: updatedOrder.materialType,
          supplier_id: updatedOrder.supplierId,
          supplier: updatedOrder.supplier,
          supplier_contact: updatedOrder.supplierContact,
          request_date: toNullableDate(updatedOrder.requestDate),
          delivery_date: toNullableDate(updatedOrder.deliveryDate),
          expected_delivery_date: toNullableDate(updatedOrder.expectedDelivery),
          supplier_price: updatedOrder.price,
          paid: updatedOrder.paid,
          barcode: updatedOrder.barcode,
          delivery_status: updatedOrder.deliveryStatus,
          delivered_ok: updatedOrder.deliveryVerified,
          request_file: updatedOrder.requestFile,
          quote_file: updatedOrder.quoteFile,
          notes: updatedOrder.notes,
        })
        .eq("id", updatedOrder.id);

      if (error) throw error;
      if (
        updatedOrder.jobId &&
        previousDeliveryStatus &&
        previousDeliveryStatus !== updatedOrder.deliveryStatus
      ) {
        await upsertSystemActivity({
          jobId: updatedOrder.jobId,
          description: `Isporuka materijala: ${labelDeliveryStatus(previousDeliveryStatus as MaterialOrder["deliveryStatus"])} -> ${labelDeliveryStatus(updatedOrder.deliveryStatus)}`,
          systemKey: `material-order-delivery:${updatedOrder.id}:${previousDeliveryStatus}:${updatedOrder.deliveryStatus}`,
        });
      }
      await runStatusAutomation(updatedOrder.jobId);
      return updatedOrder;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Narudžbina ažurirana");
    },
    onError: (error) => {
      toast.error(`Greška pri ažuriranju narudžbine: ${getErrorMessage(error)}`);
    },
  });

  const deleteOrder = useMutation({
    mutationFn: async (id: string) => {
      const before = await supabase.from("material_orders").select("job_id").eq("id", id).single();
      if (before.error) throw before.error;
      const { error } = await supabase.from("material_orders").delete().eq("id", id);
      if (error) throw error;
      await runStatusAutomation((before.data?.job_id as string | undefined) ?? undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Narudžbina obrisana");
    },
    onError: (error) => {
      toast.error(`Greška pri brisanju narudžbine: ${getErrorMessage(error)}`);
    },
  });

  return {
    orders,
    isLoading,
    createOrder,
    updateOrder,
    deleteOrder,
  };
}
