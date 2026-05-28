import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";
import {
  isAdditionalWorksChildJob,
  jobEligibleForInstallationScheduleBanner,
  jobHasOfficialInstallationSchedule,
  jobNeedsInstallationScheduleAttention,
  installationWorkOrdersHaveTeam,
} from "@/lib/job-additional-works-display";
import type { Job, UserRole, WorkOrderType } from "@/types";

/** Query key — promeniti pri promeni izvora (RPC / polja). */
export const DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY = ["dashboard-work-orders-missing-team"] as const;

export type UnscheduledDashboardWorkOrderRow = {
  workOrderId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  woType: WorkOrderType;
  woDescription: string;
  woStatus: string;
  /** Datum termina na RN merenja (ako je delimično unet). */
  scheduledDate?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** PostgREST / RPC ponekad vrati jedan red kao objekat umesto niza od jednog elementa. */
function normalizeRpcRowList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data != null && typeof data === "object" && !Array.isArray(data)) return [data];
  return [];
}

/** PostgREST ponekad ugnezdi jsonb odgovor ili vrati string. */
function unwrapDashboardUnscheduledJson(raw: unknown): Record<string, unknown> | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(v)) return null;
  if ("missing_team_rows" in v && "accepted_measurement_rows" in v) return v;
  for (const inner of Object.values(v)) {
    if (isRecord(inner) && "missing_team_rows" in inner && "accepted_measurement_rows" in inner) {
      return inner;
    }
  }
  return null;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "bigint") return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
  }
  return "";
}

function mapRpcRow(r: unknown): UnscheduledDashboardWorkOrderRow | null {
  if (!isRecord(r)) return null;
  const workOrderIdRaw = pickStr(r, ["work_order_id", "workOrderId"]);
  const jobId = pickStr(r, ["job_id", "jobId"]);
  if (!jobId || jobId === "undefined") return null;
  const workOrderId =
    workOrderIdRaw && workOrderIdRaw !== "undefined" && workOrderIdRaw.trim() !== ""
      ? workOrderIdRaw
      : `needs-measurement:${jobId}`;
  const sd = r.scheduled_date ?? r.scheduledDate;
  let scheduledDate: string | null = null;
  if (typeof sd === "string" && sd.trim()) scheduledDate = sd.trim().slice(0, 10);
  else if (sd != null && String(sd).trim()) scheduledDate = String(sd).trim().slice(0, 10);
  return {
    workOrderId,
    jobId,
    jobNumber: pickStr(r, ["job_number", "jobNumber"]),
    customerName: pickStr(r, ["customer_name", "customerName"]),
    woType: pickStr(r, ["wo_type", "woType"]) as WorkOrderType,
    woDescription: pickStr(r, ["wo_description", "woDescription"]),
    woStatus: pickStr(r, ["wo_status", "woStatus"]),
    scheduledDate: scheduledDate || null,
  };
}

function mapCustomerNameFromJob(raw: unknown): string {
  const row = (Array.isArray(raw) ? raw[0] : raw) as { name?: string } | null | undefined;
  const n = typeof row?.name === "string" ? row.name.trim() : "";
  return n || "—";
}

function mapFromSupabaseEmbed(r: Record<string, unknown>): UnscheduledDashboardWorkOrderRow | null {
  const job = r.job as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const jobOne = Array.isArray(job) ? job[0] : job;
  if (!jobOne) return null;
  const jobIdRaw = jobOne.id;
  const jobId = typeof jobIdRaw === "string" ? jobIdRaw : String(jobIdRaw ?? "");
  if (!jobId) return null;
  const jobStatus = typeof jobOne.status === "string" ? jobOne.status : "";
  if (jobStatus === "canceled" || jobStatus === "completed") return null;
  const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
  if (!id || !jobId) return null;
  return {
    workOrderId: id,
    jobId,
    jobNumber: String(jobOne.job_number ?? ""),
    customerName: mapCustomerNameFromJob(jobOne.customers),
    woType: r.type as WorkOrderType,
    woDescription: typeof r.description === "string" ? r.description : "",
    woStatus: typeof r.status === "string" ? r.status : "",
    scheduledDate:
      r.date != null && String(r.date).trim()
        ? String(r.date).slice(0, 10)
        : null,
  };
}

