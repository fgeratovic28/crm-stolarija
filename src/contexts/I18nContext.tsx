import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { APP_SETTINGS_CACHE_KEY, readAppSettingsCache } from "@/lib/app-settings";

type SupportedLanguage = "sr" | "en";

type Dictionary = Record<string, string>;

const sr: Dictionary = {
  "nav.dashboard": "Kontrolna tabla",
  "nav.jobs": "Kupci / Poslovi",
  "nav.activities": "Aktivnosti",
  "nav.finances": "Finansije",
  "nav.materialOrders": "Narudzbine materijala",
  "nav.suppliers": "Dobavljaci",
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
};

const en: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.jobs": "Customers / Jobs",
  "nav.activities": "Activities",
  "nav.finances": "Finances",
  "nav.materialOrders": "Material Orders",
  "nav.suppliers": "Suppliers",
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

