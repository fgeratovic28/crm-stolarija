import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings, Building2, Bell, Palette, Save, Loader2, DatabaseBackup } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import {
  applyDocumentLanguageFromCache,
  mergeCompanyRowIntoCache,
  readAppSettingsCache,
  writeAppSettingsCache,
} from "@/lib/app-settings";
import { useI18n } from "@/contexts/I18nContext";
import { toast } from "sonner";
import { useRole } from "@/contexts/RoleContext";
import { MAINTENANCE_MODE_QUERY_KEY } from "@/hooks/use-maintenance-mode";
import {
  formatJobNextNumberInput,
  formatLegacyJobNumberExample,
  formatNumericJobNumberExample,
  formatNumericJobNumberFull,
  isValidJobPrefix,
  parseJobNextNumberInput,
  parseJobNumberFormat,
  parseNumericJobNextSeqInput,
  sanitizeJobPrefixInput,
  type JobNumberFormat,
} from "@/lib/job-number-settings";

function readSettingsFormInitialState(): {
  companyName: string;
  companyPib: string;
  companyMb: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyBankAccount: string;
  notifOverduePayments: boolean;
  notifLateDeliveries: boolean;
  notifUpcomingInstalls: boolean;
  notifNewComplaints: boolean;
  notifJobStatusChange: boolean;
  notifStaleJobStatus: boolean;
  jobStaleStatusDays: string;
  overdueDays: string;
  currency: string;
  dateFormat: string;
  language: string;
  customerPrefix: string;
  jobPrefix: string;
  jobNumberFormat: JobNumberFormat;
} {
  const c = readAppSettingsCache();
  return {
    companyName: c.companyName,
    companyPib: c.companyPib,
    companyMb: c.companyMb,
    companyAddress: c.companyAddress,
    companyPhone: c.companyPhone,
    companyEmail: c.companyEmail,
    companyWebsite: c.companyWebsite,
    companyBankAccount: c.companyBankAccount,
    notifOverduePayments: c.notifOverduePayments,
    notifLateDeliveries: c.notifLateDeliveries,
    notifUpcomingInstalls: c.notifUpcomingInstalls,
    notifNewComplaints: c.notifNewComplaints,
    notifJobStatusChange: c.notifJobStatusChange,
    notifStaleJobStatus: c.notifStaleJobStatus,
    jobStaleStatusDays: String(c.jobStaleStatusDays),
    overdueDays: String(c.overdueDays),
    currency: c.currency,
    dateFormat: c.dateFormat,
    language: c.language,
    customerPrefix: c.customerPrefix,
    jobPrefix: sanitizeJobPrefixInput(c.jobPrefix) || "P",
    jobNumberFormat: c.jobNumberFormat,
  };
}

const SETTINGS_ROW_ID = 1;

type AppSettingsRow = {
  company_name: string;
  company_pib: string;
  company_mb: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  company_logo: string;
  company_bank_account: string;
  notif_overdue_payments: boolean;
  notif_late_deliveries: boolean;
  notif_upcoming_installs: boolean;
  notif_new_complaints: boolean;
  notif_job_status_change: boolean;
  notif_stale_job_status: boolean;
  job_stale_status_days: number;
  overdue_days: number;
  currency: string;
  date_format: string;
  language: string;
  customer_prefix: string;
  job_prefix: string;
  job_number_format: string;
  maintenance_mode: boolean;
};