function partition(rows: UnscheduledDashboardWorkOrderRow[]) {
  const measurement = rows.filter((x) =>
    (MEASUREMENT_WORK_ORDER_TYPES as readonly string[]).includes(x.woType),
  );
  const installation = rows.filter((x) => x.woType === INSTALLATION_WORK_ORDER_TYPE);
  const production = rows.filter((x) => x.woType === PRODUCTION_WORK_ORDER_TYPE);
  const complaint = rows.filter((x) => x.woType === "complaint");
  const service = rows.filter((x) => x.woType === "service");
  return {
    measurement,
    installation,
    production,
    complaint,
    service,
    acceptedNeedsMeasurement: [] as UnscheduledDashboardWorkOrderRow[],
    all: rows,
  };
}

async function fetchAcceptedNeedsMeasurementFallback(): Promise<UnscheduledDashboardWorkOrderRow[]> {
  const { data: jobs, error: jErr } = await supabase
    .from("jobs")
    .select("id, job_number, status, customer_id, customers(name)")
    .in("status", ["accepted", "measuring"])
    .order("created_at", { ascending: false })
    .limit(400);
  if (jErr) throw jErr;
  const jobList = (jobs ?? []) as Record<string, unknown>[];
  if (jobList.length === 0) return [];

  const jobIds = jobList.map((j) => String(j.id ?? "")).filter(Boolean);
  const { data: wos, error: wErr } = await supabase
    .from("work_orders")
    .select("id, job_id, type, description, status, date, team_id")
    .in("job_id", jobIds)
    .in("type", [...MEASUREMENT_WORK_ORDER_TYPES])
    .in("status", ["pending", "in_progress"]);
  if (wErr) throw wErr;

  const byJob = new Map<string, Record<string, unknown>[]>();
  for (const wo of wos ?? []) {
    if (!isRecord(wo)) continue;
    const jidRaw = wo.job_id;
    const jid = typeof jidRaw === "string" ? jidRaw : String(jidRaw ?? "");
    if (!jid) continue;
    if (!byJob.has(jid)) byJob.set(jid, []);
    byJob.get(jid)!.push(wo);
  }

  const defDesc = "Potrebno je zakazati merenje i dodeliti tim (kartica posla).";
  const out: UnscheduledDashboardWorkOrderRow[] = [];

  for (const rec of jobList) {
    const jobId = String(rec.id ?? "");
    if (!jobId) continue;
    const list = byJob.get(jobId) ?? [];

    if (list.length > 0) {
      const allFullyScheduled = list.every((w) => {
        const tid = w.team_id;
        const d = w.date;
        return tid != null && d != null && String(d).trim() !== "";
      });
      if (allFullyScheduled) continue;
    }

    let best: Record<string, unknown> | null = null;
    if (list.length > 0) {
      const sorted = [...list].sort((a, b) => {
        const ta = a.team_id != null ? 1 : 0;
        const tb = b.team_id != null ? 1 : 0;
        if (tb !== ta) return tb - ta;
        const da = a.date != null && String(a.date).trim() ? 1 : 0;
        const db = b.date != null && String(b.date).trim() ? 1 : 0;
        return db - da;
      });
      best = sorted[0] ?? null;
    }

    const jobNumber = String(rec.job_number ?? "");
    const customerName = mapCustomerNameFromJob(rec.customers);
    const dateStr =
      best?.date != null && String(best.date).trim() ? String(best.date).slice(0, 10) : null;
    const woId = best?.id != null && String(best.id).trim() ? String(best.id) : `needs-measurement:${jobId}`;
    const woType = (typeof best?.type === "string" ? best.type : "measurement") as WorkOrderType;
    const woDescRaw = typeof best?.description === "string" ? best.description.trim() : "";
    const woDesc = woDescRaw || defDesc;
    const woSt = typeof best?.status === "string" ? best.status : "pending";

    out.push({
      workOrderId: woId,
      jobId,
      jobNumber,
      customerName,
      woType,
      woDescription: woDesc,
      woStatus: woSt,
      scheduledDate: dateStr,
    });
  }

  out.sort((a, b) => (b.jobNumber || "").localeCompare(a.jobNumber || ""));
  return out;
}

async function fetchMissingTeamViaDirectSelect(): Promise<ReturnType<typeof partition>> {
  const types = [
    "measurement",
    "measurement_verification",
    "installation",
    PRODUCTION_WORK_ORDER_TYPE,
    "complaint",
    "service",
  ] as const;

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      `
      id,
      job_id,
      type,
      description,
      status,
      job:jobs (
        id,
        job_number,
        status,
        customers ( name )
      )
    `,
    )
    .in("type", [...types])
    .in("status", ["pending", "in_progress"])
    .is("team_id", null)
    .limit(400);

  if (error) throw error;

  const rows: UnscheduledDashboardWorkOrderRow[] = [];
  for (const raw of data ?? []) {
    if (!isRecord(raw)) continue;
    const row = mapFromSupabaseEmbed(raw);
    if (row) rows.push(row);
  }
  return partition(rows);
}

