import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { formatQueryError } from "@/lib/utils";

export const SALES_DASHBOARD_ALERTS_QUERY_KEY = ["sales-dashboard-alerts"] as const;

export type SalesFollowupWorkOrderAlert = {
  workOrderId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  woType: string;
  woDescription: string;
  woDate: string;
  woStatus: string;
  alertKey: string;
  workerReportContext: string;
};

export type SalesAddonSiteQuoteAlert = {
  alertId: string;
  jobId: string;
  jobNumber: string;
  workerText: string;
  createdAt: string;
  alertKey: string;
  fieldReportId: string;
  sourceWorkOrderId: string;
};

export type SalesAlertNoteRow = {
  alertKey: string;
  note: string;
  updatedAt: string | null;
};

export function useSalesDashboardAlerts(enabled: boolean) {
  return useQuery({
    queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [{ data: followRaw, error: followErr }, { data: addonRaw, error: addonErr }] = await Promise.all([
        supabase.rpc("list_sales_installation_problem_followup_work_orders"),
        supabase.rpc("list_sales_site_addon_quote_alerts"),
      ]);

      if (followErr) throw followErr;
      if (addonErr) throw addonErr;

      const followups: SalesFollowupWorkOrderAlert[] = (followRaw ?? []).map(
        (r: Record<string, unknown>) => ({
          workOrderId: String(r.work_order_id),
          jobId: String(r.job_id),
          jobNumber: String(r.job_number ?? ""),
          customerName: String(r.customer_name ?? ""),
          woType: String(r.wo_type ?? ""),
          woDescription: String(r.wo_description ?? ""),
          woDate: String(r.wo_date ?? ""),
          woStatus: String(r.wo_status ?? ""),
          alertKey: String(r.alert_key ?? ""),
          workerReportContext: String(r.worker_report_context ?? ""),
        }),
      );

      const addonSiteQuotes: SalesAddonSiteQuoteAlert[] = (addonRaw ?? []).map((r: Record<string, unknown>) => {
        const id = String(r.alert_id);
        return {
          alertId: id,
          jobId: String(r.job_id),
          jobNumber: String(r.job_number ?? ""),
          workerText: String(r.worker_text ?? ""),
          createdAt: String(r.created_at ?? ""),
          alertKey: `addon-site-quote:${id}`,
          fieldReportId: String(r.field_report_id ?? ""),
          sourceWorkOrderId: String(r.source_work_order_id ?? ""),
        };
      });

      const keys = [...followups.map((f) => f.alertKey), ...addonSiteQuotes.map((a) => a.alertKey)];

      let notes: SalesAlertNoteRow[] = [];
      if (keys.length > 0) {
        const { data: noteRows, error: noteErr } = await supabase
          .from("sales_alert_notes")
          .select("alert_key, note, updated_at")
          .in("alert_key", keys);
        if (noteErr) throw noteErr;
        notes = (noteRows ?? []).map((n: Record<string, unknown>) => ({
          alertKey: String(n.alert_key),
          note: String(n.note ?? ""),
          updatedAt: typeof n.updated_at === "string" ? n.updated_at : null,
        }));
      }

      const noteByKey: Record<string, SalesAlertNoteRow> = {};
      for (const n of notes) {
        noteByKey[n.alertKey] = n;
      }

      return { followups, addonSiteQuotes, noteByKey };
    },
  });
}

export function useUpsertSalesAlertNote() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { alertKey: string; note: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id ?? null;

      const { error } = await supabase.from("sales_alert_notes").upsert(
        {
          alert_key: payload.alertKey,
          note: payload.note,
          updated_by: uid,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "alert_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
      toast({ title: "Beleška sačuvana" });
    },
    onError: (e) => {
      toast({
        title: "Greška",
        description: e instanceof Error ? e.message : "Čuvanje nije uspelo.",
        variant: "destructive",
      });
    },
  });
}

export function useDismissSalesAddonSiteQuoteAlert() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc("dismiss_sales_site_addon_quote_alert", {
        p_alert_id: alertId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
    },
    onError: (e) => {
      toast({
        title: "Greška",
        description: e instanceof Error ? e.message : "Zatvaranje nije uspelo.",
        variant: "destructive",
      });
    },
  });
}

export function useCreateChildJobFromAddonSiteQuoteAlert() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { data, error } = await supabase.rpc("create_child_job_from_addon_site_quote_alert", {
        p_alert_id: alertId,
      });
      if (error) throw error;
      const id = typeof data === "string" ? data : data != null ? String(data) : "";
      if (!id) throw new Error("Kreiranje pod-posla nije vratilo ID.");
      return id;
    },
    onSuccess: (newJobId) => {
      void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job", newJobId] });
      void queryClient.invalidateQueries({ queryKey: ["job-additional-works-children"] });
      toast({ title: "Novi posao kreiran", description: "Otvoren je pod-posao za dodatne radove; ponude i tok su na tom poslu." });
    },
    onError: (e) => {
      toast({
        title: "Greška",
        description: formatQueryError(e),
        variant: "destructive",
      });
    },
  });
}
