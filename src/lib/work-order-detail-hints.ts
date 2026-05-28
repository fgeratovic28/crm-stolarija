import type { WorkOrderType } from "@/types";

/** RN bez prikaza obima posla, procene ugradnje i ponude — samo obilazak. */
export function isLightweightFieldVisitWorkOrderType(type: WorkOrderType | undefined | null): boolean {
  if (!type) return false;
  return type === "complaint" || type === "service" || type === "site_visit";
}

/** Kratak kontekst za koga je zadatak (sve uloge — pregled naloga). */
export function workOrderTypeDetailHint(type: WorkOrderType): string {
  switch (type) {
    case "measurement":
      return "Teren — merenje i dogovor na lokaciji klijenta; obavezna dokumentacija u izveštaju.";
    case "measurement_verification":
      return "Teren — provera merenja ili stanja pre daljeg rada.";
    case "production":
      return "Proizvodnja u fabrici po specifikaciji posla; lokacija ispod je adresa ugradnje kod klijenta.";
    case "installation":
      return "Montaža na lokaciji klijenta — koristite adresu, kontakt i procenu trajanja.";
    case "complaint":
    case "service":
    case "site_visit":
      return "Teren — obilazak lokacije (bez ugradnje).";
    case "control_visit":
      return "Teren — kontrolni obilazak ili prijem.";
    default:
      return "Radni nalog vezan za posao ispod.";
  }
}
