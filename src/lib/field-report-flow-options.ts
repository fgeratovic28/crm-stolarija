/** Tip obrasca za novi izveštaj bez unapred definisanog radnog naloga (izbor u padajućoj listi). */
export type ReportFlowChoice = "standard" | "measurement" | "mounting" | "production";

export const REPORT_FLOW_OPTIONS: {
  value: ReportFlowChoice;
  label: string;
  /** Kratko uputstvo ispod liste */
  hint: string;
}[] = [
  {
    value: "standard",
    label: "Terenski (opšte)",
    hint: "Dolazak, otkaz, napomene — ne mora radni nalog.",
  },
  {
    value: "measurement",
    label: "Merenje ili provera mera",
    hint: "Stavke ček liste i mere kao na nalogu za merenje.",
  },
  {
    value: "mounting",
    label: "Montaža (ugradnja)",
    hint: "Montažni izveštaj povezan sa nalogom za ugradnju.",
  },
  {
    value: "production",
    label: "Proizvodnja",
    hint: "Skeniranje profila za proizvodni nalog.",
  },
];

export function filterWorkOrdersByReportChoice<T extends { type: string }>(
  rows: T[],
  choice: ReportFlowChoice,
): T[] {
  if (choice === "measurement") {
    return rows.filter((w) => w.type === "measurement" || w.type === "measurement_verification");
  }
  if (choice === "mounting") return rows.filter((w) => w.type === "installation");
  if (choice === "production") return rows.filter((w) => w.type === "production");
  return rows;
}