/** Iste uloge kao u RPC za kontrolnu tablu — direktan SELECT na work_orders kada RPC nedostaje. */
function canUseDashboardWorkOrdersTableFallback(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "office" || role === "finance";
}

/** Lista „Prihvaćeno / merenje — tim i termin“ preko jobs + work_orders (ne zavisi isključivo od RPC migracije). */
function canUseAcceptedMeasurementClientList(role: UserRole | null | undefined): boolean {
  return canUseDashboardWorkOrdersTableFallback(role);
}

/**
 * RN merenja / ugradnje / proizvodnje bez dodeljenog tima.
 * Prvenstveno: jedan SECURITY DEFINER RPC (JSON). Rezerva: stari RPC + klijentski upit.
 */
export function useUnscheduledWorkOrdersDashboard(enabled: boolean, currentRole: UserRole | null | undefined) {
  return useQuery({
    queryKey: [...DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY, currentRole ?? "none", "v6"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const combined = await supabase.rpc("get_dashboard_unscheduled_work_orders_json");
      const payload =
        combined.error == null ? unwrapDashboardUnscheduledJson(combined.data) : null;
      if (payload) {
        const rawMissing = normalizeRpcRowList(payload.missing_team_rows);
        const rawAccepted = normalizeRpcRowList(payload.accepted_measurement_rows);
        const rows: UnscheduledDashboardWorkOrderRow[] = [];
        for (const item of rawMissing) {
          const row = mapRpcRow(item);
          if (row) rows.push({ ...row, scheduledDate: null });
        }
        const part = partition(rows);
        const acc: UnscheduledDashboardWorkOrderRow[] = [];
        for (const item of rawAccepted) {
          const row = mapRpcRow(item);
          if (row) acc.push(row);
        }
        return { ...part, acceptedNeedsMeasurement: acc };
      }

      if (combined.error) {
        const msg = combined.error.message ?? "";
        if (!/function .* does not exist|Could not find the function/i.test(msg)) {
          console.warn("[dashboard] get_dashboard_unscheduled_work_orders_json:", msg);
        }
      }

      const rpcMissing = await supabase.rpc("list_work_orders_missing_team_for_dashboard");

      if (rpcMissing.error == null) {
        const rows: UnscheduledDashboardWorkOrderRow[] = [];
        const rawList = normalizeRpcRowList(rpcMissing.data);
        for (const item of rawList) {
          const row = mapRpcRow(item);
          if (row) rows.push({ ...row, scheduledDate: null });
        }
        const part = partition(rows);

        let acc: UnscheduledDashboardWorkOrderRow[] = [];
        if (canUseAcceptedMeasurementClientList(currentRole)) {
          try {
            acc = await fetchAcceptedNeedsMeasurementFallback();
          } catch (e) {
            console.warn("[dashboard] accepted-measurement client list failed:", e);
          }
        }
        if (acc.length === 0) {
          const rpcAccepted = await supabase.rpc("list_accepted_needs_measurement_schedule_for_dashboard");
          if (rpcAccepted.error == null) {
            for (const item of normalizeRpcRowList(rpcAccepted.data)) {
              const row = mapRpcRow(item);
              if (row) acc.push(row);
            }
          } else {
            console.warn(
              "[dashboard] list_accepted_needs_measurement_schedule_for_dashboard:",
              rpcAccepted.error.message,
            );
          }
        }

        return { ...part, acceptedNeedsMeasurement: acc };
      }

      if (canUseDashboardWorkOrdersTableFallback(currentRole)) {
        try {
          const part = await fetchMissingTeamViaDirectSelect();
          let acc: UnscheduledDashboardWorkOrderRow[] = [];
          if (canUseAcceptedMeasurementClientList(currentRole)) {
            try {
              acc = await fetchAcceptedNeedsMeasurementFallback();
            } catch (e) {
              console.warn("[dashboard] accepted-measurement client list (RPC missing-team failed):", e);
            }
          }
          if (acc.length === 0) {
            const rpcAccepted = await supabase.rpc("list_accepted_needs_measurement_schedule_for_dashboard");
            if (rpcAccepted.error == null) {
              for (const item of normalizeRpcRowList(rpcAccepted.data)) {
                const row = mapRpcRow(item);
                if (row) acc.push(row);
              }
            }
          }
          return { ...part, acceptedNeedsMeasurement: acc };
        } catch (fbErr) {
          console.warn("[dashboard-work-orders-missing-team] RPC failed, fallback failed:", rpcMissing.error, fbErr);
        }
      }

      throw rpcMissing.error ?? combined.error ?? new Error("Dashboard RN upit nije uspeo.");
    },
  });
}

