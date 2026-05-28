import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  PROCUREMENT_AD_HOC_ACTIVE_STATUSES,
  PROCUREMENT_AD_HOC_STATUS,
  type ProcurementAdHocStatus,
} from "@/lib/procurement-ad-hoc-status";
import { URGENT_SITE_MISSING_QUERY_KEY, type UrgentSiteMissingRow } from "@/hooks/use-urgent-site-missing-notifications";

export type ProcurementAdHocItem = {
  id: string;
  orderId: string;
  description: string;
  articleCode: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  attachmentFileId: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  barcode: string;
  status: ProcurementAdHocStatus | string;
  /** Hitni triage / interni zahtev: gotov proizvod vs sirovine (podrazumevano sirovine). */
  vrstaStavke?: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** Naziv dobavljača (preuzeto preko `material_orders` joina) — opciono za globalne liste. */
  supplier?: string | null;
  /** Opciona nabavna polja (paritetno sa material_orders.nb_lines.procurementMeta). */
  workOrder: string | null;
  position: string | null;
  color: string | null;
  lengthMm: number | null;
};

type AdHocRow = {
  id: string;
  order_id: string;
  description: string;
  article_code: string | null;
  quantity: number | string;
  unit: string | null;
  notes: string | null;
  attachment_file_id: string | null;
  barcode: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  work_order: string | null;
  position: string | null;
  color: string | null;
  length_mm: number | string | null;
  vrsta_stavke?: string | null;
  files: { id: string; filename: string; storage_url: string | null } | { id: string; filename: string; storage_url: string | null }[] | null;
  material_orders?: { supplier: string | null } | { supplier: string | null }[] | null;
};

function mapRow(row: AdHocRow): ProcurementAdHocItem {
  const fileRaw = Array.isArray(row.files) ? row.files[0] : row.files;
  const supplierRaw = Array.isArray(row.material_orders) ? row.material_orders[0] : row.material_orders;
  const lenNum =
    row.length_mm == null
      ? null
      : (() => {
          const n = Number(row.length_mm);
          return Number.isFinite(n) ? n : null;
        })();
  return {
    id: row.id,
    orderId: row.order_id,
    description: row.description ?? "",
    articleCode: row.article_code,
    quantity: Number(row.quantity) || 0,
    unit: (row.unit ?? "kom").trim() || "kom",
    notes: row.notes,
    attachmentFileId: row.attachment_file_id,
    attachmentName: fileRaw?.filename ?? null,
    attachmentUrl: fileRaw?.storage_url ?? null,
    barcode: row.barcode,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    supplier: supplierRaw?.supplier ?? null,
    workOrder: row.work_order,
    position: row.position,
    color: row.color,
    lengthMm: lenNum,
    vrstaStavke: row.vrsta_stavke ?? null,
  };
}

const AD_HOC_SELECT_COLUMNS = `
  id, order_id, description, article_code, quantity, unit, notes,
  attachment_file_id, barcode, status, created_at, resolved_at,
  work_order, position, color, length_mm, vrsta_stavke,
  files:attachment_file_id ( id, filename, storage_url )
` as const;

/** Aktivni statusi ad-hoc stavki (čekaju da se naruče ili stigne isporuka).
 *  Terminalni: `received`, `canceled`. */
const PENDING_AD_HOC_STATUSES = PROCUREMENT_AD_HOC_ACTIVE_STATUSES;

/**
 * Globalna lista nerešenih vanrednih stavki za dashboard upozorenje / izveštaj.
 * Vraća stavke u statusu `needs_order` ili `ordered` sa nazivom dobavljača.
 */
export function useActivePendingProcurementAdHocItems(enabled: boolean) {
  return useQuery({
    queryKey: ["procurement-ad-hoc-items", "active-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procurement_ad_hoc_items")
        .select(`
          ${AD_HOC_SELECT_COLUMNS},
          material_orders!inner ( supplier )
        `)
        .in("status", PENDING_AD_HOC_STATUSES as unknown as string[])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => mapRow(r as unknown as AdHocRow));
    },
    enabled,
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message?: unknown }).message ?? "Nepoznata greška");
  }
  return "Nepoznata greška";
}

export function useProcurementAdHocItemsForOrder(orderId: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["procurement-ad-hoc-items", "by-order", orderId ?? ""],
    queryFn: async () => {
      if (!orderId) return [] as ProcurementAdHocItem[];
      const { data, error } = await supabase
        .from("procurement_ad_hoc_items")
        .select(AD_HOC_SELECT_COLUMNS)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => mapRow(r as unknown as AdHocRow));
    },
    enabled: enabled && Boolean(orderId),
  });
}

