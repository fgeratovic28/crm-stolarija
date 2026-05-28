import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  PROCUREMENT_COMPLAINT_ACTIVE_STATUSES,
  type ProcurementComplaintStatus,
} from "@/lib/procurement-complaint-status";
import { URGENT_SITE_MISSING_QUERY_KEY } from "@/hooks/use-urgent-site-missing-notifications";

export type ProcurementComplaintWithOrder = {
  id: string;
  order_id: string;
  item_details: Record<string, unknown>;
  photo_evidence_urls: string[];
  status: ProcurementComplaintStatus | string;
  reported_by: string | null;
  created_at: string;
  supplier: string | null;
  barcode: string | null;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message?: unknown }).message);
  return "Nepoznata greška";
}

/** Reklamacije koje treba pratiti na dashboardu (hitno + čeka dobavljača). */
export function useActiveProcurementComplaints(enabled: boolean) {
  return useQuery({
    queryKey: ["procurement-complaints", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procurement_complaints")
        .select(`
          id,
          order_id,
          item_details,
          photo_evidence_urls,
          status,
          reported_by,
          created_at,
          barcode,
          material_orders!inner(supplier)
        `)
        .in("status", PROCUREMENT_COMPLAINT_ACTIVE_STATUSES)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        order_id: row.order_id as string,
        item_details: (row.item_details as Record<string, unknown>) ?? {},
        photo_evidence_urls: (row.photo_evidence_urls as string[]) ?? [],
        status: row.status as string,
        reported_by: row.reported_by as string | null,
        created_at: row.created_at as string,
        barcode: (row.barcode as string | null) ?? null,
        supplier: ((row.material_orders as Record<string, unknown> | null)?.supplier as string | null) ?? null,
      })) as ProcurementComplaintWithOrder[];
    },
    enabled,
  });
}

/** Fetches all complaints (active + resolved) for specific material orders, with supplier info. */
export function useProcurementComplaintsForOrderIds(orderIds: string[], enabled: boolean = true) {
  return useQuery({
    queryKey: ["procurement-complaints", "for-orders", orderIds],
    queryFn: async () => {
      if (orderIds.length === 0) return [] as ProcurementComplaintWithOrder[];
      const { data, error } = await supabase
        .from("procurement_complaints")
        .select(`
          id,
          order_id,
          item_details,
          photo_evidence_urls,
          status,
          reported_by,
          created_at,
          barcode,
          material_orders!inner(supplier)
        `)
        .in("order_id", orderIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        order_id: row.order_id as string,
        item_details: (row.item_details as Record<string, unknown>) ?? {},
        photo_evidence_urls: (row.photo_evidence_urls as string[]) ?? [],
        status: row.status as string,
        reported_by: row.reported_by as string | null,
        created_at: row.created_at as string,
        barcode: (row.barcode as string | null) ?? null,
        supplier: ((row.material_orders as Record<string, unknown> | null)?.supplier as string | null) ?? null,
      })) as ProcurementComplaintWithOrder[];
    },
    enabled: enabled && orderIds.length > 0,
  });
}

/** Fetches all complaints for a specific material order. */
export function useProcurementComplaintsByOrderId(orderId: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["procurement-complaints", "by-order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procurement_complaints")
        .select(`
          id,
          order_id,
          item_details,
          photo_evidence_urls,
          status,
          reported_by,
          created_at,
          barcode,
          material_orders!inner(supplier)
        `)
        .eq("order_id", orderId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        order_id: row.order_id as string,
        item_details: (row.item_details as Record<string, unknown>) ?? {},
        photo_evidence_urls: (row.photo_evidence_urls as string[]) ?? [],
        status: row.status as string,
        reported_by: row.reported_by as string | null,
        created_at: row.created_at as string,
        barcode: (row.barcode as string | null) ?? null,
        supplier: ((row.material_orders as Record<string, unknown> | null)?.supplier as string | null) ?? null,
      })) as ProcurementComplaintWithOrder[];
    },
    enabled: enabled && !!orderId,
  });
}

export function useUpdateProcurementComplaintStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { complaintId: string; status: ProcurementComplaintStatus }) => {
      const { data, error } = await supabase.rpc("update_procurement_complaint_status", {
        p_complaint_id: args.complaintId,
        p_status: args.status,
      });
      if (error) throw error;
      if (data !== true) throw new Error("Reklamacija nije pronađena.");
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["procurement-complaints"] }),
        queryClient.invalidateQueries({ queryKey: ["material-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["job"] }),
      ]);
      toast.success("Status reklamacije je ažuriran.");
    },
    onError: (e) => {
      toast.error(getErrorMessage(e));
    },
  });
}

export type ReceiveProcurementBarcodeResult = {
  kind: "complaint" | "ad_hoc";
  id: string;
  order_id: string;
  already_resolved: boolean;
};

/**
 * Magacin: skener barkoda za reklamacije (C…) i vanredne stavke (A…).
 * Vraća tip stavke + da li je već bila označena kao primljena pre ovog skena.
 */
export function useReceiveProcurementBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (barcode: string): Promise<ReceiveProcurementBarcodeResult> => {
      const { data, error } = await supabase.rpc("receive_procurement_barcode", {
        p_barcode: barcode,
      });
      if (error) throw error;
      const obj = (data ?? null) as ReceiveProcurementBarcodeResult | null;
      if (!obj || typeof obj !== "object" || !obj.kind) {
        throw new Error("Barkod nije pronađen.");
      }
      return obj;
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["procurement-complaints"] }),
        queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] }),
        queryClient.invalidateQueries({ queryKey: ["material-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["material-order", data.order_id] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["job"] }),
        queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
      ]);
    },
  });
}
