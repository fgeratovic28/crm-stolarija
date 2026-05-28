import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MaterialOrder, MaterialType } from "@/types";
import { toast } from "sonner";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelDeliveryStatus, labelMaterialType } from "@/lib/activity-labels";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { mapMaterialOrderRow } from "@/lib/map-material-order";
import { parseNbLinesJson, procurementMetaForNbLinesJson, sumOrderLinesNet } from "@/lib/material-order-lines";
import type {
  FinalizeProcurementReceptionLineRpc,
  FinalizeProcurementReceptionResult,
} from "@/lib/finalize-procurement-reception-rpc";
import { PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUS_VALUES } from "@/lib/material-reception-candidates";
import { useAuthStore } from "@/stores/auth-store";

/** Map supplier category (Profili, Staklo, Okov, Roletne/Kupovno, Ostalo ili eng. slug kao MaterialType) na MaterialType. */
function mapCategoryToMaterialType(category?: string | null): MaterialType {
  const c = String(category ?? "").trim();
  if (!c) return "other";
  switch (c) {
    case "Profili":
      return "profile";
    case "Staklo":
      return "glass";
    case "Okov":
      return "hardware";
    case "Roletne/Kupovno":
    case "Ostalo":
      return "other";
    default:
      break;
  }
  switch (c.toLowerCase()) {
    case "profile":
      return "profile";
    case "glass":
      return "glass";
    case "hardware":
      return "hardware";
    case "shutters":
      return "shutters";
    case "mosquito_net":
      return "mosquito_net";
    case "sills":
      return "sills";
    case "boards":
      return "boards";
    case "sealant":
      return "sealant";
    case "other":
      return "other";
    default:
      return "other";
  }
}

