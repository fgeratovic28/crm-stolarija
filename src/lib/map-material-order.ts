import type { MaterialOrder, MaterialOrderPaymentStatus } from "@/types";
import { parseMaterialOrderItemsJson } from "@/lib/material-order-items-json";
import { parseNbLinesJson } from "@/lib/material-order-lines";

type SupplierLite = {
  name?: string;
  contact_person?: string;
  address?: string;
  phone?: string;
  email?: string;
  bank_account?: string;
  pib?: string;
};
type JobLite = {
  id: string;
  job_number: string;
  customers?: { name?: string } | { name?: string }[] | null;
};

function customerNameFromJobLite(job: JobLite): string | undefined {
  const c = Array.isArray(job.customers) ? job.customers[0] : job.customers;
  const name = c?.name?.trim();
  return name || undefined;
}

/** Jedinstveno mapiranje reda `material_orders` (+ join) u `MaterialOrder`. */
export function mapMaterialOrderRow(
  d: Record<string, unknown>,
  jobData?: JobLite | null,
): MaterialOrder {
  const supplierData = Array.isArray(d.suppliers) ? d.suppliers[0] : d.suppliers;
  const sup = supplierData as SupplierLite | null | undefined;
  const ownShipping = (d.nb_shipping_method as string | undefined)?.trim();

  return {
    id: d.id as string,
    publicShareToken: (d.public_share_token as string | undefined) ?? undefined,
    jobId: (d.job_id as string | undefined) ?? undefined,
    requiredForProductionStart: d.required_for_production_start === true,
    materialType: d.material_type as MaterialOrder["materialType"],
    supplierId: (d.supplier_id as string) || "",
    supplier: sup?.name || (d.supplier as string) || "",
    supplierContact: sup?.contact_person || (d.supplier_contact as string) || "",
    supplierAddress: sup?.address || undefined,
    supplierPhone: sup?.phone?.trim() || undefined,
    supplierEmail: sup?.email?.trim() || undefined,
    supplierBankAccount: sup?.bank_account?.trim() || undefined,
    supplierPib: sup?.pib?.trim() || undefined,
    orderDate: d.request_date as string,
    requestDate: d.request_date as string,
    deliveryDate: d.delivery_date as string | undefined,
    expectedDelivery: (d.expected_delivery_date as string) || (d.delivery_date as string) || "",
    price: Number(d.supplier_price) || 0,
    supplierPrice: Number(d.supplier_price) || 0,
    paid: !!d.paid,
    invoiceNumber: (d.invoice_number as string | undefined)?.trim() || undefined,
    invoiceAmount:
      d.invoice_amount != null && Number.isFinite(Number(d.invoice_amount))
        ? Number(d.invoice_amount)
        : undefined,
    invoiceFileUrl: (d.invoice_file_url as string | undefined)?.trim() || undefined,
    paymentStatus: ((): MaterialOrderPaymentStatus => {
      const s = String(d.payment_status ?? "").trim();
      return s === "paid_advance" ? "paid_advance" : "pending";
    })(),
    barcode: d.barcode as string | undefined,
    deliveryStatus: d.delivery_status as MaterialOrder["deliveryStatus"],
    supplierProformaUrl: (d.supplier_proforma_url as string | undefined)?.trim() || undefined,
    supplierProformaTotal:
      d.supplier_proforma_total != null && Number.isFinite(Number(d.supplier_proforma_total))
        ? Number(d.supplier_proforma_total)
        : undefined,
    supplierIncomingVatAmount:
      d.supplier_incoming_vat_amount != null && Number.isFinite(Number(d.supplier_incoming_vat_amount))
        ? Number(d.supplier_incoming_vat_amount)
        : undefined,
    deliveryVerified: !!d.delivered_ok,
    quantityVerified: !!d.delivered_ok,
    allDelivered:
      d.delivery_status === "delivered" || d.delivery_status === "materials_received",
    requestFile: d.request_file as string | undefined,
    quoteFile: d.quote_file as string | undefined,
    notes: d.notes as string | undefined,
    supplierComplaintNote: (d.supplier_complaint_note as string | undefined)?.trim() || undefined,
    sefReconciliationAt: (d.sef_reconciliation_at as string | undefined) ?? undefined,
    itemsJson: parseMaterialOrderItemsJson(d.items_json) ?? undefined,
    nbLines: parseNbLinesJson(d.nb_lines),
    nbLineDescription: (d.nb_line_description as string | undefined) ?? undefined,
    nbQuantity: d.nb_quantity != null ? Number(d.nb_quantity) : undefined,
    nbUnit: (d.nb_unit as string | undefined) ?? undefined,
    nbVatRatePercent: d.nb_vat_rate_percent != null ? Number(d.nb_vat_rate_percent) : undefined,
    nbBuyerBankAccount: (d.nb_buyer_bank_account as string | undefined) ?? undefined,
    nbShippingMethod: ownShipping || undefined,
    nbPaymentDueDate: (d.nb_payment_due_date as string | undefined) ?? undefined,
    nbPaymentNote: (d.nb_payment_note as string | undefined) ?? undefined,
    nbLegalReference: (d.nb_legal_reference as string | undefined) ?? undefined,
    nbDeliveryAddressOverride: (d.nb_delivery_address_override as string | undefined) ?? undefined,
    parentOrderId: (d.parent_order_id as string | null | undefined) ?? null,
    isShortageOrder: Boolean(d.is_shortage_order),
    siteMissingFromInstallation: Boolean(d.site_missing_from_installation),
    requiresProduction: Boolean(d.requires_production),
    job: jobData
      ? {
          id: jobData.id,
          jobNumber: jobData.job_number,
          customerName: customerNameFromJobLite(jobData),
        }
      : undefined,
  };
}
