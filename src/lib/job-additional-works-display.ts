import { JOB_STATUS_CONFIG, type Job, type JobStatus } from "@/types";

export function isAdditionalWorksChildJob(job: { parentJobId?: string | null }): boolean {
  return typeof job.parentJobId === "string" && job.parentJobId.length > 0;
}

/**
 * Operativni tok pod-posla (dodatni radovi) — usklađeno sa `recompute_job_status` kada je `parent_job_id` postavljen:
 *
 * 1. **Upit** — kreiran pod-posao (`new`).
 * 2. **Ponuda poslata** — posle evidencije slanja ponude (`quote_sent`).
 * 3. **Prihvaćena ponuda + uplata → Spremno za rad** — posle prihvata bez uplate status „Čeka uplatu“
 *    (`final_quote_accepted_pending_payment` u bazi); posle evidentirane uplate na ovom pod-poslu → `ready_for_work`.
 * 4. **Čeka materijal** — naručen materijal, isporuka nije rešena.
 * 5. **U proizvodnji** — sav materijal primljen (i bez blokirajućih pritužbi/nedostataka); ili skraćeni put dugmetom
 *    „Materijal na stanju“ kad status dozvoljava.
 * 6. **Čeka ugradnju** — nakon završetka RN proizvodnje ili, u fazi van RN proizvodnje u CRM-u, dugmetom
 *    „Da, proizvodnja je završena“ (`scheduled`).
 * 7. **Ugradnja u toku** — RN ugradnje u toku.
 * 8. **Ugradnja završena / čeka uplatu** — RN ugradnje završen, završni izveštaj ok, ali ima preostalog duga
 *    (`installation_done_unpaid`).
 * 9. **Završen** — sve završeno i dug izmiren (`completed`).
 * 10. **Ugradnja – problem**, **Reklamacija**, **Servis** — isto kao na glavnom poslu (RN, teren, dugme
 *     „Otvori Reklamaciju/Servis“ posle `completed` kada korisnik ima pravo).
 */
export function jobStatusDisplayHint(job: Job): string {
  if (isAdditionalWorksChildJob(job)) {
    return "Pod-posao (dodatni radovi): tok od upita do servisa bez merenja u CRM-u; „Spremno za rad“ tek posle prihvata ponude i uplate na ovom poslu.";
  }
  return JOB_STATUS_CONFIG[job.status].automationHint;
}

/**
 * Pod-posao — isključivo ovi statusi u padajućoj listi (redosled procesa).
 * Interno se i dalje koristi `final_quote_accepted_pending_payment` dok čeka uplatu; prikazuje se obaveštenje ispod.
 */
const CHILD_JOB_SELECTABLE_STATUSES: readonly JobStatus[] = [
  "new",
  "quote_sent",
  "final_quote_accepted_pending_payment",
  "ready_for_work",
  "waiting_material",
  "partial_in_production",
  "in_production",
  "scheduled",
  "installation_in_progress",
  "installation_done_unpaid",
  "completed",
  "installation_problem",
  "complaint",
  "service",
];

/** Za glavni posao — svi statusi. Za pod-posao — isključivo {@link CHILD_JOB_SELECTABLE_STATUSES}. */
export function jobStatusOptionsForSelect(job: Job): JobStatus[] {
  if (!isAdditionalWorksChildJob(job)) {
    return Object.keys(JOB_STATUS_CONFIG) as JobStatus[];
  }
  return [...CHILD_JOB_SELECTABLE_STATUSES];
}

/** Prikaz statusa na pod-poslu — bez „finalne ponude“ u nazivu. */
export function jobStatusLabelForDisplay(job: Job, status: JobStatus = job.status): string | undefined {
  if (!isAdditionalWorksChildJob(job)) return undefined;
  if (status === "final_quote_accepted_pending_payment") return "Čeka uplatu";
  if (status === "final_quote_sent") return "Ponuda poslata";
  return undefined;
}

export function isChildJobStatusUnexpected(job: Job): boolean {
  if (!isAdditionalWorksChildJob(job)) return false;
  return !CHILD_JOB_SELECTABLE_STATUSES.includes(job.status);
}

/**
 * Sivi baner „Čeka ugradnju — termin i montažni tim“: samo poslovi u statusu Čeka ugradnje (`scheduled`).
 * Zakazivanje ugradnje (dugme na kartici posla) takođe je dozvoljeno tek u tom statusu — ne u proizvodnji / čekanju materijala.
 */
export function jobEligibleForInstallationScheduleBanner(job: Job): boolean {
  if (job.status === "canceled" || job.status === "completed") return false;
  return job.status === "scheduled";
}

/** Polja RN ugradnje (pending / u toku) za proveru zakazivanja. */
export type InstallationWorkOrderScheduleFields = {
  team_id?: string | null;
  assignedTeamId?: string | null;
  date?: string | null;
};

export function installationWorkOrderHasTeam(wo: InstallationWorkOrderScheduleFields): boolean {
  const tid = wo.assignedTeamId ?? wo.team_id;
  return tid != null && String(tid).trim() !== "";
}

export function installationWorkOrderHasDate(wo: InstallationWorkOrderScheduleFields): boolean {
  return wo.date != null && String(wo.date).trim() !== "";
}

/**
 * Zvaničan termin ugradnje: `jobs.scheduled_date` ili datum na otvorenom RN ugradnje.
 * (Isto kao prikaz u KPI / „Zakazan:“ — ne zahteva oba izvora.)
 */
export function jobHasOfficialInstallationSchedule(
  job: { scheduledAt?: string | null },
  openInstallationWorkOrders?: ReadonlyArray<InstallationWorkOrderScheduleFields>,
): boolean {
  if (typeof job.scheduledAt === "string" && job.scheduledAt.trim()) return true;
  if (!openInstallationWorkOrders?.length) return false;
  return openInstallationWorkOrders.some(installationWorkOrderHasDate);
}

/** RN ugradnje (pending / u toku) sa dodeljenim montažnim timom. */
export function installationWorkOrdersHaveTeam(
  workOrders: ReadonlyArray<InstallationWorkOrderScheduleFields>,
): boolean {
  return workOrders.some(installationWorkOrderHasTeam);
}

/** U statusu „Čeka ugradnju“ — termin i montažni tim su oba postavljeni. */
export function jobInstallationSchedulingComplete(
  job: Job,
  openInstallationWorkOrders: ReadonlyArray<InstallationWorkOrderScheduleFields>,
): boolean {
  if (job.status !== "scheduled") return false;
  return (
    jobHasOfficialInstallationSchedule(job, openInstallationWorkOrders) &&
    installationWorkOrdersHaveTeam(openInstallationWorkOrders)
  );
}

/**
 * Status „Čeka ugradnju“: u sivom baneru dok nije termin (posao ili RN) i tim na RN ugradnje.
 */
export function jobNeedsInstallationScheduleAttention(
  job: Job,
  openInstallationWorkOrders: ReadonlyArray<InstallationWorkOrderScheduleFields>,
): boolean {
  if (job.status !== "scheduled") return false;
  return !jobInstallationSchedulingComplete(job, openInstallationWorkOrders);
}
