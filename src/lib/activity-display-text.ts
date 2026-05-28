/** Poznati engleski razlozi u starijim automatskim aktivnostima → srpski prikaz. */
const LEGACY_AUTO_REASON_SR: Record<string, string> = {
  "Manual status override preserved": "Ručni status posla — automatska promena isključena",
  "Installation team arrival recorded on open installation work order":
    "Zabeležen dolazak tima na otvoren nalog ugradnje",
  "Installation rescheduled; work order in progress": "Ugradnja ponovo zakazana; nalog u toku",
  "Installation rescheduled; pending work order": "Ugradnja ponovo zakazana; nalog na čekanju",
  "Installation completed with final field report; awaiting full payment before completion":
    "Ugradnja završena (terenski izveštaj); čeka se puna uplata pre završetka posla",
  "Installation completed with final field report and fully paid job":
    "Ugradnja završena (terenski izveštaj); posao u potpunosti plaćen",
  "Installation issue pending follow-up or full job cancel":
    "Problem na ugradnji — čeka se rešavanje ili otkaz celog posla",
  "Installation site visit canceled": "Terenska poseta ugradnje otkazana",
  "Complaint work order opened": "Otvoren radni nalog reklamacije",
  "Service work order opened": "Otvoren radni nalog servisa",
  "Installation work order has a field report with issues (first completion cycle; applies even with another open installation work order)":
    "Nalog ugradnje sa problemom u izveštaju (prvi ciklus završetka)",
  "Site canceled without continuation": "Teren otkazan bez nastavka posla",
  "Measurement completed; enforce processing step before downstream statuses":
    "Merenje završeno; obavezna faza obrade mera",
  "Installation started or team arrival recorded": "Ugradnja započeta ili zabeležen dolazak tima",
  "Installation work order canceled; job stays in installation issue state until work continues on site or is rescheduled":
    "Nalog ugradnje otkazan; posao ostaje u statusu problema dok se ne nastavi na terenu",
  "Installation work orders pending (awaiting crew); measurement phase complete":
    "Nalozi ugradnje na čekanju (čeka se ekipa); merenje završeno",
  "Production completed and installation work order created":
    "Proizvodnja završena; kreiran nalog ugradnje",
  "Final quote sent after measurement; awaiting customer acceptance":
    "Finalna ponuda poslata posle merenja; čeka se prihvatanje",
  "Final quote sent after measurement; awaiting acceptance":
    "Finalna ponuda poslata posle merenja; čeka se prihvatanje",
  "Final quote accepted after measurement; awaiting a recorded payment before ready for work":
    "Finalna ponuda prihvaćena; čeka se uplata pre spremnosti za rad",
  "Post-measurement quote is pending acceptance; keep processing stage":
    "Ponuda posle merenja čeka prihvatanje; faza obrade mera",
  "Material received but active procurement complaints must be resolved first":
    "Materijal primljen; aktivne reklamacije nabavke moraju biti rešene",
  "Installation pending; material received—awaiting installation crew":
    "Ugradnja na čekanju; materijal primljen — čeka se montažna ekipa",
  "Installation pending; material received (legacy production path)":
    "Ugradnja na čekanju; materijal primljen",
  "All material orders reception finished": "Prijem svih narudžbina materijala završen",
  "All material orders sent and awaiting delivery": "Sve narudžbine poslate; čeka se isporuka",
  "Post-measurement terms not yet agreed before material procurement continues":
    "Uslovi posle merenja nisu dogovoreni pre nastavka nabavke",
  "Final terms agreed; record a payment after acceptance before marking the job ready for operational work":
    "Uslovi dogovoreni; evidentirajte uplatu pre spremnosti za operativni rad",
  "Material orders pending - not all sent to suppliers": "Narudžbine na čekanju — nisu sve poslate dobavljačima",
  "Post-measurement terms not yet agreed; awaiting acceptance or confirmation":
    "Uslovi posle merenja nisu dogovoreni; čeka se prihvatanje",
  "Final quote accepted or initial quote kept after measurement; awaiting a recorded payment before ready for work":
    "Ponuda prihvaćena ili zadržana početna ponuda; čeka se uplata",
  "Post-measurement terms agreed with payment recorded":
    "Uslovi posle merenja dogovoreni; uplata evidentirana",
  "Material orders pending - not all sent to suppliers (legacy path)":
    "Narudžbine na čekanju — nisu sve poslate dobavljačima",
  "Production phase without measurement work orders": "Faza proizvodnje bez naloga merenja",
  "Measurement work order assigned or created": "Dodeljen ili kreiran nalog merenja",
  "Quote accepted": "Ponuda prihvaćena",
  "Final quote sent after measurement": "Finalna ponuda poslata posle merenja",
  "Awaiting payment after final quote acceptance": "Čeka se uplata posle prihvatanja finalne ponude",
  "Quote sent to customer": "Ponuda poslata klijentu",
  "No workflow trigger matched (inquiry stage)": "Nema pokretača toka (faza upita)",
};

const LEGACY_WO_TYPE_IN_ACTIVITY: Record<string, string> = {
  Measurement: "Merenje",
  Installation: "Ugradnja",
  Production: "Proizvodnja",
  Complaint: "Reklamacija",
  Service: "Servis",
  "Site visit": "Terenska poseta",
  "Control visit": "Kontrolna poseta",
  "Measurement verification": "Provera mera",
};

/**
 * Priprema tekst aktivnosti za prikaz: uklanja [AUTO], prevodi poznate engleske fraze u starim zapisima.
 */
export function formatActivityDescriptionForDisplay(description: string): string {
  let text = description.trimStart().startsWith("[AUTO] ")
    ? description.trimStart().slice(7)
    : description;

  text = text.replace(/\s*->\s*/g, " → ");

  const parenMatch = text.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    const translated = LEGACY_AUTO_REASON_SR[inner];
    if (translated) {
      text = text.replace(`(${inner})`, `(${translated})`);
    }
  }

  for (const [en, sr] of Object.entries(LEGACY_WO_TYPE_IN_ACTIVITY)) {
    text = text.replace(
      new RegExp(`Automatski je otvoren radni nalog:\\s*${en}\\b`, "gi"),
      `Automatski je otvoren radni nalog: ${sr}`,
    );
    text = text.replace(
      new RegExp(`radni nalog:\\s*${en}\\b`, "gi"),
      `radni nalog: ${sr}`,
    );
  }

  return text;
}
