import { supabase } from "@/lib/supabase";

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
  notifStaleJobStatus: boolean;
  jobStaleStatusDays: number;
  /** Firma (naručilac) — porudžbenica, štampa. */
  companyName: string;
  companyPib: string;
  companyMb: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyBankAccount: string;
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
  notifStaleJobStatus: true,
  jobStaleStatusDays: 7,
  companyName: "",
  companyPib: "",
  companyMb: "",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  companyWebsite: "",
  companyBankAccount: "",
};

function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Spaja red `app_settings` u keš (naručilac / porudžbenica). */
export function mergeCompanyRowIntoCache(
  base: AppSettingsCache,
  row: Record<string, unknown>,
): AppSettingsCache {
  return {
    ...base,
    companyName: strField(row.company_name) || base.companyName,
    companyPib: strField(row.company_pib) || base.companyPib,
    companyMb: strField(row.company_mb) || base.companyMb,
    companyAddress: strField(row.company_address) || base.companyAddress,
    companyPhone: strField(row.company_phone) || base.companyPhone,
    companyEmail: strField(row.company_email) || base.companyEmail,
    companyWebsite: strField(row.company_website) || base.companyWebsite,
    companyBankAccount: strField(row.company_bank_account) || base.companyBankAccount,
  };
}

export function readAppSettingsCache(): AppSettingsCache {
  if (typeof window === "undefined") return DEFAULT_SETTINGS_CACHE;
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_CACHE_KEY);
    if (!raw) return DEFAULT_SETTINGS_CACHE;
    const parsed = JSON.parse(raw) as Partial<AppSettingsCache>;
    const base: AppSettingsCache = {
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
      notifStaleJobStatus: parsed.notifStaleJobStatus !== false,
      jobStaleStatusDays:
        typeof parsed.jobStaleStatusDays === "number" &&
        Number.isFinite(parsed.jobStaleStatusDays) &&
        parsed.jobStaleStatusDays > 0
          ? Math.trunc(parsed.jobStaleStatusDays)
          : 7,
      companyName: typeof parsed.companyName === "string" ? parsed.companyName : "",
      companyPib: typeof parsed.companyPib === "string" ? parsed.companyPib : "",
      companyMb: typeof parsed.companyMb === "string" ? parsed.companyMb : "",
      companyAddress: typeof parsed.companyAddress === "string" ? parsed.companyAddress : "",
      companyPhone: typeof parsed.companyPhone === "string" ? parsed.companyPhone : "",
      companyEmail: typeof parsed.companyEmail === "string" ? parsed.companyEmail : "",
      companyWebsite: typeof parsed.companyWebsite === "string" ? parsed.companyWebsite : "",
      companyBankAccount: typeof parsed.companyBankAccount === "string" ? parsed.companyBankAccount : "",
    };
    return base;
  } catch {
    return DEFAULT_SETTINGS_CACHE;
  }
}

export function writeAppSettingsCache(patch: Partial<AppSettingsCache>): void {
  if (typeof window === "undefined") return;
  try {
    const merged = { ...readAppSettingsCache(), ...patch };
    window.localStorage.setItem(APP_SETTINGS_CACHE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new Event("app-settings-updated"));
  } catch {
    // ignore write failures
  }
}

const APP_SETTINGS_ROW_ID = 1;

/** Učitava firmu i ostala podešavanja u localStorage (nakon prijave). */
export async function syncAppSettingsCacheFromSupabase(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select(
        `
        company_name,
        company_pib,
        company_mb,
        company_address,
        company_phone,
        company_email,
        company_website,
        company_bank_account,
        language,
        date_format,
        timezone,
        currency,
        overdue_days,
        customer_prefix,
        job_prefix,
        notif_overdue_payments,
        notif_late_deliveries,
        notif_upcoming_installs,
        notif_new_complaints,
        notif_job_status_change,
        notif_stale_job_status,
        job_stale_status_days
      `,
      )
      .eq("id", APP_SETTINGS_ROW_ID)
      .maybeSingle();

    if (error || !data) return;

    const row = data as Record<string, unknown>;
    const cur = readAppSettingsCache();
    writeAppSettingsCache({
      ...mergeCompanyRowIntoCache(cur, row),
      language: row.language === "en" ? "en" : "sr",
      dateFormat:
        row.date_format === "dd/MM/yyyy" || row.date_format === "yyyy-MM-dd"
          ? (row.date_format as AppSettingsCache["dateFormat"])
          : "dd.MM.yyyy",
      timezone: strField(row.timezone) || cur.timezone,
      currency: row.currency === "EUR" || row.currency === "USD" ? row.currency : "RSD",
      overdueDays:
        typeof row.overdue_days === "number" && Number.isFinite(row.overdue_days) && row.overdue_days > 0
          ? Math.trunc(row.overdue_days as number)
          : cur.overdueDays,
      customerPrefix: strField(row.customer_prefix) || cur.customerPrefix,
      jobPrefix: strField(row.job_prefix) || cur.jobPrefix,
      notifOverduePayments: row.notif_overdue_payments !== false,
      notifLateDeliveries: row.notif_late_deliveries !== false,
      notifUpcomingInstalls: row.notif_upcoming_installs !== false,
      notifNewComplaints: row.notif_new_complaints !== false,
      notifJobStatusChange: row.notif_job_status_change === true,
      notifStaleJobStatus: row.notif_stale_job_status !== false,
      jobStaleStatusDays:
        typeof row.job_stale_status_days === "number" &&
        Number.isFinite(row.job_stale_status_days) &&
        (row.job_stale_status_days as number) > 0
          ? Math.trunc(row.job_stale_status_days as number)
          : cur.jobStaleStatusDays,
    });
  } catch {
    /* ignore */
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