type JobLite = {
  id: string;
  job_number: string;
  customers?: { name?: string } | { name?: string }[] | null;
};
export type QuickMaterialOrderItemInput = {
  supplierId: string;
  itemCode?: string;
  itemName: string;
  quantity: number;
  unit: string;
  cutLength?: number;
  totalLength?: number;
  unitPrice?: number;
  note?: string;
  sourceJobItemIds?: string[];
};

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
  const nb = o.nbLines;
  if (Array.isArray(nb) && nb.length > 0) {
    row.nb_lines = nb.map((l) => ({
      description: (l.description ?? "").trim() || "—",
      quantity: l.quantity,
      unit: (l.unit ?? "kom").trim() || "kom",
      lineNet: roundMoney(Number(l.lineNet) || 0),
      ...(l.materialType ? { materialType: l.materialType } : {}),
      ...(l.procurementMeta?.article?.trim() || l.procurementMeta?.article_code?.trim()
        ? { procurementMeta: procurementMetaForNbLinesJson(l.procurementMeta) }
        : {}),
      ...(Array.isArray(l.sourceJobItemIds) && l.sourceJobItemIds.length > 0
        ? { sourceJobItemIds: l.sourceJobItemIds }
        : {}),
      ...(l.orderedQuantity != null && Number.isFinite(l.orderedQuantity)
        ? { orderedQuantity: l.orderedQuantity }
        : {}),
    }));
    const first = nb[0];
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
  if (o.itemsJson !== undefined) {
    row.items_json = o.itemsJson === null ? null : o.itemsJson;
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
  const userRole = useAuthStore((s) => s.user?.role);

  const runStatusAutomation = async (targetJobId?: string) => {
    if (!targetJobId) return;
    try {
      await recomputeJobStatus(targetJobId);
    } catch (err) {
      console.warn("Auto status recompute failed after material order change:", err);
    }
  };

  const { data: orders, isLoading, error: ordersError } = useQuery({
    queryKey: jobId
      ? ["material-orders", jobId]
      : userRole === "production"
        ? ["material-orders", "production-reception"]
        : ["material-orders"],
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      let query = supabase
        .from("material_orders")
        .select(`
          *,
          suppliers (id, name, contact_person, address, phone, email, bank_account, pib, category),
          jobs (id, job_number, customers (name))
        `)
        .order("created_at", { ascending: false });

      if (jobId) {
        query = query.eq("job_id", jobId);
      } else if (userRole === "production") {
        query = query.or(
          `delivery_status.in.(${PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUS_VALUES.join(",")}),and(is_shortage_order.eq.true,delivery_status.neq.materials_received)`,
        );
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
          required_for_production_start: newOrder.requiredForProductionStart === true,
          supplier_id: newOrder.supplierId,
          supplier: newOrder.supplier,
          supplier_contact: newOrder.supplierContact,
          request_date: toNullableDate(newOrder.requestDate) || new Date().toISOString().split("T")[0],
          delivery_date: toNullableDate(newOrder.deliveryDate),
          expected_delivery_date: toNullableDate(newOrder.expectedDelivery),
          supplier_price: newOrder.price,
          paid: newOrder.paid,
          payment_status: newOrder.paymentStatus ?? "pending",
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

  const createQuickOrders = useMutation({
    mutationFn: async ({
      jobId: targetJobId,
      items,
      expectedDelivery,
    }: {
      jobId: string;
      items: QuickMaterialOrderItemInput[];
      /** Jedan rok za sve porudžbine iz ovog koraka (npr. iz taba Krojna lista i nabavka). */
      expectedDelivery?: string;
    }) => {
      if (items.length === 0) return [];

      const supplierIds = Array.from(new Set(items.map((item) => item.supplierId).filter(Boolean)));
      const { data: supplierRows, error: supplierError } = await supabase
         .from("suppliers")
        .select("id,name,contact_person,phone,category")
         .in("id", supplierIds);
       if (supplierError) throw supplierError;

       const supplierMap = new Map(
         (supplierRows ?? []).map((row) => [
           row.id as string,
           {
             name: (row.name as string) ?? "",
             contact: (row.contact_person as string) || (row.phone as string) || "",
             category: row.category as string | null | undefined,
           },
         ]),
       );

      const grouped = items.reduce<Record<string, QuickMaterialOrderItemInput[]>>((acc, item) => {
        if (!acc[item.supplierId]) acc[item.supplierId] = [];
        acc[item.supplierId].push(item);
        return acc;
      }, {});

      const today = new Date().toISOString().split("T")[0];
      const createdOrders: Array<{ id: string; supplier: string }> = [];
      const { data: jobInfo } = await supabase
        .from("jobs")
        .select("job_number")
        .eq("id", targetJobId)
        .maybeSingle();
      const jobNumber = (jobInfo?.job_number as string | undefined) ?? "—";

      for (const [supplierId, supplierItems] of Object.entries(grouped)) {
        const supplier = supplierMap.get(supplierId);
        if (!supplier) {
          throw new Error("Izabrani dobavljač nije pronađen.");
        }

        const notes = supplierItems
          .filter((line) => line.note && line.note.trim().length > 0)
          .map((line) => `${line.itemName}: ${line.note?.trim()}`)
          .join(" | ");

        const mergedLinesMap = supplierItems.reduce<
          Record<
            string,
            {
              itemCode?: string;
              itemName: string;
              quantity: number;
              unit: string;
              totalLength: number;
              hasLength: boolean;
              /** Zbir (jedinična × količina) po redu iz nacrta — ispravno kad se više redova spoji u jednu stavku. */
              lineNetSum: number;
              sourceJobItemIds: string[];
            }
          >
        >((acc, line) => {
          const key = `${line.itemCode ?? ""}||${line.itemName}||${line.unit}`;
          const qty = Number(line.quantity) || 0;
          const unitP = Number(line.unitPrice);
          const contrib = unitP > 0 && qty > 0 ? roundMoney(unitP * qty) : 0;
          if (!acc[key]) {
            acc[key] = {
              itemCode: line.itemCode,
              itemName: line.itemName,
              quantity: 0,
              unit: line.unit,
              totalLength: 0,
              hasLength: false,
              lineNetSum: 0,
              sourceJobItemIds: [],
            };
          }
          acc[key].quantity += qty;
          acc[key].lineNetSum += contrib;
          const len = Number(line.cutLength);
          const directTotalLength = Number(line.totalLength);
          if (Number.isFinite(directTotalLength) && directTotalLength > 0) {
            acc[key].hasLength = true;
            acc[key].totalLength += directTotalLength;
          } else if (Number.isFinite(len) && len > 0) {
            acc[key].hasLength = true;
            acc[key].totalLength += len * line.quantity;
          }
          if (Array.isArray(line.sourceJobItemIds)) {
            acc[key].sourceJobItemIds.push(...line.sourceJobItemIds);
          }
          return acc;
        }, {});
        const mergedLines = Object.values(mergedLinesMap).map((m) => {
          const lineNet = roundMoney(m.lineNetSum);
          const unitPriceEff =
            m.quantity > 0 && lineNet > 0 ? roundMoney(lineNet / m.quantity) : 0;
          return { ...m, lineNet, unitPrice: unitPriceEff };
        });
        const orderTotalNet = roundMoney(mergedLines.reduce((s, line) => s + line.lineNet, 0));
        const expectedDate = toNullableDate(expectedDelivery);

        const resolvedMaterialType = mapCategoryToMaterialType(supplier.category);

        const { data, error } = await supabase
          .from("material_orders")
          .insert([
            {
              job_id: targetJobId,
              material_type: resolvedMaterialType,
              supplier_id: supplierId,
              supplier: supplier.name,
              supplier_contact: supplier.contact,
              request_date: today,
              expected_delivery_date: expectedDate,
              delivery_status: "pending",
              delivered_ok: false,
              paid: false,
              supplier_price: orderTotalNet,
              notes: notes || null,
              nb_shipping_method: null,
              nb_lines: mergedLines.map((line) => ({
                description: `${line.itemCode ? `${line.itemCode} - ` : ""}${line.itemName}${
                  line.hasLength
                    ? ` (ukupna dužina: ${Math.round(line.totalLength * 100) / 100} mm)`
                    : ""
                }`,
                quantity: line.quantity,
                unit: line.unit,
                lineNet: line.lineNet,
                materialType: resolvedMaterialType,
                sourceJobItemIds: line.sourceJobItemIds,
              })),
              nb_line_description:
                mergedLines[0]?.itemCode && mergedLines[0]?.itemName
                  ? `${mergedLines[0].itemCode} - ${mergedLines[0].itemName}`
                  : (mergedLines[0]?.itemName ?? null),
              nb_quantity: mergedLines[0]?.quantity ?? 1,
              nb_unit: mergedLines[0]?.unit ?? "kom",
            },
          ])
          .select("id,supplier")
          .single();

        if (error) throw error;
        createdOrders.push({
          id: data.id as string,
          supplier: (data.supplier as string) || supplier.name,
        });
      }

      const supplierSummary = createdOrders.map((order) => order.supplier).join(", ");
      await upsertSystemActivity({
        jobId: targetJobId,
        description: `Posao ${jobNumber}: Kreirana nabavka: ${createdOrders.length} porudžbina (${supplierSummary})`,
        systemKey: `material-order-quick-bulk:${targetJobId}:${today}:${createdOrders.map((o) => o.id).join(",")}`,
      });
      await runStatusAutomation(targetJobId);

      return createdOrders;
    },
    onSuccess: (createdOrders, variables) => {
      queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success(`Kreirano ${createdOrders.length} porudžbin${createdOrders.length === 1 ? "a" : "e"} materijala`);
    },
    onError: (error) => {
      toast.error(`Greška pri brzom unosu nabavke: ${getErrorMessage(error)}`);
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
          required_for_production_start: updatedOrder.requiredForProductionStart === true,
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
          supplier_complaint_note:
            updatedOrder.supplierComplaintNote !== undefined
              ? updatedOrder.supplierComplaintNote?.trim() || null
              : undefined,
          sef_reconciliation_at:
            updatedOrder.sefReconciliationAt !== undefined
              ? updatedOrder.sefReconciliationAt?.trim()
                ? updatedOrder.sefReconciliationAt
                : null
              : undefined,
          ...(updatedOrder.invoiceNumber !== undefined
            ? { invoice_number: updatedOrder.invoiceNumber?.trim() || null }
            : {}),
          ...(updatedOrder.invoiceAmount !== undefined
            ? {
                invoice_amount:
                  updatedOrder.invoiceAmount == null || !Number.isFinite(Number(updatedOrder.invoiceAmount))
                    ? null
                    : roundMoney(Number(updatedOrder.invoiceAmount)),
              }
            : {}),
          ...(updatedOrder.invoiceFileUrl !== undefined
            ? { invoice_file_url: updatedOrder.invoiceFileUrl?.trim() || null }
            : {}),
          ...(updatedOrder.paymentStatus !== undefined
            ? { payment_status: updatedOrder.paymentStatus }
            : {}),
          ...(updatedOrder.supplierProformaUrl !== undefined
            ? { supplier_proforma_url: updatedOrder.supplierProformaUrl?.trim() || null }
            : {}),
          ...(updatedOrder.supplierProformaTotal !== undefined && updatedOrder.supplierProformaTotal != null
            ? { supplier_proforma_total: roundMoney(Number(updatedOrder.supplierProformaTotal)) }
            : {}),
          ...(updatedOrder.supplierIncomingVatAmount !== undefined
            ? {
                supplier_incoming_vat_amount: roundMoney(
                  Math.max(0, Number(updatedOrder.supplierIncomingVatAmount) || 0),
                ),
              }
            : {}),
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
          description: `Isporuka materijala: ${labelDeliveryStatus(previousDeliveryStatus as MaterialOrder["deliveryStatus"])} → ${labelDeliveryStatus(updatedOrder.deliveryStatus)}`,
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
      void queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      toast.success("Narudžbina ažurirana");
    },
    onError: (error) => {
      toast.error(`Greška pri ažuriranju narudžbine: ${getErrorMessage(error)}`);
    },
  });

  const appendOrderLines = useMutation({
    mutationFn: async ({
      orderId,
      lines,
      jobId: targetJobId,
    }: {
      orderId: string;
      lines: MaterialOrder["nbLines"];
      jobId?: string;
    }) => {
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error("Nema novih stavki za dodavanje.");
      }

      const { data: current, error: fetchError } = await supabase
        .from("material_orders")
        .select("id, job_id, supplier_price, nb_lines")
        .eq("id", orderId)
        .single();
      if (fetchError) throw fetchError;

      const existingLines = parseNbLinesJson((current as { nb_lines?: unknown }).nb_lines) ?? [];
      const incoming = lines.map((l) => ({
        description: (l.description ?? "").trim() || "—",
        quantity: l.quantity,
        unit: (l.unit ?? "kom").trim() || "kom",
        lineNet: roundMoney(Number(l.lineNet) || 0),
        ...(l.materialType ? { materialType: l.materialType } : {}),
        ...(l.procurementMeta?.article?.trim()
          ? { procurementMeta: procurementMetaForNbLinesJson(l.procurementMeta) }
          : {}),
        ...(Array.isArray(l.sourceJobItemIds) && l.sourceJobItemIds.length > 0
          ? { sourceJobItemIds: l.sourceJobItemIds }
          : {}),
        ...(l.orderedQuantity != null && Number.isFinite(Number(l.orderedQuantity))
          ? { orderedQuantity: Number(l.orderedQuantity) }
          : {}),
      }));
      const mergedLines = [...existingLines, ...incoming];
      const total = sumOrderLinesNet(mergedLines);

      const first = mergedLines[0];
      const { error: updateError } = await supabase
        .from("material_orders")
        .update({
          supplier_price: total,
          nb_lines: mergedLines,
          nb_line_description: first?.description ?? null,
          nb_quantity: first?.quantity ?? null,
          nb_unit: first?.unit ?? "kom",
        })
        .eq("id", orderId);
      if (updateError) throw updateError;

      const resolvedJobId = targetJobId || ((current as { job_id?: string | null }).job_id ?? undefined);
      if (resolvedJobId) {
        await upsertSystemActivity({
          jobId: resolvedJobId,
          description: `Dodata dopuna materijala na postojeću porudžbinu (${incoming.length} stavki).`,
          systemKey: `material-order-append:${orderId}:${Date.now()}`,
        });
        await runStatusAutomation(resolvedJobId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Materijal je dodat na porudžbinu");
    },
    onError: (error) => {
      toast.error(`Greška pri dodavanju materijala: ${getErrorMessage(error)}`);
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
    ordersError,
    createOrder,
    updateOrder,
    appendOrderLines,
    deleteOrder,
    createQuickOrders,
  };
}

export function useFinalizeProcurementOrderReception() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      orderId: string;
      reportedBy: string;
      jobId?: string | null;
      lines: FinalizeProcurementReceptionLineRpc[];
    }) => {
      const { data, error } = await supabase.rpc("finalize_procurement_order_reception", {
        p_order_id: input.orderId,
        p_reported_by: input.reportedBy,
        p_lines: input.lines,
      });
      if (error) throw error;
      return data as FinalizeProcurementReceptionResult;
    },
    onSuccess: async (_data, variables) => {
      const jid = variables.jobId?.trim();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["material-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["material-order", variables.orderId] }),
        queryClient.invalidateQueries({ queryKey: ["procurement-complaints"] }),
        queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["job"] }),
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        jid ? queryClient.invalidateQueries({ queryKey: ["job", jid] }) : Promise.resolve(),
      ]);
    },
    onError: (error) => {
      toast.error(`Prijem nije sačuvan: ${getErrorMessage(error)}`);
    },
  });
}

export function useMaterialOrderById(orderId: string | undefined) {
  return useQuery({
    queryKey: ["material-order", orderId],
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!orderId?.trim()) return null;
      const { data, error } = await supabase
        .from("material_orders")
        .select(
          `
          *,
          suppliers (id, name, contact_person, address, phone, email, bank_account, pib, category),
          jobs (id, job_number, customers (name))
        `,
        )
        .eq("id", orderId.trim())
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const jobData = Array.isArray(data.jobs) ? data.jobs[0] : data.jobs;
      return mapMaterialOrderRow(data as Record<string, unknown>, jobData as JobLite | null | undefined);
    },
    enabled: Boolean(orderId?.trim()),
  });
}