/** Lista „Prihvaćeno / merenje“ iz već učitanih poslova + work_orders (bez RPC / get_current_user_role). */
export const DASHBOARD_ACCEPTED_MEASUREMENT_FROM_JOBS_QUERY_KEY = ["dashboard-accepted-measurement-from-jobs"] as const;

export function useAcceptedMeasurementDashboardBanner(jobs: Job[], enabled: boolean) {
  const subset = useMemo(
    () => jobs.filter((j) => j.status === "accepted" || j.status === "measuring").slice(0, 400),
    [jobs],
  );
  const keySig = useMemo(
    () =>
      subset
        .map((j) => `${j.id}:${j.status}`)
        .sort()
        .join("|"),
    [subset],
  );

  return useQuery({
    queryKey: [...DASHBOARD_ACCEPTED_MEASUREMENT_FROM_JOBS_QUERY_KEY, keySig],
    enabled: enabled && subset.length > 0,
    staleTime: 10_000,
    queryFn: async (): Promise<UnscheduledDashboardWorkOrderRow[]> => {
      if (subset.length === 0) return [];

      const jobIds = subset.map((j) => j.id);
      const allWos: Record<string, unknown>[] = [];
      const CHUNK = 80;
      for (let i = 0; i < jobIds.length; i += CHUNK) {
        const chunk = jobIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("work_orders")
          .select("id, job_id, type, description, status, date, team_id")
          .in("job_id", chunk)
          .in("type", [...MEASUREMENT_WORK_ORDER_TYPES])
          .in("status", ["pending", "in_progress"]);
        if (error) throw error;
        for (const row of data ?? []) {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            allWos.push(row as Record<string, unknown>);
          }
        }
      }

      const byJob = new Map<string, Record<string, unknown>[]>();
      for (const wo of allWos) {
        const jidRaw = wo.job_id;
        const jid = typeof jidRaw === "string" ? jidRaw : String(jidRaw ?? "");
        if (!jid) continue;
        if (!byJob.has(jid)) byJob.set(jid, []);
        byJob.get(jid)!.push(wo);
      }

      const defDesc = "Potrebno je zakazati merenje i dodeliti tim (kartica posla).";
      const out: UnscheduledDashboardWorkOrderRow[] = [];

      for (const job of subset) {
        const list = byJob.get(job.id) ?? [];
        if (list.length > 0) {
          const allFullyScheduled = list.every((w) => {
            const tid = w.team_id;
            const d = w.date;
            return tid != null && d != null && String(d).trim() !== "";
          });
          if (allFullyScheduled) continue;
        }

        let best: Record<string, unknown> | null = null;
        if (list.length > 0) {
          const sorted = [...list].sort((a, b) => {
            const ta = a.team_id != null ? 1 : 0;
            const tb = b.team_id != null ? 1 : 0;
            if (tb !== ta) return tb - ta;
            const da = a.date != null && String(a.date).trim() ? 1 : 0;
            const db = b.date != null && String(b.date).trim() ? 1 : 0;
            return db - da;
          });
          best = sorted[0] ?? null;
        }

        const dateStr =
          best?.date != null && String(best.date).trim() ? String(best.date).slice(0, 10) : null;
        const woId = best?.id != null && String(best.id).trim() ? String(best.id) : `needs-measurement:${job.id}`;
        const woType = (typeof best?.type === "string" ? best.type : "measurement") as WorkOrderType;
        const woDescRaw = typeof best?.description === "string" ? best.description.trim() : "";
        const woDesc = woDescRaw || defDesc;
        const woSt = typeof best?.status === "string" ? best.status : "pending";
        const customerName = job.customer?.fullName?.trim() || "—";

        out.push({
          workOrderId: woId,
          jobId: job.id,
          jobNumber: job.jobNumber,
          customerName,
          woType,
          woDescription: woDesc,
          woStatus: woSt,
          scheduledDate: dateStr,
        });
      }

      out.sort((a, b) => (b.jobNumber || "").localeCompare(a.jobNumber || ""));
      return out;
    },
  });
}

/** Poslovi u statusu „Čeka ugradnju“ bez termina (posao ili RN) i/ili bez tima na RN ugradnje. */
export const DASHBOARD_NEEDS_INSTALLATION_SCHEDULE_FROM_JOBS_QUERY_KEY = [
  "dashboard-needs-installation-schedule-from-jobs",
] as const;

