import { JOB_STATUS_CONFIG, type JobStatus, type UserRole, type WorkOrderType } from "@/types";

/**
 * Mapiranje poslovnih uloga → šta u sistemu pokreće automatski status posla.
 * (U bazi se gledaju tipovi radnih naloga i narudžbine, ne JWT uloga.)
 */
export const JOB_AUTOMATION_BY_BUSINESS_ROLE: Record<
  string,
  { module: string; drives: string }
> = {
  "Kancelarija / Prodaja": {
    module: "Poslovi, kupci, aktivnosti",
    drives:
      "Ručni statusi „Ponuda poslata“ i „Servis“; ostalo može automatski (merenje → proizvodnja → čeka ugradnju → ugradnja). Reklamacija može automatski posle završetka ugradnje ako izveštaj prijavi problem.",
  },
  Nabavka: {
    module: "Narudžbine materijala, dobavljači",
    drives:
      "Ne menja direktno status posla u novom toku (operativni status prate RN merenje / proizvodnja / montaža).",
  },
  Proizvodnja: {
    module: "Radni nalozi (tip Proizvodnja)",
    drives:
      "Kad je RN proizvodnje završen, posao prelazi u „Čeka ugradnju“ (ako su merenje i prethodni koraci završeni).",
  },
  Teren: {
    module: "Terenski RN (merenje, kontrola mera, servis…)",
    drives:
      "Merenje u toku → „Merenje“; završeno merenje → „U proizvodnji“. Terenski izveštaj posle montaže određuje „Završen“ ili „Reklamacija“.",
  },
  Montaža: {
    module: "RN ugradnja",
    drives:
      "U toku ugradnje → „Ugradnja u toku“; završetak + izveštaj u redu → „Završen“; završetak + problem u izveštaju → „Reklamacija“.",
  },
  Finansije: {
    module: "Plaćanja, finansije",
    drives: "Ne menja automatski operativni status posla (samo evidencija uplata).",
  },
  Administrator: {
    module: "Sve",
    drives: "Isti podaci kao ostale uloge; pun pristup ručnim izmenama.",
  },
} as const;

/** RN tipovi za merenje (Teren — pre ugradnje). */
export const MEASUREMENT_WORK_ORDER_TYPES: readonly WorkOrderType[] = [
  "measurement",
  "measurement_verification",
];

/** RN ugradnja (Montaža) — zatvara posao kao „Završen“ ili „Reklamacija“ prema terenskom izveštaju. */
export const INSTALLATION_WORK_ORDER_TYPE: WorkOrderType = "installation";

/** RN proizvodnja — posle završetka, posao ide u „Čeka ugradnju“ (uz završeno merenje). */
export const PRODUCTION_WORK_ORDER_TYPE: WorkOrderType = "production";

/**
 * Terenske posete / kontrole — ne blokiraju prelaz u „Čeka ugradnju“ ako je merenje završeno
 * (opcioni obilasci ne drže posao u merenju umesto zakazivanja ugradnje).
 */
export const NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES: readonly WorkOrderType[] = [
  "site_visit",
  "control_visit",
];

/** Tipovi RN koji mogu da blokiraju „Čeka ugradnju“ dok su u pending (pored merenja/proizvodnje). */
export function workOrderTypeBlocksPreInstallSchedule(type: WorkOrderType): boolean {
  if (type === INSTALLATION_WORK_ORDER_TYPE) return false;
  if (NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES.includes(type)) return false;
  return true;
}

/** Kratki opis statusa (tooltip) — iz JOB_STATUS_CONFIG. */
export function jobStatusAutomationHint(status: JobStatus): string {
  return JOB_STATUS_CONFIG[status].automationHint;
}

/** Za prikaz u UI pored uloge (npr. podešavanja korisnika). */
export function roleOwnsAutomationLane(role: UserRole | null | undefined): string {
  switch (role) {
    case "procurement":
      return "Materijal i isporuke";
    case "production":
      return "Proizvodnja (RN proizvodnja)";
    case "teren":
      return "Merenje, terenski izveštaji";
    case "montaza":
      return "Ugradnja (RN ugradnja)";
    case "office":
      return "Status posla (ručno), kupci, poslovi";
    case "finance":
      return "Uplate (bez automatskog statusa posla)";
    case "admin":
      return "Sve";
    default:
      return "—";
  }
}
