import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MaterialOrder } from "@/types";
import { toast } from "sonner";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelDeliveryStatus, labelMaterialType } from "@/lib/activity-labels";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { mapMaterialOrderRow } from "@/lib/map-material-order";

type JobLite = { id: string; job_number: string };

function toNullableDate(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function materialOrderNbDbColumns(o: Partial<MaterialOrder>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (o.nbLines !== undefined && o.nbLines.length > 0) {
    row.nb_lines = o.nbLines.map((l) => ({
      description: (l.description ?? "").trim() || "—",
      quantity: l.quantity,
      unit: (l.unit ?? "kom").trim() || "kom",
      lineNet: roundMoney(Number(l.lineNet) || 0),
      ...(l.materialType ? { materialType: l.materialType } : {}),
    }));
    const first = o.nbLines[0];
    row.nb_line_description = (first.description ?? "").trim() || null;
    row.nb_quantity = first.quantity;
    row.nb_unit = (first.unit ?? "kom").toString().trim() || "kom";
  } else {
    if (o.nbLineDescription !== undefined) {
      row.nb_line_description = o.nbLineDescription?.trim() || null;
    }
    if (o.nbQuantity !== undefined && o.nbQuantity !== null && Number.isFinite(o.nbQuantity)) {
      row.nb_quantity = o.nbQuantity;
    }
    if (o.nbUnit !== undefined) {
      const u = o.nbUnit?.trim();
      row.nb_unit = u && u.length > 0 ? u : "kom";
    }
  }
  if (o.nbVatRatePercent !== undefined && o.nbVatRatePercent !== null && Number.isFinite(o.nbVatRatePercent)) {
    row.nb_vat_rate_percent = o.nbVatRatePercent;
  }
  if (o.nbBuyerBankAccount !== undefined) {
    row.nb_buyer_bank_account = o.nbBuyerBankAccount?.trim() || null;
  }
  if (o.nbShippingMethod !== undefined) {
    row.nb_shipping_method = o.nbShippingMethod?.trim() || null;
  }
  if (o.nbPaymentDueDate !== undefined) {
    row.nb_payment_due_date = toNullableDate(o.nbPaymentDueDate);
  }
  if (o.nbPaymentNote !== undefined) {
    row.nb_payment_note = o.nbPaymentNote?.trim() || null;
  }
  if (o.nbLegalReference !== undefined) {
    row.nb_legal_reference = o.nbLegalReference?.trim() || null;
  }
  if (o.nbDeliveryAddressOverride !== undefined) {
    row.nb_delivery_address_override = o.nbDeliveryAddressOverride?.trim() || null;
  }
  return row;
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
          suppliers (id, name, contact_person, address),
          jobs (id, job_number)
        `)
        .order("request_date", { ascending: false });

      if (jobId) {
        query = query.eq("job_id", jobId);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      return data.map((d) => {
        const jobData = Array.isArray(d.jobs) ? d.jobs[0] : d.jobs;
        return mapMaterialOrderRow(d as Record<string, unknown>, jobData as JobLite | null | undefined);
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
          ...materialOrderNbDbColumns(newOrder),
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
          ...materialOrderNbDbColumns(updatedOrder),
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
