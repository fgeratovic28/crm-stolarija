import { test } from "@playwright/test";

/**
 * Kompletan QA katalog **A–P** (matrica iz dokumenta). Stavke su `test.skip` sa hintom dok
 * ne zameniš telom prave E2E korake. Tag **`@manual-matrix`** — izostavi u CI:
 * `npx playwright test --grep-invert @manual-matrix`
 *
 * ---
 * ### Kako da ne poludiš od obima (isti dokument)
 * 1. **Jedan „master“ posao** — prođi ceo životni ciklus (**E + F + G + H + I + K**).
 * 2. **Drugi posao** — samo `installation_problem` + dashboard (**J**).
 * 3. **Treći** — addon quote prodaja (**I3.6 + J6**).
 * 4. **Četvrti** — `canceled` (teren vs kancelarija).
 * 5. Zatim **B7–B8**: po jednom nalogu po ulozi (admin, office, finance, procurement, production, montaza, teren).
 *
 * ---
 * ### Već automatizovano (ne briši ove specove pri ručnom prolazu matrice)
 * - **A1** pravi cold (bez splash preskoka): `e2e/cold-load.spec.ts` · **A1** brza varijanta: `regression-automated`
 * - **A4/A5, A6, A7**, **B2, B4**, **C1, C2**, **D3/D4, D6**, **G5**: `e2e/matrix/regression-automated.spec.ts`
 * - **A8** (`/random` + stari 404 path): `e2e/guest-routes.spec.ts`
 * - **B1**: `e2e/auth.spec.ts` · **B3**: guest-routes · **B5–B6** (registracija + odobrenje): `e2e/auth-register-approve.spec.ts`
 * - **Smoke login**: `e2e/smoke.spec.ts` · **Moduli GET**: `e2e/modules-routes.spec.ts` · **Detalj posla**: `e2e/job-detail.spec.ts` (E2E_JOB_ID)
 */
function skip(code: string, title: string, hint: string) {
  test(`${code} ${title}`, { tag: "@manual-matrix" }, () => {
    test.skip(true, hint);
  });
}