export function useProcurementAdHocItemsForOrderIds(orderIds: string[], enabled: boolean = true) {
  const cacheKey = [...new Set(orderIds.filter(Boolean))].sort().join(",");
  return useQuery({
    queryKey: ["procurement-ad-hoc-items", "by-orders", cacheKey],
    queryFn: async () => {
      const ids = [...new Set(orderIds.filter(Boolean))];
      if (ids.length === 0) return {} as Record<string, ProcurementAdHocItem[]>;
      const { data, error } = await supabase
        .from("procurement_ad_hoc_items")
        .select(AD_HOC_SELECT_COLUMNS)
        .in("order_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const grouped: Record<string, ProcurementAdHocItem[]> = {};
      for (const row of data ?? []) {
        const mapped = mapRow(row as unknown as AdHocRow);
        if (!grouped[mapped.orderId]) grouped[mapped.orderId] = [];
        grouped[mapped.orderId].push(mapped);
      }
      return grouped;
    },
    enabled: enabled && orderIds.filter(Boolean).length > 0,
  });
}

export function useCreateProcurementAdHocItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      orderId: string;
      description: string;
      articleCode?: string;
      quantity: number;
      unit?: string;
      notes?: string;
      attachmentFileId?: string | null;
      workOrder?: string | null;
      position?: string | null;
      color?: string | null;
      lengthMm?: number | null;
      /** Podrazumevano sirovine (isto kao u bazi). */
      vrstaStavke?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_procurement_ad_hoc_item", {
        p_order_id: args.orderId,
        p_description: args.description,
        p_article_code: args.articleCode ?? null,
        p_quantity: args.quantity,
        p_unit: args.unit ?? "kom",
        p_notes: args.notes ?? null,
        p_attachment_file_id: args.attachmentFileId ?? null,
        p_work_order: args.workOrder ?? null,
        p_position: args.position ?? null,
        p_color: args.color ?? null,
        p_length_mm: args.lengthMm ?? null,
        p_vrsta_stavke: args.vrstaStavke ?? "sirovine_za_proizvodnju",
      });
      if (error) throw error;
      return data as AdHocRow;
    },
    onSuccess: (data) => {
      const oid = data?.order_id;
      queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      if (oid) {
        queryClient.invalidateQueries({ queryKey: ["material-order", oid] });
      }
      toast.success("Vanredna stavka je dodata sa barkodom.");
    },
    onError: (err) => {
      toast.error(`Greška pri dodavanju vanredne stavke: ${getErrorMessage(err)}`);
    },
  });
}

export function useUpdateProcurementAdHocItemStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: ProcurementAdHocStatus }) => {
      const isTerminal =
        args.status === PROCUREMENT_AD_HOC_STATUS.RECEIVED ||
        args.status === PROCUREMENT_AD_HOC_STATUS.CANCELED;
      const updates: Record<string, unknown> = {
        status: args.status,
        resolved_at: isTerminal ? new Date().toISOString() : null,
      };
      const { error } = await supabase
        .from("procurement_ad_hoc_items")
        .update(updates)
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: (_void, args) => {
      if (
        args.status === PROCUREMENT_AD_HOC_STATUS.RECEIVED ||
        args.status === PROCUREMENT_AD_HOC_STATUS.ORDERED
      ) {
        queryClient.setQueriesData<UrgentSiteMissingRow[] | undefined>(
          { queryKey: URGENT_SITE_MISSING_QUERY_KEY },
          (old) => {
            if (!old) return old;
            return old.flatMap((row) => {
              const t = row.procurementTriage;
              if (!t || t.adHocItemId !== args.id) return [row];
              if (args.status === PROCUREMENT_AD_HOC_STATUS.RECEIVED && t.vrstaStavke === "gotov_proizvod") {
                return [];
              }
              if (args.status === PROCUREMENT_AD_HOC_STATUS.RECEIVED) {
                return [
                  {
                    ...row,
                    procurementTriage: {
                      ...t,
                      adHocStatus: PROCUREMENT_AD_HOC_STATUS.RECEIVED,
                      awaitingProduction: t.vrstaStavke === "sirovine_za_proizvodnju",
                    },
                  },
                ];
              }
              return [
                {
                  ...row,
                  procurementTriage: {
                    ...t,
                    adHocStatus: args.status,
                    awaitingProduction: false,
                  },
                },
              ];
            });
          },
        );
      }

      void queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Status vanredne stavke je ažuriran.");
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });
}

export function useDeleteProcurementAdHocItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("procurement_ad_hoc_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      toast.success("Vanredna stavka je obrisana.");
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });
}
