import type { WorkOrderType } from "@/types";

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
      return "Teren — reklamacija; proverite istoriju posla i priloge.";
    case "service":
      return "Teren ili servis — održavanje ili korekcija po dogovoru.";
    case "site_visit":
      return "Teren — obilazak lokacije (bez ugradnje).";
    case "control_visit":
      return "Teren — kontrolni obilazak ili prijem.";
    default:
      return "Radni nalog vezan za posao ispod.";
  }
}