export default function SettingsPage() {
  const { t } = useI18n();
  const { currentRole } = useRole();
  const queryClient = useQueryClient();
  const initialForm = useMemo(() => readSettingsFormInitialState(), []);

  const [isSaving, setIsSaving] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [sqlBackupRunning, setSqlBackupRunning] = useState(false);

  const [companyName, setCompanyName] = useState(initialForm.companyName);
  const [companyPib, setCompanyPib] = useState(initialForm.companyPib);
  const [companyMb, setCompanyMb] = useState(initialForm.companyMb);
  const [companyAddress, setCompanyAddress] = useState(initialForm.companyAddress);
  const [companyPhone, setCompanyPhone] = useState(initialForm.companyPhone);
  const [companyEmail, setCompanyEmail] = useState(initialForm.companyEmail);
  const [companyWebsite, setCompanyWebsite] = useState(initialForm.companyWebsite);
  const [companyLogo, setCompanyLogo] = useState("");
  const [companyBankAccount, setCompanyBankAccount] = useState(initialForm.companyBankAccount);

  const [notifOverduePayments, setNotifOverduePayments] = useState(initialForm.notifOverduePayments);
  const [notifLateDeliveries, setNotifLateDeliveries] = useState(initialForm.notifLateDeliveries);
  const [notifUpcomingInstalls, setNotifUpcomingInstalls] = useState(initialForm.notifUpcomingInstalls);
  const [notifNewComplaints, setNotifNewComplaints] = useState(initialForm.notifNewComplaints);
  const [notifJobStatusChange, setNotifJobStatusChange] = useState(initialForm.notifJobStatusChange);
  const [notifStaleJobStatus, setNotifStaleJobStatus] = useState(initialForm.notifStaleJobStatus);
  const [jobStaleStatusDays, setJobStaleStatusDays] = useState(initialForm.jobStaleStatusDays);
  const [overdueDays, setOverdueDays] = useState(initialForm.overdueDays);

  const [currency, setCurrency] = useState(initialForm.currency);
  const [dateFormat, setDateFormat] = useState(initialForm.dateFormat);
  const [language, setLanguage] = useState(initialForm.language);
  const [customerPrefix, setCustomerPrefix] = useState(initialForm.customerPrefix);
  const [jobNumberFormat, setJobNumberFormat] = useState<JobNumberFormat>(initialForm.jobNumberFormat);
  const [savedJobNumberFormat, setSavedJobNumberFormat] = useState<JobNumberFormat>(initialForm.jobNumberFormat);
  const [jobPrefix, setJobPrefix] = useState(initialForm.jobPrefix);
  const [savedJobPrefix, setSavedJobPrefix] = useState(initialForm.jobPrefix);
  const [jobNextNumber, setJobNextNumber] = useState("");
  const [savedJobNextNumber, setSavedJobNextNumber] = useState("");
  const [jobNextNumberDirty, setJobNextNumberDirty] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const jobNumberYear = useMemo(() => new Date().getFullYear(), []);
  const [maintenanceMode, setMaintenanceMode] = useState(
    () => queryClient.getQueryData<boolean>(MAINTENANCE_MODE_QUERY_KEY) ?? false,
  );
  const [lockdownDialogOpen, setLockdownDialogOpen] = useState(false);

  const refreshJobNextNumberFromServer = useCallback(
    async (format: JobNumberFormat, prefix: string) => {
      const { data, error } = await supabase.rpc("peek_job_number_counter", {
        p_format: format,
        p_prefix: format === "legacy" ? sanitizeJobPrefixInput(prefix) : null,
      });
      if (error || (typeof data !== "number" && typeof data !== "string")) return;
      const n = typeof data === "number" ? data : Number.parseInt(String(data), 10);
      if (!Number.isFinite(n) || n < 1) return;
      const next =
        format === "numeric" ? formatNumericJobNumberFull(n) : formatJobNextNumberInput(n);
      setJobNextNumber(next);
      setSavedJobNextNumber(next);
      setJobNextNumberDirty(false);
    },
    [],
  );

  useEffect(() => {
    if (!settingsHydrated || jobNextNumberDirty) return;
    void refreshJobNextNumberFromServer(jobNumberFormat, jobPrefix);
  }, [
    settingsHydrated,
    jobNumberFormat,
    jobPrefix,
    jobNextNumberDirty,
    refreshJobNextNumberFromServer,
  ]);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
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
          company_logo,
          company_bank_account,
          notif_overdue_payments,
          notif_late_deliveries,
          notif_upcoming_installs,
          notif_new_complaints,
          notif_job_status_change,
          notif_stale_job_status,
          job_stale_status_days,
          overdue_days,
          currency,
          date_format,
          language,
          customer_prefix,
          job_prefix,
          job_number_format,
          maintenance_mode
        `
        )
        .eq("id", SETTINGS_ROW_ID)
        .maybeSingle<AppSettingsRow>();

      if (!isMounted) return;

      if (error) {
        toast.error(t("settings.toasts.loadError"));
        return;
      }

      if (data) {
        setCompanyName(data.company_name);
        setCompanyPib(data.company_pib);
        setCompanyMb(data.company_mb);
        setCompanyAddress(data.company_address);
        setCompanyPhone(data.company_phone);
        setCompanyEmail(data.company_email);
        setCompanyWebsite(data.company_website);
        setCompanyLogo(data.company_logo);
        setCompanyBankAccount(data.company_bank_account ?? "");
        setNotifOverduePayments(data.notif_overdue_payments);
        setNotifLateDeliveries(data.notif_late_deliveries);
        setNotifUpcomingInstalls(data.notif_upcoming_installs);
        setNotifNewComplaints(data.notif_new_complaints);
        setNotifJobStatusChange(data.notif_job_status_change);
        setNotifStaleJobStatus(data.notif_stale_job_status !== false);
        setJobStaleStatusDays(String(data.job_stale_status_days ?? 7));
        setOverdueDays(String(data.overdue_days));
        setCurrency(data.currency);
        setDateFormat(data.date_format);
        setLanguage(data.language);
        setCustomerPrefix(data.customer_prefix);
        const loadedFormat = parseJobNumberFormat(data.job_number_format);
        const loadedPrefix = sanitizeJobPrefixInput(data.job_prefix) || "P";
        setJobNumberFormat(loadedFormat);
        setSavedJobNumberFormat(loadedFormat);
        setJobPrefix(loadedPrefix);
        setSavedJobPrefix(loadedPrefix);
        setSettingsHydrated(true);
        void refreshJobNextNumberFromServer(loadedFormat, loadedPrefix);
        setMaintenanceMode(data.maintenance_mode === true);
        writeAppSettingsCache({
          ...mergeCompanyRowIntoCache(readAppSettingsCache(), data as unknown as Record<string, unknown>),
          language: data.language === "en" ? "en" : "sr",
          dateFormat:
            data.date_format === "dd/MM/yyyy" || data.date_format === "yyyy-MM-dd"
              ? data.date_format
              : "dd.MM.yyyy",
          currency:
            data.currency === "EUR" || data.currency === "USD" ? data.currency : "RSD",
          overdueDays: data.overdue_days,
          customerPrefix: data.customer_prefix,
          jobPrefix: loadedPrefix,
          jobNumberFormat: loadedFormat,
          notifOverduePayments: data.notif_overdue_payments,
          notifLateDeliveries: data.notif_late_deliveries,
          notifUpcomingInstalls: data.notif_upcoming_installs,
          notifNewComplaints: data.notif_new_complaints,
          notifJobStatusChange: data.notif_job_status_change,
          notifStaleJobStatus: data.notif_stale_job_status,
          jobStaleStatusDays: data.job_stale_status_days,
        });
        applyDocumentLanguageFromCache();
      }
    };

    loadSettings();

    return () => {
      isMounted = false;
    };
  }, [t, refreshJobNextNumberFromServer]);

  const handleSave = async () => {
    const parsedOverdueDays = Number.parseInt(overdueDays, 10);
    if (!Number.isFinite(parsedOverdueDays) || parsedOverdueDays <= 0) {
      toast.error(t("settings.toasts.overdueDaysInvalid"));
      return;
    }

    const parsedStaleDays = Number.parseInt(jobStaleStatusDays, 10);
    if (!Number.isFinite(parsedStaleDays) || parsedStaleDays <= 0) {
      toast.error(t("settings.toasts.staleDaysInvalid"));
      return;
    }

    const sanitizedJobPrefix = sanitizeJobPrefixInput(jobPrefix);
    if (jobNumberFormat === "legacy" && !isValidJobPrefix(sanitizedJobPrefix)) {
      toast.error(t("settings.toasts.jobPrefixInvalid"));
      return;
    }

    const parsedJobNext =
      jobNumberFormat === "numeric"
        ? parseNumericJobNextSeqInput(jobNextNumber)
        : parseJobNextNumberInput(jobNextNumber);
    if (parsedJobNext === null) {
      toast.error(t("settings.toasts.jobNextNumberInvalid"));
      return;
    }

    const nextFormatted = formatJobNextNumberInput(parsedJobNext);
    const jobPrefixForDb =
      jobNumberFormat === "legacy" ? sanitizedJobPrefix : nextFormatted;

    setIsSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      {
        id: SETTINGS_ROW_ID,
        company_name: companyName,
        company_pib: companyPib,
        company_mb: companyMb,
        company_address: companyAddress,
        company_phone: companyPhone,
        company_email: companyEmail,
        company_website: companyWebsite,
        company_logo: companyLogo,
        company_bank_account: companyBankAccount,
        notif_overdue_payments: notifOverduePayments,
        notif_late_deliveries: notifLateDeliveries,
        notif_upcoming_installs: notifUpcomingInstalls,
        notif_new_complaints: notifNewComplaints,
        notif_job_status_change: notifJobStatusChange,
        notif_stale_job_status: notifStaleJobStatus,
        job_stale_status_days: parsedStaleDays,
        overdue_days: parsedOverdueDays,
        currency,
        date_format: dateFormat,
        language,
        customer_prefix: customerPrefix,
        job_prefix: jobPrefixForDb,
        job_number_format: jobNumberFormat,
        maintenance_mode: maintenanceMode,
      },
      { onConflict: "id" }
    );

    if (error) {
      setIsSaving(false);
      toast.error(t("settings.toasts.saveError"));
      return;
    }

    const formatChanged = jobNumberFormat !== savedJobNumberFormat;
    const prefixChanged =
      jobNumberFormat === "legacy" && sanitizedJobPrefix !== savedJobPrefix;

    if (jobNextNumberDirty || formatChanged || prefixChanged) {
      const { error: counterError } = await supabase.rpc("set_job_number_counter", {
        p_next_value: parsedJobNext,
      });
      if (counterError) {
        setIsSaving(false);
        toast.error(t("settings.toasts.jobCounterSaveError"));
        return;
      }
      setSavedJobNextNumber(nextFormatted);
      setSavedJobNumberFormat(jobNumberFormat);
      setSavedJobPrefix(sanitizedJobPrefix);
      setJobNextNumberDirty(false);
      setJobNextNumber(nextFormatted);
      if (jobNumberFormat === "legacy") {
        setJobPrefix(sanitizedJobPrefix);
      }
    }

    setIsSaving(false);

    writeAppSettingsCache({
      ...mergeCompanyRowIntoCache(readAppSettingsCache(), {
        company_name: companyName,
        company_pib: companyPib,
        company_mb: companyMb,
        company_address: companyAddress,
        company_phone: companyPhone,
        company_email: companyEmail,
        company_website: companyWebsite,
        company_bank_account: companyBankAccount,
      }),
      language: language === "en" ? "en" : "sr",
      dateFormat:
        dateFormat === "dd/MM/yyyy" || dateFormat === "yyyy-MM-dd"
          ? dateFormat
          : "dd.MM.yyyy",
      currency: currency === "EUR" || currency === "USD" ? currency : "RSD",
      overdueDays: parsedOverdueDays,
      customerPrefix,
      jobPrefix: jobPrefixForDb,
      jobNumberFormat,
      notifOverduePayments,
      notifLateDeliveries,
      notifUpcomingInstalls,
      notifNewComplaints,
      notifJobStatusChange,
      notifStaleJobStatus,
      jobStaleStatusDays: parsedStaleDays,
    });
    applyDocumentLanguageFromCache();

    toast.success(t("settings.toasts.saveSuccess"));
  };

  const handleMaintenanceToggle = async (checked: boolean): Promise<boolean> => {
    if (currentRole !== "admin") return false;
    setMaintenanceSaving(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .update({ maintenance_mode: checked })
        .eq("id", SETTINGS_ROW_ID);
      if (error) {
        toast.error(t("settings.toasts.maintenanceUpdateError"));
        return false;
      }
      setMaintenanceMode(checked);
      await queryClient.invalidateQueries({ queryKey: [...MAINTENANCE_MODE_QUERY_KEY] });
      toast.success(t("settings.toasts.maintenanceSaved"));
      return true;
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const handleRunSqlBackupNow = async () => {
    setSqlBackupRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; key?: string }>(
        "backup-sql",
        {
          body: { trigger: "manual-admin" },
        },
      );
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Backup nije uspeo.");
      }

      toast.success("SQL Backup je uspešno generisan i sačuvan na Cloudflare R2!");
    } catch (error) {
      toast.error("SQL Backup nije uspeo", {
        description: error instanceof Error ? error.message : "Nepoznata greška.",
      });
    } finally {
      setSqlBackupRunning(false);
    }
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language === "en" ? "en" : "sr";
  }, [language]);

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: t("settings.pageTitle") }]} />
        <PageHeader
          title={t("settings.pageTitle")}
          description={t("settings.pageDescription")}
          icon={Settings}
          actions={
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              {t("settings.saveChanges")}
            </Button>
          }
        />

        <Tabs defaultValue="company" className="space-y-6">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="company" className="text-xs gap-1.5"><Building2 className="w-3.5 h-3.5" />{t("settings.tab.company")}</TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs gap-1.5"><Bell className="w-3.5 h-3.5" />{t("settings.tab.notifications")}</TabsTrigger>
            <TabsTrigger value="preferences" className="text-xs gap-1.5"><Palette className="w-3.5 h-3.5" />{t("settings.tab.preferences")}</TabsTrigger>
          </TabsList>

          {/* Company Info */}
          <TabsContent value="company">
            <div className="bg-card rounded-xl border border-border p-5 sm:p-6 space-y-6">
              <SectionHeader title={t("settings.company.title")} subtitle={t("settings.company.subtitle")} icon={Building2} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.name")}</Label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.pib")}</Label>
                  <Input value={companyPib} onChange={e => setCompanyPib(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.mb")}</Label>
                  <Input value={companyMb} onChange={e => setCompanyMb(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.address")}</Label>
                  <Input value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.phone")}</Label>
                  <Input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.email")}</Label>
                  <Input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.website")}</Label>
                  <Input value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.logoUrl")}</Label>
                  <Input value={companyLogo} onChange={e => setCompanyLogo(e.target.value)} placeholder="https://..." />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.bankAccount")}</Label>
                  <Input
                    value={companyBankAccount}
                    onChange={(e) => setCompanyBankAccount(e.target.value)}
                    placeholder="160-0000000000000-00"
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.company.bankAccountHint")}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <div className="bg-card rounded-xl border border-border p-5 sm:p-6 space-y-6">
              <SectionHeader title={t("settings.notifications.title")} subtitle={t("settings.notifications.subtitle")} icon={Bell} />
              <div className="space-y-4">
                {[
                  { label: t("settings.notifications.overdue"), desc: t("settings.notifications.overdueDesc"), checked: notifOverduePayments, onChange: setNotifOverduePayments },
                  { label: t("settings.notifications.late"), desc: t("settings.notifications.lateDesc"), checked: notifLateDeliveries, onChange: setNotifLateDeliveries },
                  { label: t("settings.notifications.upcoming"), desc: t("settings.notifications.upcomingDesc"), checked: notifUpcomingInstalls, onChange: setNotifUpcomingInstalls },
                  { label: t("settings.notifications.complaints"), desc: t("settings.notifications.complaintsDesc"), checked: notifNewComplaints, onChange: setNotifNewComplaints },
                  { label: t("settings.notifications.status"), desc: t("settings.notifications.statusDesc"), checked: notifJobStatusChange, onChange: setNotifJobStatusChange },
                  { label: t("settings.notifications.staleStatus"), desc: t("settings.notifications.staleStatusDesc"), checked: notifStaleJobStatus, onChange: setNotifStaleJobStatus },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/30 rounded-lg p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch checked={item.checked} onCheckedChange={item.onChange} />
                  </div>
                ))}
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.notifications.overdueDays")}</Label>
                  <Input type="number" value={overdueDays} onChange={e => setOverdueDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t("settings.notifications.overdueDaysHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.notifications.staleStatusDays")}</Label>
                  <Input type="number" value={jobStaleStatusDays} onChange={e => setJobStaleStatusDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t("settings.notifications.staleStatusDaysHint")}</p>
                </div>
              </div>

              {currentRole === "admin" ? (
                <>
                  <Separator />
                  <div className="rounded-lg border border-border bg-muted/25 p-4 space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Sigurnost baze podataka</p>
                      <p className="text-xs text-muted-foreground">
                        Ručno pokretanje SQL backup-a kompletne baze i čuvanje u Cloudflare R2.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => void handleRunSqlBackupNow()}
                      disabled={sqlBackupRunning}
                    >
                      {sqlBackupRunning ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <DatabaseBackup className="w-4 h-4 mr-1.5" />
                      )}
                      Napravi SQL Backup odmah
                    </Button>
                  </div>

                  <Separator />
                  <div className="rounded-lg border border-dashed border-border/90 bg-muted/25 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t("settings.notifications.channelDiagTitle")}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.notifications.channelDiagHint")}</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={maintenanceSaving || maintenanceMode}
                      onClick={() => setLockdownDialogOpen(true)}
                    >
                      {t("settings.notifications.channelDiagButton")}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </TabsContent>

          {/* Preferences */}
          <TabsContent value="preferences">
            <div className="bg-card rounded-xl border border-border p-5 sm:p-6 space-y-6">
              <SectionHeader title={t("settings.preferences.title")} subtitle={t("settings.preferences.subtitle")} icon={Palette} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.preferences.currency")}</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RSD">RSD — Srpski dinar</SelectItem>
                      <SelectItem value="EUR">EUR — Evro</SelectItem>
                      <SelectItem value="USD">USD — Američki dolar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.preferences.dateFormat")}</Label>
                  <Select value={dateFormat} onValueChange={setDateFormat}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd.MM.yyyy">dd.MM.yyyy</SelectItem>
                      <SelectItem value="dd/MM/yyyy">dd/MM/yyyy</SelectItem>
                      <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.preferences.language")}</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sr">Srpski</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-4 sm:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">{t("settings.invoicing.customerPrefix")}</Label>
                      <Input value={customerPrefix} onChange={e => setCustomerPrefix(e.target.value)} />
                      <p className="text-xs text-muted-foreground">{t("settings.invoicing.example")} {customerPrefix}001</p>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs font-medium text-muted-foreground">{t("settings.invoicing.jobNumberFormat")}</Label>
                      <Select
                        value={jobNumberFormat}
                        onValueChange={v => {
                          setJobNumberFormat(parseJobNumberFormat(v));
                          setJobNextNumberDirty(false);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="legacy">{t("settings.invoicing.jobNumberFormatLegacy")}</SelectItem>
                          <SelectItem value="numeric">{t("settings.invoicing.jobNumberFormatNumeric")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t("settings.invoicing.jobNumberFormatHint")}</p>
                    </div>
                    {jobNumberFormat === "legacy" ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">{t("settings.invoicing.jobPrefix")}</Label>
                        <Input
                          value={jobPrefix}
                          onChange={e => {
                            setJobPrefix(sanitizeJobPrefixInput(e.target.value));
                            setJobNextNumberDirty(false);
                          }}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <p className="text-xs text-muted-foreground">{t("settings.invoicing.jobPrefixHint")}</p>
                      </div>
                    ) : null}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {jobNumberFormat === "legacy"
                          ? t("settings.invoicing.jobNextSeqLegacy")
                          : t("settings.invoicing.jobNextNumber")}
                      </Label>
                      <Input
                        value={jobNextNumber}
                        onChange={e => {
                          setJobNextNumberDirty(true);
                          setJobNextNumber(e.target.value.replace(/\D/g, ""));
                        }}
                        inputMode="numeric"
                        autoComplete="off"
                        className="tabular-nums"
                      />
                      <p className="text-xs text-muted-foreground">
                        {jobNumberFormat === "legacy"
                          ? t("settings.invoicing.jobNextSeqLegacyHint")
                          : t("settings.invoicing.jobNextNumberHint")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.invoicing.example")}{" "}
                        {jobNumberFormat === "legacy"
                          ? formatLegacyJobNumberExample(
                              jobPrefix,
                              jobNumberYear,
                              parseJobNextNumberInput(jobNextNumber) ?? 1,
                            )
                          : formatNumericJobNumberExample(
                              parseNumericJobNextSeqInput(jobNextNumber) ?? 1,
                            )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <AlertDialog open={lockdownDialogOpen} onOpenChange={setLockdownDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings.notifications.channelDiagConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("settings.notifications.channelDiagConfirmDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settings.notifications.channelDiagCancel")}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={maintenanceSaving}
                onClick={() => {
                  void (async () => {
                    const ok = await handleMaintenanceToggle(true);
                    if (ok) setLockdownDialogOpen(false);
                  })();
                }}
              >
                {t("settings.notifications.channelDiagConfirmAction")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageTransition>
    </AppLayout>
  );
}
