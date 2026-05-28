import type { QuoteDeliveryMethod } from "@/types";

/** Vrednosti kolone `quotes.delivery_method` (tekst u bazi). */
export const QUOTE_DELIVERY_METHOD_VALUES: readonly QuoteDeliveryMethod[] = [
  "not_sent",
  "email_system",
  "viber_whatsapp",
  "printed_in_person",
  "other",
];

export function parseQuoteDeliveryMethod(raw: unknown): QuoteDeliveryMethod {
  const s = typeof raw === "string" ? raw.trim() : "";
  if ((QUOTE_DELIVERY_METHOD_VALUES as readonly string[]).includes(s)) {
    return s as QuoteDeliveryMethod;
  }
  return "not_sent";
}

export function labelQuoteDeliveryMethod(m: QuoteDeliveryMethod): string {
  switch (m) {
    case "not_sent":
      return "Nije evidentirano slanje";
    case "email_system":
      return "Email (sistem)";
    case "viber_whatsapp":
      return "Viber / WhatsApp";
    case "printed_in_person":
      return "Štampano / uživo";
    case "other":
      return "Drugo";
    default:
      return m;
  }
}
