/**
 * Faza 1: proizvodnja (RN + teren) vodi se van ovog CRM-a.
 * - `ensure_workflow_work_orders` ne kreira automatski RN proizvodnje (migracija).
 * - UI sakriva proizvodne naloge i ne nudi tip „Proizvodnja“ pri ručnom dodavanju RN.
 * Kad je posao „U proizvodnji“, dispečer potvrdjuje završetak → status „Zakazano“ i kreiranje RN ugradnje.
 */
export const PRODUCTION_WORK_ORDER_PHASE_DEFERRED = true;

export function isProductionWorkOrderPhaseDeferred(): boolean {
  return PRODUCTION_WORK_ORDER_PHASE_DEFERRED;
}