test.describe("Matrix placeholder @manual-matrix", () => {
  test.describe("A. Okruženje i omotač", () => {
    skip("A1", "Prvi cold load — detalj vizuelno", "Pravi cold bez splash: e2e/cold-load.spec.ts. Brza provera sa bypass: regression A1.");
    skip("A2", "maintenance_mode uključen", "Uključi maintenance u bazi ili Podešavanjima; blok ekran; odjava radi.");
    skip("A3", "Maintenance isključen", "Posle A2 — normalan rad.");
    skip("A4", "Offline — DevTools", "Automatski: regression-automated (OfflineBanner).");
    skip("A5", "Online ponovo — refetch", "Isti spec; ručno: nema duplog loading haosa.");
    skip("A6", "Tema svetlo/tamno + perzistencija", "Automatski: regression-automated A6 (localStorage crm-ui-theme).");
    skip("A7", "Jezik / format datuma", "Automatski: delom regression A7; ručno: liste vs detalji posla.");
    skip("A8", "Nepoznata ruta", "Automatski: guest-routes (/random + 404).");
    skip("A9", "Electron HashRouter", "Build sa VITE_ELECTRON_BUILD=true; deep linkovi.");
  });

  test.describe("B. Autentifikacija i uloge", () => {
    skip("B1", "Pogrešna lozinka", "Automatski: e2e/auth.spec.ts.");
    skip("B2", "Ispravan login + from ruta", "Automatski: regression B2 + smoke.");
    skip("B3", "Neulogovan → zaštićena ruta", "Automatski: guest-routes /jobs → /login.");
    skip("B4", "Odjava", "Automatski: regression B4.");
    skip("B5", "Pending approval", "Automatski: auth-register-approve (email potvrda isključena).");
    skip("B6", "Odobren ne na /pending-approval", "Isti spec + reload; ručno: posle uloge.");
    skip(
      "B7.finance",
      "Uloga bez modula → ručan URL",
      "Prijavi finance; GET /material-orders → redirect na /. Automatizacija: E2E_FINANCE_* u .env pa proširi modules test.",
    );
    skip(
      "B7.office",
      "Uloga bez modula → ručan URL",
      "Prijavi office; GET /finances → redirect na /.",
    );
    skip(
      "B7.procurement",
      "Uloga bez modula → ručan URL",
      "Prijavi procurement; GET /activities → redirect na /.",
    );
    skip(
      "B7.production",
      "Uloga bez modula → ručan URL",
      "Prijavi production; GET /customers → redirect na /.",
    );
    skip(
      "B7.montaza",
      "Uloga bez modula → ručan URL",
      "Prijavi montaza; GET /material-orders → redirect na /.",
    );
    skip(
      "B7.teren",
      "Uloga bez modula → ručan URL",
      "Prijavi teren; GET /field-reports → redirect na /.",
    );
    skip("B8.admin", "Sidebar — samo dozvoljeni moduli", "Prođi ceo meni kao admin.");
    skip("B8.office", "Sidebar — samo dozvoljeni moduli", "Kupci, poslovi, aktivnosti, fajlovi na poslu.");
    skip("B8.finance", "Sidebar — samo dozvoljeni moduli", "Dashboard, poslovi, finansije.");
    skip("B8.procurement", "Sidebar", "Narudžbine, prijem, dobavljači, vozila, fajlovi.");
    skip("B8.production", "Sidebar", "RN, prijem materijala, fajlovi.");
    skip("B8.montaza", "Sidebar", "RN ugradnje.");
    skip("B8.teren", "Sidebar", "RN teren; bez globalnih terenskih izveštaja (vidi O3).");
    skip(
      "B9",
      "IDOR slabija uloga → /jobs/{tuđi-id}",
      "E2E_ALIEN_JOB_ID + drugi nalog; očekuj prazan/greška, bez tuđih podataka.",
    );
  });

  test.describe("C. Kupci", () => {
    skip("C1", "Novi kupac — sva obavezna polja", "Automatski: regression-automated › C. Kupci.");
    skip("C2", "Novi kupac — validacija", "Automatski: regression C2.");
    skip("C3", "Izmena kupca", "E2E_CUSTOMER_ID ili ručno sa liste.");
    skip("C4", "Više telefona / mejlova", "Dodaj redove u formi kupca.");
    skip("C5", "Povezivanje kupca sa novim poslom", "Modal Novi posao (D6 u regression pokriva otvaranje modala).");
  });

  test.describe("D. Lista poslova i mapa", () => {
    skip("D1", "Lista prazna", "Filter / staging bez poslova.");
    skip("D2", "Lista sa mnogo redova", "Scroll, performanse.");
    skip("D3", "Filteri / pretraga", "Ručno po UI; lista: regression D3/D4.");
    skip("D4", "Klik na posao", "Automatski: regression D3/D4 (Detalji).");
    skip("D5", "Mapa završenih — zoom, marker", "/jobs-map.");
    skip("D6", "Novi posao — modal", "Automatski: regression D6.");
  });

  test.describe("E. Status posla (životni ciklus)", () => {
    // Statusi: new, quote_sent, final_quote_sent, accepted, measuring, measurement_processing,
    // ready_for_work, waiting_material, in_production, scheduled, installation_in_progress,
    // installation_done_unpaid, completed, installation_problem, complaint, service, canceled
    // (+ final_quote_accepted_pending_payment u fin. filterima).
    skip("E1", "Upit", "Nov posao bez poslate ponude.");
    skip("E2", "Ponuda poslata", "Lista + sent ponuda.");
    skip("E3", "Prihvaćeno", "accepted na ponudi.");
    skip("E4", "Merenje", "Aktivan RN merenja.");
    skip("E5", "Obrada mera", "Posle završetka merenja (automatski).");
    skip("E6", "Finalna poslata", "Ponuda posle merenja, sent.");
    skip("E7", "Spremno za rad", "Prihvat + uplata ili keep initial + uplata.");
    skip("E8", "Čeka materijal", "Porudžbine poslate, prijem nije završen.");
    skip("E9", "U proizvodnji", "Primljeno; reklamacija nabavke može držati waiting_material.");
    skip("E10", "Čeka ugradnju", "Proizvodnja gotova, RN ugradnje pending.");
    skip("E11", "Ugradnja u toku", "RN in_progress ili arrivedAt u izveštaju.");
    skip("E12", "Ugradnja završena / nije plaćeno", "Izveštaj OK, saldo > 0.");
    skip("E13", "Završen", "Puna uplata + izveštaj.");
    skip("E14", "Završen blokiran", "Ručno Završen sa dugom → toast greška.");
    skip("E15", "Ugradnja – problem", "Loš prvi izveštaj / otkaz lokacije.");
    skip("E16", "Izlaz iz installation_problem", "Ponovo pending/in_progress RN ugradnje.");
    skip("E17", "Reklamacija / servis", "Posle završetka, novi RN.");
    skip("E18", "Otkazan", "Ručno + otkaz sa terena (bez nastavka).");
    skip("E19", "Status zaključan", "Lock — menjanje blokirano.");
    skip("E20", "Proizvodnja druga faza", "Alert + „proizvodnja završena“.");
  });

  test.describe("F. Ponude", () => {
    skip("F1", "Ponuda draft", "Quotes tab.");
    skip("F2", "Poslata", "Email / drugi kanal po UI.");
    skip("F3", "Prihvaćena", "");
    skip("F4", "Odbijena", "");
    skip("F5", "Zamenjena (nova verzija)", "");
    skip("F6", "Više verzija na poslu", "");
    skip("F7", "Slanje više ponuda", "send-multiple API ako je u upotrebi.");
    skip("F8", "PDF ponude", "Generisanje / pregled.");
    skip("F9", "Finalna posle merenja + prihvat", "");
    skip("F10", "Zadržati početnu + uplata", "");
    skip("F11", "Prihvat bez uplate (gate)", "Automatizacija zahteva uplatu.");
  });

  test.describe("G. Finansije i plaćanja", () => {
    skip("G1", "Nema uplata, totalPrice > 0", "");
    skip("G2", "Delimična uplata", "");
    skip("G3", "Puna isplata", "");
    skip("G4", "Uplata sa/bez PDV", "");
    skip("G5", "Finansije tabovi", "Automatski: regression G5 (Finansije / Plaćanja / Izveštaji).");
    skip("G6", "Filteri finansija", "Plaćeno/neplaćeno, status, mesec.");
    skip("G7", "Export finansija", "ExportModal.");
    skip("G8", "Evidencija fakture narudžbine", "MaterialOrderInvoiceEvidencijaDialog.");
  });

  test.describe("H. Radni nalozi", () => {
    skip("H1", "Kreiranje svakog tipa RN", "measurement, measurement_verification, installation, production, complaint, service, site_visit, control_visit — po ulozi.");
    skip("H2", "pending → in_progress → completed", "");
    skip("H3", "Otkaz RN", "");
    skip("H4", "Merenje — obavezna polja", "Mere, sati ugradnje.");
    skip("H5", "Ugradnja — checklist / mere stavki", "");
    skip("H6", "Proizvodnja — sken stavki", "");
    skip("H7", "Teren/montaža view_own_team_only", "");
    skip("H8", "Detalj RN sa kartice posla", "");
  });

  test.describe("I. Terenski / montažni / proizvodni izveštaj", () => {
    skip("I1.1", "Izveštaj sa RN", "");
    skip("I1.2", "Terenski opšte bez RN", "");
    skip("I1.3", "Bez RN → Merenje", "");
    skip("I1.4", "Bez RN → Montaža", "");
    skip("I1.5", "Bez RN → Proizvodnja", "");
    skip("I1.6", "Nema RN odgovarajućeg tipa", "");
    skip("I2.1", "Merenje sve OK + mere + sati", "");
    skip("I2.2", "Merenje nije OK — tekst", "");
    skip("I2.3", "Merenje bez mera", "Validacija.");
    skip("I2.4", "Merenje bez sati ugradnje", "");
    skip("I2.5", "Merenje fotografije", "");
    skip("I2.6", "Otkaz merenja", "");
    skip("I3.1", "Montaža sve OK — posao završen", "");
    skip("I3.2", "Checkbox Sol / Daska / Komarnici", "");
    skip("I3.3", "Drugi delovi + tekst", "");
    skip("I3.4", "Nedostatak predračun + RPC hitno", "");
    skip("I3.5", "Isti tok — RPC greška", "");
    skip("I3.6", "Wizard Ne — addon prodaja", "Treći posao u strategiji.");
    skip("I3.7", "Treba nešto još ručno", "");
    skip("I3.8", "Otkaz na lokaciji + razlog", "");
    skip("I3.9", "Otkaz + fale delovi u „nije u redu“", "");
    skip("I3.10", "Montaža fotografije", "");
    skip("I4.1", "Proizvodnja sve stavke", "");
    skip("I4.2", "Proizvodnja delimično", "");
    skip("I4.3", "Proizvodnja obavezan tekst", "");
    skip("I5.1", "Opšti teren — napomene", "");
    skip("I5.2", "Dolazak / otkaz kombinacije", "");
  });

  test.describe("J. Upozorenja i notifikacije", () => {
    skip("J1", "HITNO nedostatak predračun banner", "Admin / P / Pr.");
    skip("J2", "Prosledi u nabavku", "");
    skip("J3", "Zakaži do-ugradnju", "");
    skip("J4", "Ordered — dugmad disabled", "");
    skip("J5", "Sales prateći RN", "SalesAlertsWidget.");
    skip("J6", "Sales addon dismiss", "Treći posao strategije.");
    skip("J7", "Otkazani poslovi widget", "");
    skip("J8", "Reklamacije nabavke — dva alerta", "");
    skip("J9", "Procurement ad-hoc pending", "");
    skip("J10", "MissingDataWarning na poslu", "");
    skip("J11", "Finansijski blok ako query padne", "");
  });

  test.describe("K. Materijal i nabavka", () => {
    skip("K1", "Nova narudžbina sa posla", "");
    skip("K2", "Narudžbina bez posla", "Ako dozvoljeno.");
    skip("K3", "delivery_status sve faze", "pending → … → materials_received / partial / received_with_issues.");
    skip("K4", "Bedž Kasni", "");
    skip("K5", "Reklamacija nabavke PDF", "");
    skip("K6", "Excel import linija", "");
    skip("K7", "SEF / faktura", "Ako produkcija.");
    skip("K8", "Javna narudžbenica token", "guest-routes nevalidan; validan: E2E_PUBLIC_NB_TOKEN.");
    skip("K9", "Redirect /r/order/:id", "");
    skip("K10", "Order reception tokovi", "bez/sa loginom, prava, pun prijem.");
    skip("K11", "Legacy /material-orders/:id/reception → redirect", "");
    skip("K12", "Material reception — barkod, greške", "");
  });

  test.describe("L. Fajlovi i skladište", () => {
    skip("L1", "Upload na poslu (kategorije)", "");
    skip("L2", "Brisanje fajla", "");
    skip("L3", "Globalna stranica Fajlovi", "modules-routes GET /files.");
    skip("L4", "Admin kvota u sidebaru", "normalno / prekoračenje / greška učitavanja.");
  });

  test.describe("M. HR i šifarnici", () => {
    skip("M1", "Dobavljači CRUD", "modules /suppliers.");
    skip("M2", "Vozila CRUD, arhiva", "");
    skip("M3", "Radnici + bolovanje", "");
    skip("M4", "Timovi", "");
    skip("M5", "Korisnici — uloga, deaktivacija", "Dodela uloge: auth-register-approve; ostalo ručno na /users.");
  });

  test.describe("N. Podešavanja i profil", () => {
    skip("N1", "Firma, logo, banka, prefiksi", "");
    skip("N2", "Notifikacije switch-evi", "");
    skip("N3", "SQL backup", "Uspeh / greška.");
    skip("N4", "Profil", "modules-routes GET /profile.");
  });

  test.describe("O. Globalne liste", () => {
    skip("O1", "/work-orders filteri", "");
    skip("O2", "/field-reports — samo uloge sa modulom", "modules-routes.");
    skip("O3", "Teren — bez globalne stranice izveštaja", "Izveštaj samo kroz RN (B8.teren).");
  });

  test.describe("P. Edge slučajevi", () => {
    skip("P1", "Istek sesije u formi", "");
    skip("P2", "Mreža puca usred mutacije", "");
    skip("P3", "Dupli submit", "");
    skip("P4", "Veliki fajl", "");
    skip("P5", "Unicode i navodnici u poljima", "");
  });
});
