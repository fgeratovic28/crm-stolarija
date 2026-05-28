import type { QuotePaymentSlipInput } from "@/lib/quote-payment-slip-pdf";
import { parseMoneyInput } from "@/lib/money-input";

export type QuotePaymentSlipUserFields = {
  pozivNaBroj: string;
  svrhaUplate: string;
  /** Tekstualni unos iznosa (npr. `12.345,67`); prazno = bez iznosa na uplatnici. */
  iznosUplate?: string;
};

export function buildQuotePaymentSlipInput(
  fields: QuotePaymentSlipUserFields,
  parties: {
    payerName: string;
    payerAddress: string;
    recipientName: string;
    recipientAddress: string;
    recipientAccount: string;
    quoteNumber: string;
  },
): QuotePaymentSlipInput {
  const amountRaw = fields.iznosUplate?.trim() ?? "";
  const amount = amountRaw ? parseMoneyInput(amountRaw) : null;

  return {
    payerName: parties.payerName,
    payerAddress: parties.payerAddress,
    recipientName: parties.recipientName,
    recipientAddress: parties.recipientAddress,
    recipientAccount: parties.recipientAccount,
    paymentCode: "289",
    currency: "RSD",
    ...(amount != null && amount > 0 ? { amount } : {}),
    quoteNumber: parties.quoteNumber,
    referenceModel: "",
    referenceNumber: fields.pozivNaBroj.trim(),
    paymentPurpose: fields.svrhaUplate.trim(),
  };
}
