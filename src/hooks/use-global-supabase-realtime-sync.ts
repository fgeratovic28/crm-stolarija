import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY } from "@/hooks/use-unscheduled-work-orders-dashboard";
import { URGENT_SITE_MISSING_QUERY_KEY } from "@/hooks/use-urgent-site-missing-notifications";
import { SALES_DASHBOARD_ALERTS_QUERY_KEY } from "@/hooks/use-sales-dashboard-alerts";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import { invalidateWorkOrderQueries, patchWorkOrderInAllCaches } from "@/lib/work-order-query-cache";
import type { WorkOrder } from "@/types";

/**
 * Jedna mreža Supabase Realtime pretplata za ceo CRM (posle uspešne prijave).
 * Invalidira React Query keš kad drugi korisnik ili pozadinski proces promeni red u bazi.
 */
export function useGlobalSupabaseRealtimeSync(enabled: boolean) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const instanceRef = useRef(`crm-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!enabled) return;

    const channelPrefix = `crm-live:${instanceRef.current}`;

    const invalidateCore = () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs-list-simple"] });
      void queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      void queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
    };

    const invalidateForJobId = (jobId: string | undefined) => {
      if (!jobId) return;
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["work-orders", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["field-reports", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["activities", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["payments", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["files", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["job-items", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["material-orders", jobId] });
    };

    const invalidateJobsTable = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      invalidateCore();
      const newId = typeof payload.new?.id === "string" ? payload.new.id : undefined;
      const oldId = typeof payload.old?.id === "string" ? payload.old.id : undefined;
      invalidateForJobId(newId ?? oldId);
    };

    const invalidateByJobIdPayload = (
      payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
      key: "job_id" | "id",
    ) => {
      invalidateCore();
      const newId = typeof payload.new?.[key] === "string" ? (payload.new[key] as string) : undefined;
      const oldId = typeof payload.old?.[key] === "string" ? (payload.old[key] as string) : undefined;
      invalidateForJobId(newId ?? oldId);
    };

    const invalidateUrgentProcurementAndStats = () => {
      void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    };

    const jobsChannel = supabase
      .channel(`${channelPrefix}:jobs`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, invalidateJobsTable)
      .subscribe();

    const paymentsChannel = supabase
      .channel(`${channelPrefix}:payments`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, (payload) =>
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id"),
      )
      .subscribe();

    const workOrdersChannel = supabase
      .channel(`${channelPrefix}:work-orders`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, (payload) => {
        const p = payload as { new?: Record<string, unknown>; old?: Record<string, unknown> };
        const row = p.new ?? p.old;
        const jid = typeof row?.job_id === "string" ? row.job_id : undefined;
        const oid = typeof row?.id === "string" ? row.id : undefined;
        const status = typeof row?.status === "string" ? (row.status as WorkOrder["status"]) : undefined;
        if (oid && status) {
          patchWorkOrderInAllCaches(queryClient, oid, { status });
        }
        invalidateWorkOrderQueries(queryClient, jid);
        invalidateByJobIdPayload(p, "job_id");
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY, refetchType: "active" });
        void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY, refetchType: "active" });
      })
      .subscribe();

    const fieldReportsChannel = supabase
      .channel(`${channelPrefix}:field-reports`)
      .on("postgres_changes", { event: "*", schema: "public", table: "field_reports" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
        void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
      })
      .subscribe();

    const materialOrdersChannel = supabase
      .channel(`${channelPrefix}:material-orders`)
      .on("postgres_changes", { event: "*", schema: "public", table: "material_orders" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
        void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
        void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
        const row = (payload as { new?: Record<string, unknown> }).new ?? (payload as { old?: Record<string, unknown> }).old;
        const oid = typeof row?.id === "string" ? row.id : undefined;
        if (oid) void queryClient.invalidateQueries({ queryKey: ["material-order", oid] });
      })
      .subscribe();

    const salesAlertNotesChannel = supabase
      .channel(`${channelPrefix}:sales-alert-notes`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_alert_notes" }, () => {
        void queryClient.invalidateQueries({ queryKey: SALES_DASHBOARD_ALERTS_QUERY_KEY });
      })
      .subscribe();

    const procurementAdHocChannel = supabase
      .channel(`${channelPrefix}:procurement-ad-hoc-items`)
      .on("postgres_changes", { event: "*", schema: "public", table: "procurement_ad_hoc_items" }, () => {
        invalidateUrgentProcurementAndStats();
      })
      .subscribe();

    const invoiceMissingLinkChannel = supabase
      .channel(`${channelPrefix}:invoice-missing-site-procurement`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_missing_site_procurement" }, () => {
        void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      })
      .subscribe();

    const procurementComplaintsChannel = supabase
      .channel(`${channelPrefix}:procurement-complaints`)
      .on("postgres_changes", { event: "*", schema: "public", table: "procurement_complaints" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["procurement-complaints"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      })
      .subscribe();

    const activitiesChannel = supabase
      .channel(`${channelPrefix}:activities`)
      .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
        void queryClient.invalidateQueries({ queryKey: ["activities"] });
      })
      .subscribe();

    const quotesChannel = supabase
      .channel(`${channelPrefix}:quotes`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
      })
      .subscribe();

    const jobItemsChannel = supabase
      .channel(`${channelPrefix}:job-items`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_items" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
      })
      .subscribe();

    const filesChannel = supabase
      .channel(`${channelPrefix}:files`)
      .on("postgres_changes", { event: "*", schema: "public", table: "files" }, (payload) => {
        invalidateByJobIdPayload(payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }, "job_id");
        void queryClient.invalidateQueries({ queryKey: ["files"] });
        void queryClient.invalidateQueries({ queryKey: ["files", "all"] });
        invalidateFilesStorageUsage(queryClient);
      })
      .subscribe();

    const workOrderItemsChannel = supabase
      .channel(`${channelPrefix}:work-order-items`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_order_items" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
      })
      .subscribe();

    const customersChannel = supabase
      .channel(`${channelPrefix}:customers`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["customers"] });
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
      })
      .subscribe();

    const suppliersChannel = supabase
      .channel(`${channelPrefix}:suppliers`)
      .on("postgres_changes", { event: "*", schema: "public", table: "suppliers" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      })
      .subscribe();

    const userNotificationsChannel =
      user?.id != null
        ? supabase
            .channel(`${channelPrefix}:user-notifications:${user.id}`)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "user_notifications",
                filter: `user_id=eq.${user.id}`,
              },
              () => {
                void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
                void queryClient.invalidateQueries({ queryKey: ["notifications"] });
              },
            )
            .subscribe()
        : null;

    return () => {
      void supabase.removeChannel(jobsChannel);
      void supabase.removeChannel(paymentsChannel);
      void supabase.removeChannel(workOrdersChannel);
      void supabase.removeChannel(fieldReportsChannel);
      void supabase.removeChannel(materialOrdersChannel);
      void supabase.removeChannel(salesAlertNotesChannel);
      void supabase.removeChannel(procurementAdHocChannel);
      void supabase.removeChannel(invoiceMissingLinkChannel);
      void supabase.removeChannel(procurementComplaintsChannel);
      void supabase.removeChannel(activitiesChannel);
      void supabase.removeChannel(quotesChannel);
      void supabase.removeChannel(jobItemsChannel);
      void supabase.removeChannel(filesChannel);
      void supabase.removeChannel(workOrderItemsChannel);
      void supabase.removeChannel(customersChannel);
      void supabase.removeChannel(suppliersChannel);
      if (userNotificationsChannel) void supabase.removeChannel(userNotificationsChannel);
    };
  }, [enabled, queryClient, user?.id]);
}
