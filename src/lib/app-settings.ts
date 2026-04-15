export const APP_SETTINGS_CACHE_KEY = "app_settings_cache";

export type AppSettingsCache = {
  language: "sr" | "en";
  dateFormat: "dd.MM.yyyy" | "dd/MM/yyyy" | "yyyy-MM-dd";
  timezone: string;
  currency: "RSD" | "EUR" | "USD";
  overdueDays: number;
  customerPrefix: string;
  jobPrefix: string;
  notifOverduePayments: boolean;
  notifLateDeliveries: boolean;
  notifUpcomingInstalls: boolean;
  notifNewComplaints: boolean;
  notifJobStatusChange: boolean;
};

const DEFAULT_SETTINGS_CACHE: AppSettingsCache = {
  language: "sr",
  dateFormat: "dd.MM.yyyy",
  timezone: "Europe/Belgrade",
  currency: "RSD",
  overdueDays: 30,
  customerPrefix: "KU-",
  jobPrefix: "P-",
  notifOverduePayments: true,
  notifLateDeliveries: true,
  notifUpcomingInstalls: true,
  notifNewComplaints: true,
  notifJobStatusChange: false,
};

export function readAppSettingsCache(): AppSettingsCache {
  if (typeof window === "undefined") return DEFAULT_SETTINGS_CACHE;
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_CACHE_KEY);
    if (!raw) return DEFAULT_SETTINGS_CACHE;
    const parsed = JSON.parse(raw) as Partial<AppSettingsCache>;
    return {
      language: parsed.language === "en" ? "en" : "sr",
      dateFormat:
        parsed.dateFormat === "dd/MM/yyyy" || parsed.dateFormat === "yyyy-MM-dd"
          ? parsed.dateFormat
          : "dd.MM.yyyy",
      timezone:
        typeof parsed.timezone === "string" && parsed.timezone.trim().length > 0
          ? parsed.timezone
          : "Europe/Belgrade",
      currency:
        parsed.currency === "EUR" || parsed.currency === "USD" ? parsed.currency : "RSD",
      overdueDays:
        typeof parsed.overdueDays === "number" && Number.isFinite(parsed.overdueDays) && parsed.overdueDays > 0
          ? Math.trunc(parsed.overdueDays)
          : 30,
      jobPrefix:
        typeof parsed.jobPrefix === "string" && parsed.jobPrefix.trim().length > 0
          ? parsed.jobPrefix
          : "P-",
      customerPrefix:
        typeof parsed.customerPrefix === "string" && parsed.customerPrefix.trim().length > 0
          ? parsed.customerPrefix
          : "KU-",
      notifOverduePayments: parsed.notifOverduePayments !== false,
      notifLateDeliveries: parsed.notifLateDeliveries !== false,
      notifUpcomingInstalls: parsed.notifUpcomingInstalls !== false,
      notifNewComplaints: parsed.notifNewComplaints !== false,
      notifJobStatusChange: parsed.notifJobStatusChange === true,
    };
  } catch {
    return DEFAULT_SETTINGS_CACHE;
  }
}

export function writeAppSettingsCache(cache: AppSettingsCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_SETTINGS_CACHE_KEY, JSON.stringify(cache));
    window.dispatchEvent(new Event("app-settings-updated"));
  } catch {
    // ignore write failures
  }
}

export function getActiveLocaleTag(): string {
  return readAppSettingsCache().language === "en" ? "en-GB" : "sr-RS";
}

export function formatCurrencyBySettings(value: number): string {
  const settings = readAppSettingsCache();
  return `${new Intl.NumberFormat(getActiveLocaleTag()).format(value)} ${settings.currency}`;
}

function pad2(v: number): string {
  return String(v).padStart(2, "0");
}

export function formatDateBySettings(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const { dateFormat } = readAppSettingsCache();
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = String(d.getFullYear());
  if (dateFormat === "yyyy-MM-dd") return `${yyyy}-${mm}-${dd}`;
  if (dateFormat === "dd/MM/yyyy") return `${dd}/${mm}/${yyyy}`;
  return `${dd}.${mm}.${yyyy}`;
}

export function formatDateTimeBySettings(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${formatDateBySettings(d)} ${hh}:${min}`;
}

export function applyDocumentLanguageFromCache(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = readAppSettingsCache().language === "en" ? "en" : "sr";
}

export function formatDateByAppLanguage(date: Date | string | number): string {
  return formatDateBySettings(date);
}

