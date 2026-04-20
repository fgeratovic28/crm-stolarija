import * as z from "zod";
import type { MaterialOrder } from "@/types";
import { normalizeOrderLines } from "@/lib/material-order-lines";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const emptyToUndefined = (val: unknown) =>
  val === "" || val === undefined || val === null ? undefined : val;

export const optionalVatPct = z.preprocess((val) => {
  const u = emptyToUndefined(val);
  if (u === undefined) return undefined;
  const n = typeof u === "number" ? u : Number(String(u).replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, n));
}, z.number().optional());

export const orderLineSchema = z.object({
  description: z.string().min(1, "Unesite naziv stavke"),
  quantity: z.coerce.number().positive("Količina mora biti veća od 0"),
  unit: z.string().min(1, "Jedinica mere"),
  lineNet: z.coerce.number().min(0, "Iznos ne može biti negativan"),
  materialType: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.string().optional(),
  ),
});

export const narudzbenicaFieldsSchema = z.object({
  nbLines: z.array(orderLineSchema).min(1, "Dodajte bar jednu stavku"),
  nbVatRatePercent: optionalVatPct,
  nbBuyerBankAccount: z.string().optional(),
  nbShippingMethod: z.string().optional(),
  nbPaymentDueDate: z.string().optional(),
  nbPaymentNote: z.string().optional(),
  nbLegalReference: z.string().optional(),
  nbDeliveryAddressOverride: z.string().optional(),
});

const baseOrderSchema = z.object({
  jobId: z.string().optional(),
  /** Na kartici se bira po stavkama; prazno → „other” za CRM. */
  materialType: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? "other" : v),
    z.string().min(1),
  ),
  supplierId: z.string().min(1, "Izaberite dobavljača"),
  requestDate: z.string().min(1, "Datum upita je obavezan"),
  expectedDelivery: z.string().min(1, "Očekivani datum je obavezan"),
  deliveryDate: z.string().optional(),
  price: z.coerce.number().min(0, "Cena ne može biti negativna"),
  paid: z.boolean().default(false),
  deliveryVerified: z.boolean().default(false),
  deliveryStatus: z.string().default("pending"),
  notes: z.string().optional(),
  barcode: z.string().optional(),
  allDelivered: z.boolean().default(false),
});

export const orderSchema = baseOrderSchema.merge(narudzbenicaFieldsSchema);

export type MaterialOrderFormValues = z.infer<typeof orderSchema>;
export type NarudzbenicaFieldsValues = z.infer<typeof narudzbenicaFieldsSchema>;
export type MaterialOrderLineFormValues = z.infer<typeof orderLineSchema>;

/** Vrednosti za podformu „Porudžbenica” pri izmeni narudžbine. */
export function narudzbenicaDefaultsFromOrder(o: MaterialOrder): NarudzbenicaFieldsValues {
  const lines = normalizeOrderLines(o);
  const nbLines =
    lines.length > 0
      ? lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          lineNet: l.lineNet,
          materialType: l.materialType ?? undefined,
        }))
      : [
          {
            description: "",
            quantity: 1,
            unit: "kom",
            lineNet: 0,
            materialType: undefined,
          },
        ];

  return {
    nbLines,
    nbVatRatePercent: o.nbVatRatePercent ?? 20,
    nbBuyerBankAccount: o.nbBuyerBankAccount ?? "",
    nbShippingMethod: o.nbShippingMethod ?? "",
    nbPaymentDueDate: o.nbPaymentDueDate ?? "",
    nbPaymentNote: o.nbPaymentNote ?? "",
    nbLegalReference: o.nbLegalReference ?? "",
    nbDeliveryAddressOverride: o.nbDeliveryAddressOverride ?? "",
  };
}

/** Ukupan iznos bez PDV-a iz form stavki. */
export function totalNetFromFormLines(nbLines: MaterialOrderLineFormValues[]): number {
  return roundMoney(nbLines.reduce((s, l) => s + (Number(l.lineNet) || 0), 0));
}
