import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings, Building2, Bell, Palette, Save, Loader2 } from "lucide-react";
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
import { supabase } from "@/lib/supabase";
import { applyDocumentLanguageFromCache, writeAppSettingsCache } from "@/lib/app-settings";
import { useI18n } from "@/contexts/I18nContext";
import { toast } from "sonner";
import { useRole } from "@/contexts/RoleContext";
import { MAINTENANCE_MODE_QUERY_KEY } from "@/hooks/use-maintenance-mode";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  timezone: string;
  customer_prefix: string;
  job_prefix: string;
  maintenance_mode: boolean;
};

export default function SettingsPage() {
  const { t, language: activeLanguage } = useI18n();
  const { currentRole } = useRole();
  const queryClient = useQueryClient();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);

  const [companyName, setCompanyName] = useState("Stolarija Kovačević d.o.o.");
  const [companyPib, setCompanyPib] = useState("100234567");
  const [companyMb, setCompanyMb] = useState("20123456");
  const [companyAddress, setCompanyAddress] = useState("Industrijska zona bb, Novi Sad 21000");
  const [companyPhone, setCompanyPhone] = useState("+381 21 456 7890");
  const [companyEmail, setCompanyEmail] = useState("office@stolarija-kovacevic.rs");
  const [companyWebsite, setCompanyWebsite] = useState("www.stolarija-kovacevic.rs");
  const [companyLogo, setCompanyLogo] = useState("");

  const [notifOverduePayments, setNotifOverduePayments] = useState(true);
  const [notifLateDeliveries, setNotifLateDeliveries] = useState(true);
  const [notifUpcomingInstalls, setNotifUpcomingInstalls] = useState(true);
  const [notifNewComplaints, setNotifNewComplaints] = useState(true);
  const [notifJobStatusChange, setNotifJobStatusChange] = useState(false);
  const [notifStaleJobStatus, setNotifStaleJobStatus] = useState(true);
  const [jobStaleStatusDays, setJobStaleStatusDays] = useState("7");
  const [overdueDays, setOverdueDays] = useState("30");

  const [currency, setCurrency] = useState("RSD");
  const [dateFormat, setDateFormat] = useState("dd.MM.yyyy");
  const [language, setLanguage] = useState("sr");
  const [timezone, setTimezone] = useState("Europe/Belgrade");
  const [customerPrefix, setCustomerPrefix] = useState("KU-");
  const [jobPrefix, setJobPrefix] = useState("P-");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [lockdownDialogOpen, setLockdownDialogOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      setIsInitialLoading(true);
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
          timezone,
          customer_prefix,
          job_prefix,
          maintenance_mode
        `
        )
        .eq("id", SETTINGS_ROW_ID)
        .maybeSingle<AppSettingsRow>();

      if (!isMounted) return;

      if (error) {
        toast.error(t("settings.toasts.loadError"));
        setIsInitialLoading(false);
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
        setTimezone(data.timezone);
        setCustomerPrefix(data.customer_prefix);
        setJobPrefix(data.job_prefix);
        setMaintenanceMode(data.maintenance_mode === true);
        writeAppSettingsCache({
          language: data.language === "en" ? "en" : "sr",
          dateFormat:
            data.date_format === "dd/MM/yyyy" || data.date_format === "yyyy-MM-dd"
              ? data.date_format
              : "dd.MM.yyyy",
          timezone: data.timezone,
          currency:
            data.currency === "EUR" || data.currency === "USD" ? data.currency : "RSD",
          overdueDays: data.overdue_days,
          customerPrefix: data.customer_prefix,
          jobPrefix: data.job_prefix,
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

      setIsInitialLoading(false);
    };

    loadSettings();

    return () => {
      isMounted = false;
    };
  }, [t]);

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
        timezone,
        customer_prefix: customerPrefix,
        job_prefix: jobPrefix,
        maintenance_mode: maintenanceMode,
      },
      { onConflict: "id" }
    );

    setIsSaving(false);

    if (error) {
      toast.error(t("settings.toasts.saveError"));
      return;
    }

    writeAppSettingsCache({
      language: language === "en" ? "en" : "sr",
      dateFormat:
        dateFormat === "dd/MM/yyyy" || dateFormat === "yyyy-MM-dd"
          ? dateFormat
          : "dd.MM.yyyy",
      timezone,
      currency: currency === "EUR" || currency === "USD" ? currency : "RSD",
      overdueDays: parsedOverdueDays,
      customerPrefix,
      jobPrefix,
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language === "en" ? "en" : "sr";
  }, [language]);

  useEffect(() => {
    if (activeLanguage !== language) {
      setLanguage(activeLanguage);
    }
  }, [activeLanguage, language]);

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: t("settings.pageTitle") }]} />
        <PageHeader
          title={t("settings.pageTitle")}
          description={t("settings.pageDescription")}
          icon={Settings}
          actions={
            <Button size="sm" onClick={handleSave} disabled={isInitialLoading || isSaving}>
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
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.pib")}</Label>
                  <Input value={companyPib} onChange={e => setCompanyPib(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.mb")}</Label>
                  <Input value={companyMb} onChange={e => setCompanyMb(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.address")}</Label>
                  <Input value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.phone")}</Label>
                  <Input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.email")}</Label>
                  <Input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.website")}</Label>
                  <Input value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} disabled={isInitialLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.company.logoUrl")}</Label>
                  <Input value={companyLogo} onChange={e => setCompanyLogo(e.target.value)} placeholder="https://..." disabled={isInitialLoading} />
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
                    <Switch checked={item.checked} onCheckedChange={item.onChange} disabled={isInitialLoading} />
                  </div>
                ))}
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.notifications.overdueDays")}</Label>
                  <Input type="number" value={overdueDays} onChange={e => setOverdueDays(e.target.value)} disabled={isInitialLoading} />
                  <p className="text-xs text-muted-foreground">{t("settings.notifications.overdueDaysHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.notifications.staleStatusDays")}</Label>
                  <Input type="number" value={jobStaleStatusDays} onChange={e => setJobStaleStatusDays(e.target.value)} disabled={isInitialLoading} />
                  <p className="text-xs text-muted-foreground">{t("settings.notifications.staleStatusDaysHint")}</p>
                </div>
              </div>

              {currentRole === "admin" ? (
                <>
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
                      disabled={isInitialLoading || maintenanceSaving || maintenanceMode}
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
                  <Select value={currency} onValueChange={setCurrency} disabled={isInitialLoading}>
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
                  <Select value={dateFormat} onValueChange={setDateFormat} disabled={isInitialLoading}>
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
                  <Select value={language} onValueChange={setLanguage} disabled={isInitialLoading}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sr">Srpski</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.preferences.timezone")}</Label>
                  <Select value={timezone} onValueChange={setTimezone} disabled={isInitialLoading}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Europe/Belgrade">Europe/Belgrade (CET)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.invoicing.customerPrefix")}</Label>
                  <Input value={customerPrefix} onChange={e => setCustomerPrefix(e.target.value)} disabled={isInitialLoading} />
                  <p className="text-xs text-muted-foreground">{t("settings.invoicing.example")} {customerPrefix}001</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("settings.invoicing.jobPrefix")}</Label>
                  <Input value={jobPrefix} onChange={e => setJobPrefix(e.target.value)} disabled={isInitialLoading} />
                  <p className="text-xs text-muted-foreground">{t("settings.invoicing.example")} {jobPrefix}2025-001</p>
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
