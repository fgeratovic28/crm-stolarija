import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { APP_SETTINGS_CACHE_KEY, readAppSettingsCache } from "@/lib/app-settings";

type SupportedLanguage = "sr" | "en";

type Dictionary = Record<string, string>;

const sr: Dictionary = {
  "nav.dashboard": "Kontrolna tabla",
  "nav.jobs": "Kupci / Poslovi",
  "nav.customers": "Kupci",
  "nav.jobsOnly": "Poslovi",
  "nav.financeOverview": "Finansije",
  "nav.financePayments": "Plaćanja",
  "nav.financeReports": "Izveštaji",
  "nav.completedJobsMap": "Mapa zavrsenih poslova",
  "nav.activities": "Aktivnosti",
  "nav.finances": "Finansije",
  "nav.materialOrders": "Narudzbine materijala",
  "nav.suppliers": "Dobavljaci",
  "nav.vehicles": "Vozila",
  "nav.workers": "Radnici",
  "nav.workOrders": "Radni nalozi",
  "nav.fieldReports": "Terenski izvestaji",
  "nav.files": "Fajlovi / Dokumenta",
  "nav.teams": "Terenski timovi",
  "nav.users": "Korisnici / Uloge",
  "nav.settings": "Podesavanja",

  "settings.pageTitle": "Podesavanja",
  "settings.pageDescription": "Konfiguracija sistema i preferencije",
  "settings.saveChanges": "Sacuvaj izmene",
  "settings.tab.company": "Firma",
  "settings.tab.notifications": "Obavestenja",
  "settings.tab.preferences": "Preferencije",
  "settings.tab.invoicing": "Fakturisanje",
  "settings.company.title": "Podaci o firmi",
  "settings.company.subtitle": "Osnovne informacije o vasoj firmi",
  "settings.company.name": "Naziv firme",
  "settings.company.pib": "PIB",
  "settings.company.mb": "Maticni broj",
  "settings.company.address": "Adresa",
  "settings.company.phone": "Telefon",
  "settings.company.email": "Email",
  "settings.company.website": "Veb sajt",
  "settings.company.logoUrl": "Logo (URL)",
  "settings.company.bankAccount": "Ziro / tekuci racun (narucilac)",
  "settings.company.bankAccountHint": "Prikazuje se na porudzbenici materijala (nasa firma kao kupac).",
  "settings.notifications.title": "Obavestenja",
  "settings.notifications.subtitle": "Upravljanje sistemskim obavestenjima",
  "settings.notifications.overdue": "Dospela placanja",
  "settings.notifications.overdueDesc": "Obavesti kada placanje prekoraci rok",
  "settings.notifications.late": "Kasnjenje isporuke",
  "settings.notifications.lateDesc": "Obavesti kada isporuka materijala kasni",
  "settings.notifications.upcoming": "Predstojece ugradnje",
  "settings.notifications.upcomingDesc": "Podsetnik za zakazane ugradnje",
  "settings.notifications.complaints": "Nove reklamacije",
  "settings.notifications.complaintsDesc": "Obavesti pri prijemu reklamacije",
  "settings.notifications.status": "Promena statusa posla",
  "settings.notifications.statusDesc": "Obavesti kada se status posla promeni",
  "settings.notifications.staleStatus": "SLA — zastoj u statusu",
  "settings.notifications.staleStatusDesc":
    "Aktivnost i obaveštenje ako posao predugo stoji u Upit / Ponuda poslata / Merenje / U proizvodnji",
  "settings.notifications.staleStatusDays": "SLA prag (dani bez promene statusa)",
  "settings.notifications.staleStatusDaysHint": "Nakon ovog broja dana u istom statusu salje se podsetnik (podrazumevano 7)",
  "settings.notifications.overdueDays": "Rok dospelosti (dani)",
  "settings.notifications.overdueDaysHint": "Placanja starija od ovog broja dana smatraju se dospelim",
  "settings.preferences.title": "Preferencije sistema",
  "settings.preferences.subtitle": "Regionalna i jezicka podesavanja",
  "settings.preferences.currency": "Valuta",
  "settings.preferences.dateFormat": "Format datuma",
  "settings.preferences.language": "Jezik",
  "settings.preferences.timezone": "Vremenska zona",
  "settings.invoicing.title": "Podesavanja fakturisanja",
  "settings.invoicing.subtitle": "Prefiksi dokumenata i sabloni",
  "settings.invoicing.jobPrefix": "Prefiks posla",
  "settings.invoicing.customerPrefix": "Prefiks kupca",
  "settings.invoicing.invoicePrefix": "Prefiks fakture",
  "settings.invoicing.example": "Primer:",
  "settings.invoicing.footer": "Tekst u podnozju fakture",
  "settings.invoicing.footerHint": "Ovaj tekst se prikazuje na dnu svake generisane fakture",
  "settings.toasts.loadError": "Greska pri ucitavanju podesavanja.",
  "settings.toasts.saveError": "Greska pri cuvanju podesavanja.",
  "settings.toasts.saveSuccess": "Podesavanja su uspesno sacuvana.",
  "settings.toasts.overdueDaysInvalid": "Rok dospelosti mora biti broj veci od 0.",
  "settings.toasts.staleDaysInvalid": "SLA prag mora biti broj veci od 0.",
  "settings.notifications.channelDiagTitle": "Provera kanala obavestenja",
  "settings.notifications.channelDiagHint":
    "Sluzi za testiranje da li sistem moze da posalje sistemsko obavestenje (retko korisceno).",
  "settings.notifications.channelDiagButton": "Proveri dostupnost obavestenja",
  "settings.notifications.channelDiagConfirmTitle": "Potvrda",
  "settings.notifications.channelDiagConfirmDescription":
    "Nije slanje poruke. Ukljucuje prikaz obicne poruke o gresci (kao da ne radi veza ili ucitavanje) za sve korisnike. Vracanje: u Supabase app_settings.maintenance_mode = false gde id = 1, ili otkljucavanje na tom ekranu.",
  "settings.notifications.channelDiagConfirmAction": "Potvrdi",
  "settings.notifications.channelDiagCancel": "Otkaži",
  "settings.toasts.maintenanceUpdateError": "Greska pri promeni rezima odrzavanja.",
  "settings.toasts.maintenanceSaved": "Podesavanje je primenjeno.",

  "maintenance.checking": "Učitavanje...",
  "maintenance.title": "Ne možemo da prikažemo stranicu",
  "maintenance.description":
    "Proverite internet vezu ili pokušajte ponovo za nekoliko minuta.",
  "maintenance.signOut": "Odjavi se",
  "maintenance.unlockSuccess": "Stranica je spremna.",
  "maintenance.unlockFail": "Pokusajte ponovo.",
};

