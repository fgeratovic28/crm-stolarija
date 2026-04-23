import type { MaterialOrder } from "@/types";
import { parseNbLinesJson } from "@/lib/material-order-lines";

type SupplierLite = {
  name?: string;
  contact_person?: string;
  address?: string;
  phone?: string;
  email?: string;
  bank_account?: string;
  pib?: string;
  /** Podrazumevani način isporuke na dobavljaču — koristi se kad je na porudžbini prazno. */
  nb_shipping_method?: string | null;
};
type JobLite = { id: string; job_number: string };

/** Jedinstveno mapiranje reda `material_orders` (+ join) u `MaterialOrder`. */
export function mapMaterialOrderRow(
  d: Record<string, unknown>,
  jobData?: JobLite | null,
): MaterialOrder {
  const supplierData = Array.isArray(d.suppliers) ? d.suppliers[0] : d.suppliers;
  const sup = supplierData as SupplierLite | null | undefined;
  const ownShipping = (d.nb_shipping_method as string | undefined)?.trim();
  const supplierShipping = (sup?.nb_shipping_method as string | undefined)?.trim();

  return {
    id: d.id as string,
    publicShareToken: (d.public_share_token as string | undefined) ?? undefined,
    jobId: (d.job_id as string | undefined) ?? undefined,
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
    barcode: d.barcode as string | undefined,
    deliveryStatus: d.delivery_status as MaterialOrder["deliveryStatus"],
    deliveryVerified: !!d.delivered_ok,
    quantityVerified: !!d.delivered_ok,
    allDelivered: d.delivery_status === "delivered",
    requestFile: d.request_file as string | undefined,
    quoteFile: d.quote_file as string | undefined,
    notes: d.notes as string | undefined,
    supplierComplaintNote: (d.supplier_complaint_note as string | undefined)?.trim() || undefined,
    sefReconciliationAt: (d.sef_reconciliation_at as string | undefined) ?? undefined,
    nbLines: parseNbLinesJson(d.nb_lines),
    nbLineDescription: (d.nb_line_description as string | undefined) ?? undefined,
    nbQuantity: d.nb_quantity != null ? Number(d.nb_quantity) : undefined,
    nbUnit: (d.nb_unit as string | undefined) ?? undefined,
    nbVatRatePercent: d.nb_vat_rate_percent != null ? Number(d.nb_vat_rate_percent) : undefined,
    nbBuyerBankAccount: (d.nb_buyer_bank_account as string | undefined) ?? undefined,
    nbShippingMethod: ownShipping || supplierShipping || undefined,
    nbPaymentDueDate: (d.nb_payment_due_date as string | undefined) ?? undefined,
    nbPaymentNote: (d.nb_payment_note as string | undefined) ?? undefined,
    nbLegalReference: (d.nb_legal_reference as string | undefined) ?? undefined,
    nbDeliveryAddressOverride: (d.nb_delivery_address_override as string | undefined) ?? undefined,
    job: jobData
      ? {
          id: jobData.id,
          jobNumber: jobData.job_number,
        }
      : undefined,
  };
}
