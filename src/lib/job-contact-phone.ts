/** Prvo telefon vezan za posao (`customer_phone`), zatim prvi iz kartice klijenta. */
export function jobPrimaryPhone(job: {
  customerPhone?: string | null;
  customer?: { phones?: string[] | null } | null;
}): string {
  const direct = typeof job.customerPhone === "string" ? job.customerPhone.trim() : "";
  if (direct) return direct;
  const arr = job.customer?.phones;
  if (!Array.isArray(arr)) return "";
  const first = arr
    .map((p) => (typeof p === "string" ? p.trim() : String(p).trim()))
    .find((p) => p.length > 0);
  return first ?? "";
}
