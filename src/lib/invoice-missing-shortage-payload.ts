import type { MaterialOrderFormValues } from "@/lib/material-order-form-schema";
import { materialOrderFormLinesToMaterialOrderLines } from "@/lib/material-order-form-lines-mapper";
import { procurementMetaForNbLinesJson } from "@/lib/material-order-lines";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type InvoiceMissingOrderKind = "gotov_deo" | "sirovine";

/** Payload za `invoice_missing_send_to_procurement` — ista polja kao kod kreiranja obične narudžbine + `order_kind`. */
export function buildInvoiceMissingSendPayload(args: {
  data: MaterialOrderFormValues & Record<string, unknown>;
  orderKind: InvoiceMissingOrderKind;
  /** Pozicija sa predračuna (hitni alert) — upisuje se u `procurementMeta.position` ako linija nema poziciju. */
  invoicePosition: string;
}): Record<string, unknown> {
  const pos = args.invoicePosition.trim();
  const nbLinesOut = materialOrderFormLinesToMaterialOrderLines(args.data.nbLines, { zeroLineNet: false });

  const enriched = nbLinesOut.map((line) => {
    const pm = line.procurementMeta;
    if (pm?.position?.trim()) return line;
    if (pm) {
      return {
        ...line,
        procurementMeta: procurementMetaForNbLinesJson({ ...pm, position: pos }),
      };
    }
    return {
      ...line,
      procurementMeta: procurementMetaForNbLinesJson({
        article: line.description || "—",
        position: pos,
      }),
    };
  });

  const nb_lines = enriched.map((l) => ({
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
    ...(l.orderedQuantity != null && Number.isFinite(l.orderedQuantity) ? { orderedQuantity: l.orderedQuantity } : {}),
  }));

  const first = enriched[0];
  const price = roundMoney(Number(args.data.price) || 0);

  return {
    order_kind: args.orderKind,
    supplier_id: args.data.supplierId,
    supplier: String(args.data.supplier ?? ""),
    supplier_contact: String(args.data.supplierContact ?? ""),
    material_type: String(args.data.materialType ?? "other"),
    request_date: args.data.requestDate,
    delivery_status: args.data.deliveryStatus ?? "pending",
    supplier_price: price,
    notes: args.data.notes?.trim() ?? "",
    expected_delivery_date: args.data.expectedDelivery?.trim() || null,
    barcode: args.data.barcode?.trim() || null,
    nb_lines,
    items_json: args.data.itemsJson ?? null,
    nb_vat_rate_percent:
      args.data.nbVatRatePercent != null && Number.isFinite(Number(args.data.nbVatRatePercent))
        ? Number(args.data.nbVatRatePercent)
        : null,
    nb_buyer_bank_account: args.data.nbBuyerBankAccount?.trim() || null,
    nb_shipping_method: args.data.nbShippingMethod?.trim() || null,
    nb_payment_due_date: args.data.nbPaymentDueDate?.trim() || null,
    nb_payment_note: args.data.nbPaymentNote?.trim() || null,
    nb_legal_reference: args.data.nbLegalReference?.trim() || null,
    nb_delivery_address_override: args.data.nbDeliveryAddressOverride?.trim() || null,
    nb_line_description: (first?.description ?? "").trim() || null,
    nb_quantity: first?.quantity,
    nb_unit: (first?.unit ?? "kom").trim() || "kom",
    paid: args.data.paid ?? false,
    delivery_verified: args.data.deliveryVerified ?? false,
  };
}