export function useNeedsInstallationScheduleDashboard(jobs: Job[], enabled: boolean) {
  const subset = useMemo(
    () => jobs.filter(jobEligibleForInstallationScheduleBanner).slice(0, 400),
    [jobs],
  );
  const keySig = useMemo(
    () =>
      subset
        .map((j) => `${j.id}:${j.status}:${j.scheduledAt ?? ""}`)
        .sort()
        .join("|"),
    [subset],
  );

  return useQuery({
    queryKey: [...DASHBOARD_NEEDS_INSTALLATION_SCHEDULE_FROM_JOBS_QUERY_KEY, keySig],
    enabled: enabled && subset.length > 0,
    staleTime: 10_000,
    queryFn: async (): Promise<UnscheduledDashboardWorkOrderRow[]> => {
      if (subset.length === 0) return [];

      const jobIds = subset.map((j) => j.id);
      const allWos: Record<string, unknown>[] = [];
      const CHUNK = 80;
      for (let i = 0; i < jobIds.length; i += CHUNK) {
        const chunk = jobIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("work_orders")
          .select("id, job_id, type, description, status, date, team_id")
          .in("job_id", chunk)
          .eq("type", INSTALLATION_WORK_ORDER_TYPE)
          .in("status", ["pending", "in_progress"]);
        if (error) throw error;
        for (const row of data ?? []) {
          if (row && typeof row === "object" && !Array.isArray(row)) {
            allWos.push(row as Record<string, unknown>);
          }
        }
      }

      const byJob = new Map<string, Record<string, unknown>[]>();
      for (const wo of allWos) {
        const jidRaw = wo.job_id;
        const jid = typeof jidRaw === "string" ? jidRaw : String(jidRaw ?? "");
        if (!jid) continue;
        if (!byJob.has(jid)) byJob.set(jid, []);
        byJob.get(jid)!.push(wo);
      }

      const defDesc =
        "Potrebno je zakazati ugradnju i dodeliti montažni tim (dugme „Zakaži ugradnju“ na kartici posla).";
      const childDefDesc =
        "Pod-posao: zakažite ugradnju na kartici tog posla (ne na roditelju). Termin i tim idu na RN ugradnje ovog posla.";
      const out: UnscheduledDashboardWorkOrderRow[] = [];

      for (const job of subset) {
        const list = byJob.get(job.id) ?? [];
        if (!jobNeedsInstallationScheduleAttention(job, list)) continue;

        const isChild = isAdditionalWorksChildJob(job);
        const hasSchedule = jobHasOfficialInstallationSchedule(job, list);
        const hasTeam = installationWorkOrdersHaveTeam(list);
        const sorted = [...list].sort((a, b) => {
          const ta = a.team_id != null ? 1 : 0;
          const tb = b.team_id != null ? 1 : 0;
          if (tb !== ta) return tb - ta;
          const da = a.date != null && String(a.date).trim() ? 1 : 0;
          const db = b.date != null && String(b.date).trim() ? 1 : 0;
          return db - da;
        });
        const best = sorted[0] ?? null;

        const dateStr =
          best?.date != null && String(best.date).trim() ? String(best.date).slice(0, 10) : null;
        const woId =
          best?.id != null && String(best.id).trim() ? String(best.id) : `needs-installation:${job.id}`;
        const woDescRaw = typeof best?.description === "string" ? best.description.trim() : "";
        const missingBits: string[] = [];
        if (!hasSchedule) missingBits.push("termin ugradnje na poslu");
        if (!hasTeam) missingBits.push("montažni tim na nalogu ugradnje");
        const missingHint =
          missingBits.length > 0
            ? `Potrebno: ${missingBits.join(" i ")} — „Zakaži ugradnju“ na kartici posla.`
            : isChild
              ? childDefDesc
              : defDesc;
        const woDesc = woDescRaw || missingHint;
        const woSt = typeof best?.status === "string" ? best.status : "pending";
        const customerName = job.customer?.fullName?.trim() || "—";
        const jobNumberDisplay = isChild ? `${job.jobNumber} (pod-posao)` : job.jobNumber;

        out.push({
          workOrderId: woId,
          jobId: job.id,
          jobNumber: jobNumberDisplay,
          customerName,
          woType: INSTALLATION_WORK_ORDER_TYPE,
          woDescription: woDesc,
          woStatus: woSt,
          scheduledDate: dateStr,
        });
      }

      out.sort((a, b) => (b.jobNumber || "").localeCompare(a.jobNumber || ""));
      return out;
    },
  });
}