const en: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.jobs": "Customers / Jobs",
  "nav.customers": "Customers",
  "nav.jobsOnly": "Jobs",
  "nav.financeOverview": "Finances",
  "nav.financePayments": "Payments",
  "nav.financeReports": "Reports",
  "nav.completedJobsMap": "Completed Jobs Map",
  "nav.activities": "Activities",
  "nav.finances": "Finances",
  "nav.materialOrders": "Material Orders",
  "nav.suppliers": "Suppliers",
  "nav.vehicles": "Vehicles",
  "nav.workers": "Workers",
  "nav.workOrders": "Work Orders",
  "nav.fieldReports": "Field Reports",
  "nav.files": "Files / Documents",
  "nav.teams": "Field Teams",
  "nav.users": "Users / Roles",
  "nav.settings": "Settings",

  "settings.pageTitle": "Settings",
  "settings.pageDescription": "System configuration and preferences",
  "settings.saveChanges": "Save changes",
  "settings.tab.company": "Company",
  "settings.tab.notifications": "Notifications",
  "settings.tab.preferences": "Preferences",
  "settings.tab.invoicing": "Invoicing",
  "settings.company.title": "Company information",
  "settings.company.subtitle": "Basic details about your company",
  "settings.company.name": "Company name",
  "settings.company.pib": "Tax ID",
  "settings.company.mb": "Registration number",
  "settings.company.address": "Address",
  "settings.company.phone": "Phone",
  "settings.company.email": "Email",
  "settings.company.website": "Website",
  "settings.company.logoUrl": "Logo (URL)",
  "settings.company.bankAccount": "Bank account (buyer / our company)",
  "settings.company.bankAccountHint": "Shown on material purchase orders as the buyer bank details.",
  "settings.notifications.title": "Notifications",
  "settings.notifications.subtitle": "Manage system notifications",
  "settings.notifications.overdue": "Overdue payments",
  "settings.notifications.overdueDesc": "Notify when payment exceeds due date",
  "settings.notifications.late": "Late deliveries",
  "settings.notifications.lateDesc": "Notify when material delivery is delayed",
  "settings.notifications.upcoming": "Upcoming installations",
  "settings.notifications.upcomingDesc": "Reminder for scheduled installations",
  "settings.notifications.complaints": "New complaints",
  "settings.notifications.complaintsDesc": "Notify when a complaint is received",
  "settings.notifications.status": "Job status change",
  "settings.notifications.statusDesc": "Notify when job status changes",
  "settings.notifications.staleStatus": "SLA — stalled status",
  "settings.notifications.staleStatusDesc": "Activity and alert if a job stays too long in New / Active / Waiting on materials",
  "settings.notifications.staleStatusDays": "SLA threshold (days without status change)",
  "settings.notifications.staleStatusDaysHint": "After this many days in the same status, a reminder is sent (default 7)",
  "settings.notifications.overdueDays": "Overdue threshold (days)",
  "settings.notifications.overdueDaysHint": "Payments older than this number of days are considered overdue",
  "settings.preferences.title": "System preferences",
  "settings.preferences.subtitle": "Regional and language settings",
  "settings.preferences.currency": "Currency",
  "settings.preferences.dateFormat": "Date format",
  "settings.preferences.language": "Language",
  "settings.preferences.timezone": "Time zone",
  "settings.invoicing.title": "Invoicing settings",
  "settings.invoicing.subtitle": "Document prefixes and templates",
  "settings.invoicing.jobPrefix": "Job prefix",
  "settings.invoicing.customerPrefix": "Customer prefix",
  "settings.invoicing.invoicePrefix": "Invoice prefix",
  "settings.invoicing.example": "Example:",
  "settings.invoicing.footer": "Invoice footer text",
  "settings.invoicing.footerHint": "This text appears at the bottom of each generated invoice",
  "settings.toasts.loadError": "Failed to load settings.",
  "settings.toasts.saveError": "Failed to save settings.",
  "settings.toasts.saveSuccess": "Settings saved successfully.",
  "settings.toasts.overdueDaysInvalid": "Overdue threshold must be a number greater than 0.",
  "settings.toasts.staleDaysInvalid": "SLA threshold must be a number greater than 0.",
  "settings.notifications.channelDiagTitle": "Notification channel check",
  "settings.notifications.channelDiagHint":
    "Use to verify the system can send a system notification (rarely needed).",
  "settings.notifications.channelDiagButton": "Check notification availability",
  "settings.notifications.channelDiagConfirmTitle": "Confirm",
  "settings.notifications.channelDiagConfirmDescription":
    "This does not send a message. It shows a generic error-style screen for everyone (like a connection or loading issue). To turn off: in Supabase set app_settings.maintenance_mode = false where id = 1, or use the unlock gesture on that screen.",
  "settings.notifications.channelDiagConfirmAction": "Confirm",
  "settings.notifications.channelDiagCancel": "Cancel",
  "settings.toasts.maintenanceUpdateError": "Could not change maintenance mode.",
  "settings.toasts.maintenanceSaved": "Setting applied.",

  "maintenance.checking": "Loading…",
  "maintenance.title": "We can't load this page right now",
  "maintenance.description":
    "Check your connection or try again in a few minutes.",
  "maintenance.signOut": "Sign out",
  "maintenance.unlockSuccess": "Ready to continue.",
  "maintenance.unlockFail": "Please try again.",
};

type I18nContextValue = {
  language: SupportedLanguage;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: "sr",
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<SupportedLanguage>(() => readAppSettingsCache().language);

  useEffect(() => {
    const sync = () => setLanguage(readAppSettingsCache().language);
    const onStorage = (event: StorageEvent) => {
      if (event.key === APP_SETTINGS_CACHE_KEY) sync();
    };
    window.addEventListener("app-settings-updated", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app-settings-updated", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = language === "en" ? en : sr;
    return {
      language,
      t: (key: string) => dictionary[key] ?? key,
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

