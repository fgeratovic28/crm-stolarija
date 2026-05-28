import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";
import type { JobStatus, QuoteStatus, WorkOrderType } from "@/types";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";
import { materialOrderDeliveryResolved } from "@/lib/material-order-delivery-resolved";
import { quoteInPostMeasurementCycle } from "@/lib/quote-post-measurement-cycle";

type WorkOrderStatus = "pending" | "in_progress" | "completed" | "canceled";

type WorkOrderRow = { id?: string; status: WorkOrderStatus; type: WorkOrderType };
type MaterialOrderDeliveryStatus =
  | "pending"
  | "email_sent"
  | "sent_to_supplier"
  | "waiting_for_payment"
  | "waiting_for_delivery"
  | "shipped"
  | "delivered"
  | "partial"
  | "materials_received"
  | "received_with_issues";
type MaterialOrderRow = {
  id?: string;
  delivery_status: MaterialOrderDeliveryStatus | string;
  parent_order_id?: string | null;
  is_shortage_order?: boolean | null;
  required_for_production_start?: boolean | null;
};

type QuoteRow = {
  status: QuoteStatus;
  created_at?: string | null;
  updated_at?: string | null;
  version_number?: number | null;
  is_final?: boolean | null;
};
type FieldReportRow = {
  work_order_id: string | null;
  everything_ok: boolean | null;
  site_canceled: boolean | null;
  completed: boolean | null;
  created_at?: string | null;
  details?: { arrivedAt?: string; canceledAt?: string; finishedAt?: string } | null;
};

/** Statusi koje automatska pravila ne menjaju dok su aktivni (ručni režimi). */
const PRESERVED_MANUAL_AUTOMATION_STATUSES = new Set<JobStatus>([
  "service",
  "canceled",
]);

function automationSkipsRecompute(current: JobStatus): boolean {
  return PRESERVED_MANUAL_AUTOMATION_STATUSES.has(current);
}

function isMissingTableError(code?: string) {
  return code === "42P01" || code === "PGRST205";
}

/** PostgREST uses PGRST202 when the RPC is not in the schema cache / not found. */
function isMissingRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42883" || e.code === "PGRST202") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return msg.includes("recompute_job_status") && msg.includes("Could not find");
}

function terminalWo(s: WorkOrderStatus): boolean {
  return s === "completed" || s === "canceled";
}

type PaymentRow = {
  amount: number;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function parseIsoTs(s: string | null | undefined): number {
  if (!s || typeof s !== "string") return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function belgradeCalendarDateFromMs(ms: number): string {
  if (ms <= 0) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date(ms));
}

/** Ista logika kao SQL `payment_qualifies_after_accept_anchor` (bez +12h na datum). */
function paymentQualifiesAfterAcceptAnchor(p: PaymentRow, anchorMs: number): boolean {
  const amt = Number(p.amount) || 0;
  if (amt <= 0 || anchorMs <= 0) return false;
  const recorded = Math.max(
    parseIsoTs(p.updated_at ?? undefined),
    parseIsoTs(p.created_at ?? undefined),
  );
  if (recorded >= anchorMs) return true;
  const anchorDate = belgradeCalendarDateFromMs(anchorMs);
  const payDate = (typeof p.date === "string" ? p.date.trim() : "").slice(0, 10);
  return anchorDate.length === 10 && payDate.length === 10 && payDate >= anchorDate;
}

function hasRecordedPaymentOnOrAfter(payments: PaymentRow[], thresholdMs: number): boolean {
  if (thresholdMs <= 0) return false;
  return payments.some((p) => paymentQualifiesAfterAcceptAnchor(p, thresholdMs));
}

function acceptAnchorMsForAcceptedPostMeasurementQuotes(quotes: QuoteRow[]): number {
  let maxTs = 0;
  for (const q of quotes) {
    if (q.status !== "accepted") continue;
    const t = Math.max(parseIsoTs(q.updated_at ?? undefined), parseIsoTs(q.created_at ?? undefined));
    maxTs = Math.max(maxTs, t);
  }
  return maxTs;
}

/** Ponude u post-mernom ciklusu (isti filter kao u SQL `recompute_job_status`). */
function filterPostMeasurementQuotes(quotes: QuoteRow[], measurementFinishedAtMs: number): QuoteRow[] {
  return quotes.filter((q) =>
    quoteInPostMeasurementCycle(
      {
        isFinalOffer: q.is_final === true,
        versionNumber: q.version_number ?? 1,
        createdAt: q.created_at ?? undefined,
      },
      measurementFinishedAtMs,
    ),
  );
}

function postMeasurementAcceptancePaymentContext(
  postMeasurementQuotes: QuoteRow[],
  measurementFinishedAtMs: number,
  postMeasurementKeepInitialQuote: boolean | undefined,
  payments: PaymentRow[] | undefined,
): {
  hasPostMeasurementAccepted: boolean;
  keepsInitialQuoteAfterMeasurement: boolean;
  hasPaymentAfterFinalAcceptance: boolean;
} {
  const hasPostMeasurementAccepted = postMeasurementQuotes.some((q) => q.status === "accepted");
  const keepsInitialQuoteAfterMeasurement = postMeasurementKeepInitialQuote === true;
  const paymentsRows = payments ?? [];
  let finalAcceptAnchorMs = 0;
  if (hasPostMeasurementAccepted) {
    finalAcceptAnchorMs = Math.max(
      finalAcceptAnchorMs,
      acceptAnchorMsForAcceptedPostMeasurementQuotes(
        postMeasurementQuotes.filter((q) => q.status === "accepted"),
      ),
    );
  }
  if (keepsInitialQuoteAfterMeasurement && measurementFinishedAtMs > 0) {
    finalAcceptAnchorMs = Math.max(finalAcceptAnchorMs, measurementFinishedAtMs);
  }
  const hasPaymentAfterFinalAcceptance =
    (hasPostMeasurementAccepted || keepsInitialQuoteAfterMeasurement) &&
    finalAcceptAnchorMs > 0 &&
    hasRecordedPaymentOnOrAfter(paymentsRows, finalAcceptAnchorMs);
  return {
    hasPostMeasurementAccepted,
    keepsInitialQuoteAfterMeasurement,
    hasPaymentAfterFinalAcceptance,
  };
}

type DeriveStatusResult = { status: JobStatus; reason: string };

type JobStatusDeriveContext = {
  workOrders: WorkOrderRow[];
  quotes: QuoteRow[];
  materialOrders: MaterialOrderRow[];
  fieldReports: FieldReportRow[];
  totalPrice: number;
  totalPaid: number;
  /** Kada setovan, prvi ciklus lošeg izveštaja ugradnje ne prelazi u installation_problem. */
  firstCompletedAt: string | null;
  /** Potvrda na poslu: postojeća ponuda ostaje posle merenja (nema nove verzije). */
  postMeasurementKeepInitialQuote?: boolean;
  /** Aktivne reklamacije nabavke (`procurement_complaints`) za narudžbine ovog posla. */
  hasActiveProcurementComplaints?: boolean;
  /** Aktivne Porudžbine po nedostatku (shortage) za posao; blokira prelaz u proizvodnju dok se ne reši. */
  hasActiveShortageOrders?: boolean;
  /** Pojedinačne uplate (za proveru uplate posle prihvatanja finalne ponude). */
  payments?: PaymentRow[];
};

/**
 * Centralna status logika (FAZA 2) sa prioritetima i razlogom promene.
 */
export function deriveJobStatus(current: JobStatus, context: JobStatusDeriveContext): DeriveStatusResult {
  if (automationSkipsRecompute(current)) {
    return { status: current, reason: "Ručni status posla — automatska promena isključena" };
  }

  const wos = context.workOrders;
  const quotes = context.quotes;
  const materialOrders = context.materialOrders;
  const reports = context.fieldReports;
  const unpaidBalance = Number(context.totalPrice) - Number(context.totalPaid);

  const siteCanceledOnInstallation = reports.some(
    (r) =>
      r.site_canceled === true &&
      wos.some((w) => w.id === r.work_order_id && w.type === INSTALLATION_WORK_ORDER_TYPE),
  );
  const hasOpenInstallation = wos.some(
    (w) =>
      w.type === INSTALLATION_WORK_ORDER_TYPE &&
      (w.status === "pending" || w.status === "in_progress"),
  );

  // Izlazak iz "Ugradnja – problem" kada se RN ugradnje ponovo otvori (pending / u toku / dolazak na lokaciju)
  if (current === "installation_problem") {
    const hasInst = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE);
    const instInProgress = wos.some(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "in_progress",
    );
    const instPending = wos.some(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "pending",
    );
    const installationArrivedOnOpenInst = reports.some(
      (r) =>
        Boolean(r.details?.arrivedAt) &&
        wos.some(
          (w) =>
            w.id === r.work_order_id &&
            w.type === INSTALLATION_WORK_ORDER_TYPE &&
            !terminalWo(w.status),
        ),
    );
    if (hasInst && (instInProgress || installationArrivedOnOpenInst)) {
      return {
        status: "installation_in_progress",
        reason: installationArrivedOnOpenInst
          ? "Zabeležen dolazak tima na otvoren nalog ugradnje"
          : "Ugradnja ponovo zakazana; nalog u toku",
      };
    }
    /** Novi RN i posle otkazane prethodne ugradnje — i dalje „Čeka ugradnju" dok je pending. */
    if (hasInst && instPending) {
      return { status: "scheduled", reason: "Ugradnja ponovo zakazana; nalog na čekanju" };
    }
    /** Svi RN ugradnje završeni/otkazani i završen izveštaj „sve u redu" — izlaz iz problema (ranije je ranji return blokirao instJobDone granu). */
    const instUnfinishedLocal = wos.some(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && !terminalWo(w.status),
    );
    if (hasInst && !instUnfinishedLocal) {
      const completedInst = wos.filter(
        (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed" && w.id,
      );
      const hasResolvedOkInstallReport = reports.some((r) => {
        if (!completedInst.some((w) => w.id === r.work_order_id)) return false;
        const finalized = r.completed === true || Boolean(r.details?.finishedAt);
        if (!finalized) return false;
        if (r.everything_ok === false) return false;
        return true;
      });
      if (hasResolvedOkInstallReport) {
        if (unpaidBalance > 0.009) {
          return {
            status: "installation_done_unpaid",
            reason: "Ugradnja završena (terenski izveštaj); čeka se puna uplata pre završetka posla",
          };
        }
        return { status: "completed", reason: "Ugradnja završena (terenski izveštaj); posao u potpunosti plaćen" };
      }
    }
    return { status: current, reason: "Problem na ugradnji — čeka se rešavanje ili otkaz celog posla" };
  }

  if (siteCanceledOnInstallation && !hasOpenInstallation) {
    return { status: "installation_problem", reason: "Terenska poseta ugradnje otkazana" };
  }

  const isComplaintOpen = wos.some((w) => w.type === "complaint" && w.status !== "completed" && w.status !== "canceled");
  if (isComplaintOpen) return { status: "complaint", reason: "Otvoren radni nalog reklamacije" };

  const isServiceOpen = wos.some((w) => w.type === "service" && w.status !== "completed" && w.status !== "canceled");
  if (isServiceOpen) return { status: "service", reason: "Otvoren radni nalog servisa" };

  const hadFirstCompletion =
    context.firstCompletedAt != null && String(context.firstCompletedAt).trim() !== "";
  const hasOpenInstallationFollowup = wos.some(
    (w) =>
      w.type === INSTALLATION_WORK_ORDER_TYPE &&
      (w.status === "pending" || w.status === "in_progress"),
  );
  const firstCycleBadInstallation =
    !hadFirstCompletion &&
    !hasOpenInstallationFollowup &&
    reports.some((r) => {
      if (r.everything_ok !== false) return false;
      const wo = wos.find((w) => w.id === r.work_order_id);
      return (
        !!wo &&
        wo.type === INSTALLATION_WORK_ORDER_TYPE &&
        wo.status === "completed"
      );
    });
  if (firstCycleBadInstallation) {
    return {
      status: "installation_problem",
      reason: "Nalog ugradnje sa problemom u izveštaju (prvi ciklus završetka)",
    };
  }

  const measTypes = MEASUREMENT_WORK_ORDER_TYPES as readonly WorkOrderType[];
  const hasMeas = wos.some((w) => measTypes.includes(w.type));
  const measUnfinished = wos.some((w) => measTypes.includes(w.type) && !terminalWo(w.status));
  const measurementWorkOrdersCompleted = wos.some(
    (w) => measTypes.includes(w.type) && w.status === "completed",
  );
  const hasProd = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE);
  const measurementReportsCompleted = reports.some(
    (r) =>
      r.completed === true &&
      wos.some((w) => w.id === r.work_order_id && measTypes.includes(w.type)),
  );
  const measurementReady =
    (hasMeas && !measUnfinished && (measurementReportsCompleted || measurementWorkOrdersCompleted)) ||
    (!hasMeas && hasProd);
  /** Merenje završeno (RN + izveštaj) — od ovoga zavisi gate za revidirane ponude i materijal. */
  const measurementCompleteWithMeas =
    hasMeas && !measUnfinished && (measurementReportsCompleted || measurementWorkOrdersCompleted);
  const legacyNoMeasurementButProduction = !hasMeas && hasProd;

  const canceledByField = reports.some((r) => r.site_canceled === true);
  const hasActiveWorkflow = wos.some((w) => w.status !== "completed" && w.status !== "canceled");
  if (
    canceledByField &&
    !hasActiveWorkflow &&
    !siteCanceledOnInstallation &&
    !measurementCompleteWithMeas
  ) {
    return { status: "canceled", reason: "Teren otkazan bez nastavka posla" };
  }

  const measurementFinishedTimestamps: number[] = [];
  for (const r of reports) {
    if (r.completed !== true) continue;
    const woId = r.work_order_id;
    if (!woId || !wos.some((w) => w.id === woId && measTypes.includes(w.type))) continue;
    const finishedRaw = r.details?.finishedAt ?? null;
    if (finishedRaw) {
      const t = Date.parse(finishedRaw);
      if (Number.isFinite(t) && t > 0) measurementFinishedTimestamps.push(t);
    }
    const createdRaw = r.created_at ?? null;
    if (createdRaw) {
      const t = Date.parse(createdRaw);
      if (Number.isFinite(t) && t > 0) measurementFinishedTimestamps.push(t);
    }
  }
  const measurementFinishedAt =
    measurementFinishedTimestamps.length > 0 ? Math.max(...measurementFinishedTimestamps) : 0;

  const postMeasurementQuotes = measurementCompleteWithMeas
    ? filterPostMeasurementQuotes(quotes, measurementFinishedAt)
    : [];

  const pmPayCtx = measurementCompleteWithMeas
    ? postMeasurementAcceptancePaymentContext(
        postMeasurementQuotes,
        measurementFinishedAt,
        context.postMeasurementKeepInitialQuote,
        context.payments,
      )
    : null;

  if (current === "final_quote_sent" && pmPayCtx) {
    if (!pmPayCtx.hasPostMeasurementAccepted) {
      return {
        status: "final_quote_sent",
        reason: "Finalna ponuda poslata posle merenja; čeka se prihvatanje",
      };
    }
  }

  if (current === "final_quote_accepted_pending_payment" && pmPayCtx) {
    if (
      (pmPayCtx.hasPostMeasurementAccepted || pmPayCtx.keepsInitialQuoteAfterMeasurement) &&
      !pmPayCtx.hasPaymentAfterFinalAcceptance
    ) {
      return {
        status: "final_quote_accepted_pending_payment",
        reason: "Finalna ponuda prihvaćena; čeka se uplata pre spremnosti za rad",
      };
    }
  }

  const measPhaseOpen = hasMeas && !measurementReady;

  /**
   * Hard stop protiv "preskakanja faza":
   * iz aktivnog merenja se uvek ide prvo u "Obrada mera",
   * pa tek zatim kroz ostale post-measurement korake.
   */
  if (current === "measuring" && measurementCompleteWithMeas) {
    return {
      status: "measurement_processing",
      reason: "Merenje završeno; obavezna faza obrade mera",
    };
  }

  const prodUnfinished = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const prodDone =
    hasProd &&
    !prodUnfinished &&
    wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && w.status === "completed");
  const hasInst = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE);
  const instUnfinished = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const instJobDone =
    hasInst &&
    !instUnfinished &&
    wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed");
  const instInProgress = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "in_progress");
  const activeInstallationOrders = wos.filter(
    (w) =>
      w.type === INSTALLATION_WORK_ORDER_TYPE &&
      w.status !== "canceled" &&
      w.status !== "completed",
  );
  const installAllPendingForSchedule =
    activeInstallationOrders.length > 0 && activeInstallationOrders.every((w) => w.status === "pending");

  if (instJobDone) {
    const completedInst = wos.filter(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed" && w.id,
    );
    const completedInstallReport = reports.some(
      (r) => completedInst.some((w) => w.id === r.work_order_id) && r.completed === true,
    );
    if (completedInstallReport) {
      if (unpaidBalance > 0.009) {
        return {
          status: "installation_done_unpaid",
          reason: "Ugradnja završena (terenski izveštaj); čeka se puna uplata pre završetka posla",
        };
      }
      return { status: "completed", reason: "Ugradnja završena (terenski izveštaj); posao u potpunosti plaćen" };
    }
  }

  const installationArrived = reports.some(
    (r) =>
      r.details?.arrivedAt &&
      wos.some(
        (w) =>
          w.id === r.work_order_id &&
          w.type === INSTALLATION_WORK_ORDER_TYPE &&
          !terminalWo(w.status),
      ),
  );
  if (instInProgress || installationArrived) {
    return { status: "installation_in_progress", reason: "Ugradnja započeta ili zabeležen dolazak tima" };
  }

  const hasInstallationCanceled = wos.some(
    (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "canceled",
  );
  /** Ako postoji novi pending / u toku RN, ne vraćati problem samo zbog starog otkaza (nastavak ugradnje). */
  if (hasInst && hasInstallationCanceled && !instJobDone && !instInProgress && !instUnfinished) {
    return {
      status: "installation_problem",
      reason: "Nalog ugradnje otkazan; posao ostaje u statusu problema dok se ne nastavi na terenu",
    };
  }

  const waitingInstall =
    measurementReady &&
    (installAllPendingForSchedule ||
      (prodDone &&
        hasInst &&
        wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "pending")));
  if (waitingInstall) {
    return {
      status: "scheduled",
      reason: installAllPendingForSchedule
        ? "Nalozi ugradnje na čekanju (čeka se ekipa); merenje završeno"
        : "Proizvodnja završena; kreiran nalog ugradnje",
    };
  }

  const hasMaterialOrder = materialOrders.length > 0;
  const allMaterialsReceptionResolved =
    hasMaterialOrder && materialOrders.every((o) => materialOrderDeliveryResolved(o.delivery_status));
  const allMaterialsSent =
    hasMaterialOrder && materialOrders.every((o) => o.delivery_status !== "pending");
  const hasActiveProcurementComplaints = context.hasActiveProcurementComplaints === true;
  const hasActiveShortageOrders = context.hasActiveShortageOrders === true;

  /**
   * Posle završenog merenja: prvo obrada mera → ponuda → prihvaćeno, tek onda materijal/proizvodnja.
   * Starije narudžbine materijala ne smeju da preskoče `measurement_processing` / `quote_sent` / `final_quote_sent` / `ready_for_work`.
   */
  if (measurementCompleteWithMeas) {
    const ctx = pmPayCtx!;
    const hasPostMeasurementSentAwaiting = postMeasurementQuotes.some((q) => q.status === "sent");
    if (hasPostMeasurementSentAwaiting) {
      return {
        status: "final_quote_sent",
        reason: "Finalna ponuda poslata posle merenja; čeka se prihvatanje",
      };
    }

    const { hasPostMeasurementAccepted, keepsInitialQuoteAfterMeasurement, hasPaymentAfterFinalAcceptance } = ctx;

    if (!hasPostMeasurementAccepted && !keepsInitialQuoteAfterMeasurement) {
      if (current === "final_quote_sent") {
        return {
          status: "final_quote_sent",
          reason: "Finalna ponuda poslata posle merenja; čeka se prihvatanje",
        };
      }
      /** Ne vraćaj unazad iz „Čeka materijal“ / „U proizvodnji“ u obradu mera — RPC je već mogao ispravno pomeriti status. */
      if (current !== "waiting_material" && current !== "partial_in_production" && current !== "in_production") {
        return {
          status: "measurement_processing",
          reason: "Ponuda posle merenja čeka prihvatanje; faza obrade mera",
        };
      }
    }

    if (hasMaterialOrder && allMaterialsReceptionResolved && !instInProgress && !instJobDone) {
      if (hasActiveProcurementComplaints) {
        return {
          status: "waiting_material",
          reason: "Materijal primljen; aktivne reklamacije nabavke moraju biti rešene",
        };
      }
      if (hasActiveShortageOrders) {
        return {
          status: "waiting_material",
          reason: "Postoje aktivne porudžbine po nedostatku; proizvodnja čeka njihov prijem",
        };
      }
      if (installAllPendingForSchedule && measurementReady) {
        return {
          status: "scheduled",
          reason: "Ugradnja na čekanju; materijal primljen — čeka se montažna ekipa",
        };
      }
      return { status: "in_production", reason: "Prijem svih narudžbina materijala završen" };
    }
    if (hasMaterialOrder && allMaterialsSent && !allMaterialsReceptionResolved) {
      const required = materialOrders.filter((o) => o.required_for_production_start === true);
      const hasRequired = required.length > 0;
      const allRequiredReceived =
        hasRequired && required.every((o) => materialOrderDeliveryResolved(o.delivery_status));
      const requiredParentIds = new Set(
        required.map((o) => o.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      );
      const hasUnresolvedShortageForRequired = materialOrders.some(
        (o) =>
          o.is_shortage_order === true &&
          typeof o.parent_order_id === "string" &&
          requiredParentIds.has(o.parent_order_id) &&
          !materialOrderDeliveryResolved(o.delivery_status),
      );
      if (allRequiredReceived && !hasUnresolvedShortageForRequired) {
        return {
          status: "partial_in_production",
          reason: "Ključni materijal primljen; ostale porudžbine još nisu kompletno primljene",
        };
      }
      return { status: "waiting_material", reason: "Sve narudžbine poslate; čeka se isporuka" };
    }
    if (hasMaterialOrder && !allMaterialsSent) {
      if (!hasPostMeasurementAccepted && !keepsInitialQuoteAfterMeasurement) {
        return {
          status: "measurement_processing",
          reason: "Uslovi posle merenja nisu dogovoreni pre nastavka nabavke",
        };
      }
      if (!hasPaymentAfterFinalAcceptance) {
        return {
          status: "final_quote_accepted_pending_payment",
          reason: "Uslovi dogovoreni; evidentirajte uplatu pre spremnosti za operativni rad",
        };
      }
      return { status: "ready_for_work", reason: "Narudžbine na čekanju — nisu sve poslate dobavljačima" };
    }
    if (!hasPaymentAfterFinalAcceptance) {
      if (!hasPostMeasurementAccepted && !keepsInitialQuoteAfterMeasurement) {
        return {
          status: "measurement_processing",
          reason: "Uslovi posle merenja nisu dogovoreni; čeka se prihvatanje",
        };
      }
      return {
        status: "final_quote_accepted_pending_payment",
        reason: "Ponuda prihvaćena ili zadržana početna ponuda; čeka se uplata",
      };
    }
    return { status: "ready_for_work", reason: "Uslovi posle merenja dogovoreni; uplata evidentirana" };
  }

  if (legacyNoMeasurementButProduction) {
    if (hasMaterialOrder && allMaterialsReceptionResolved && !instInProgress && !instJobDone) {
      if (hasActiveProcurementComplaints) {
        return {
          status: "waiting_material",
          reason: "Materijal primljen; aktivne reklamacije nabavke moraju biti rešene",
        };
      }
      if (hasActiveShortageOrders) {
        return {
          status: "waiting_material",
          reason: "Postoje aktivne porudžbine po nedostatku; proizvodnja čeka njihov prijem",
        };
      }
      if (installAllPendingForSchedule && measurementReady) {
        return {
          status: "scheduled",
          reason: "Ugradnja na čekanju; materijal primljen",
        };
      }
      return { status: "in_production", reason: "Prijem svih narudžbina materijala završen" };
    }
    if (hasMaterialOrder && allMaterialsSent && !allMaterialsReceptionResolved) {
      const required = materialOrders.filter((o) => o.required_for_production_start === true);
      const hasRequired = required.length > 0;
      const allRequiredReceived =
        hasRequired && required.every((o) => materialOrderDeliveryResolved(o.delivery_status));
      const requiredParentIds = new Set(
        required.map((o) => o.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      );
      const hasUnresolvedShortageForRequired = materialOrders.some(
        (o) =>
          o.is_shortage_order === true &&
          typeof o.parent_order_id === "string" &&
          requiredParentIds.has(o.parent_order_id) &&
          !materialOrderDeliveryResolved(o.delivery_status),
      );
      if (allRequiredReceived && !hasUnresolvedShortageForRequired) {
        return {
          status: "partial_in_production",
          reason: "Ključni materijal primljen; ostale porudžbine još nisu kompletno primljene",
        };
      }
      return { status: "waiting_material", reason: "Sve narudžbine poslate; čeka se isporuka" };
    }
    if (hasMaterialOrder && !allMaterialsSent) {
      return { status: "in_production", reason: "Narudžbine na čekanju — nisu sve poslate dobavljačima" };
    }
    return { status: "in_production", reason: "Faza proizvodnje bez naloga merenja" };
  }

  if (measPhaseOpen) return { status: "measuring", reason: "Dodeljen ili kreiran nalog merenja" };

  const hasAcceptedQuote = quotes.some((q) => q.status === "accepted");
  if (hasAcceptedQuote) {
    return { status: "accepted", reason: "Ponuda prihvaćena" };
  }
  
  const hasSentQuote = quotes.some((q) => q.status === "sent");
  if (hasSentQuote) {
    if (current === "final_quote_sent") {
      return { status: "final_quote_sent", reason: "Finalna ponuda poslata posle merenja" };
    }
    if (current === "final_quote_accepted_pending_payment") {
      return {
        status: "final_quote_accepted_pending_payment",
        reason: "Čeka se uplata posle prihvatanja finalne ponude",
      };
    }
    return { status: "quote_sent", reason: "Ponuda poslata klijentu" };
  }
  
  return { status: "new", reason: "Nema pokretača toka (faza upita)" };
}

/** Alias za event-driven poziv iz hook-ova/modula. */
export async function updateJobStatusFromEvent(jobId: string, authorId?: string | null): Promise<void> {
  await recomputeJobStatus(jobId, authorId ?? null);
}

/** Alias za sinhronizaciju posle promene entiteta (ponuda/RN/materijal/izveštaj/uplata). */
export async function syncJobStatusAfterEntityChange(jobId: string, authorId?: string | null): Promise<void> {
  await recomputeJobStatus(jobId, authorId ?? null);
}

export async function recomputeJobStatus(
  jobId: string,
  authorId?: string | null,
  client: SupabaseClient = supabase,
): Promise<void> {
  const db = client;
  const { data: jobRow, error: jobError } = await db.from("jobs").select("*").eq("id", jobId).single();
  if (jobError) throw jobError;
  if ((jobRow as { status_locked?: boolean | null }).status_locked === true) return;
  const parentJobId = (jobRow as { parent_job_id?: string | null }).parent_job_id;
  const isChildJob = typeof parentJobId === "string" && parentJobId.length > 0;
  let currentStatus = jobRow.status as JobStatus;

  const { error: rpcError } = await db.rpc("recompute_job_status", {
    p_job_id: jobId,
  });
  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const { data: currentAfterRpc, error: currentAfterRpcError } = await db
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  if (!currentAfterRpcError && currentAfterRpc?.status) {
    currentStatus = currentAfterRpc.status as JobStatus;
  }

  /** Pod-posao: SQL recompute je izvor istine; klijentski derive vraća pogrešan `accepted`. */
  if (isChildJob) return;

  const workOrdersRes = await db.from("work_orders").select("id, status, type").eq("job_id", jobId);
  if (workOrdersRes.error && !isMissingTableError(workOrdersRes.error.code)) {
    throw workOrdersRes.error;
  }
  const workOrderRows: WorkOrderRow[] = (workOrdersRes.data ?? []).map((row) => ({
    id: row.id as string,
    status: row.status as WorkOrderStatus,
    type: row.type as WorkOrderType,
  }));

  // Izveštaj mora ući u kontekst i kad je `field_reports.job_id` NULL (stari upisi / edge); veza je i work_order_id.
  const woIdsForJob = workOrderRows.map((w) => w.id);
  const reportsQ = db
    .from("field_reports")
    .select("work_order_id, everything_ok, site_canceled, completed, details, created_at, job_id");
  const reportsRes =
    woIdsForJob.length > 0
      ? await reportsQ.or(
          `job_id.eq.${jobId},work_order_id.in.(${woIdsForJob.join(",")})`,
        )
      : await reportsQ.eq("job_id", jobId);
  if (reportsRes.error && !isMissingTableError(reportsRes.error.code)) {
    throw reportsRes.error;
  }

  const quotesRes = await db
    .from("quotes")
    .select("status,created_at,updated_at,version_number")
    .eq("job_id", jobId);
  if (quotesRes.error && !isMissingTableError(quotesRes.error.code)) {
    throw quotesRes.error;
  }

  const materialOrdersRes = await db
    .from("material_orders")
    .select("id, delivery_status, required_for_production_start, parent_order_id, is_shortage_order")
    .eq("job_id", jobId);
  if (materialOrdersRes.error && !isMissingTableError(materialOrdersRes.error.code)) {
    throw materialOrdersRes.error;
  }

  let hasActiveProcurementComplaints = false;
  const complaintsRpc = await db.rpc("job_has_active_procurement_complaints", { p_job_id: jobId });
  if (!complaintsRpc.error) {
    hasActiveProcurementComplaints = complaintsRpc.data === true;
  } else {
    const ce = complaintsRpc.error as { code?: string; message?: string };
    const msg = typeof ce.message === "string" ? ce.message : "";
    const rpcMissing =
      ce.code === "42883" ||
      ce.code === "PGRST202" ||
      (msg.includes("job_has_active_procurement_complaints") && msg.includes("Could not find"));
    if (!rpcMissing) throw complaintsRpc.error;
  }

  let hasActiveShortageOrders = false;
  const shortageRpc = await db.rpc("job_has_active_shortage_orders", { p_job_id: jobId });
  if (!shortageRpc.error) {
    hasActiveShortageOrders = shortageRpc.data === true;
  } else {
    const se = shortageRpc.error as { code?: string; message?: string };
    const msg = typeof se.message === "string" ? se.message : "";
    const rpcMissing =
      se.code === "42883" ||
      se.code === "PGRST202" ||
      (msg.includes("job_has_active_shortage_orders") && msg.includes("Could not find"));
    if (!rpcMissing) throw shortageRpc.error;
  }

  const paymentsRes = await db.from("payments").select("amount, date, created_at, updated_at").eq("job_id", jobId);
  if (paymentsRes.error && !isMissingTableError(paymentsRes.error.code)) {
    throw paymentsRes.error;
  }
  const payments = paymentsRes.data ?? [];
  const totalPaid = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const paymentRows: PaymentRow[] = payments.map((row) => ({
    amount: Number((row as { amount?: unknown }).amount) || 0,
    date: (row as { date?: string | null }).date ?? null,
    created_at: (row as { created_at?: string | null }).created_at ?? null,
    updated_at: (row as { updated_at?: string | null }).updated_at ?? null,
  }));

  const derived = deriveJobStatus(currentStatus, {
    workOrders: workOrderRows,
    quotes: (quotesRes.data ?? []).map((q) => ({
      status: q.status as QuoteStatus,
      created_at: (q as { created_at?: string | null }).created_at ?? null,
      updated_at: (q as { updated_at?: string | null }).updated_at ?? null,
      version_number: (q as { version_number?: number | null }).version_number ?? null,
      is_final: (q as { is_final?: boolean | null }).is_final ?? null,
    })),
    materialOrders: (materialOrdersRes.data ?? []).map((o) => ({
      id: (o as { id?: string | null }).id ?? undefined,
      delivery_status: o.delivery_status as MaterialOrderDeliveryStatus,
      required_for_production_start: (o as { required_for_production_start?: boolean | null }).required_for_production_start,
      parent_order_id: (o as { parent_order_id?: string | null }).parent_order_id ?? null,
      is_shortage_order: (o as { is_shortage_order?: boolean | null }).is_shortage_order ?? null,
    })),
    fieldReports: (reportsRes.data ?? []).map((r) => ({
      work_order_id: (r.work_order_id as string | null) ?? null,
      everything_ok: (r.everything_ok as boolean | null) ?? null,
      site_canceled: (r.site_canceled as boolean | null) ?? null,
      completed: (r.completed as boolean | null) ?? null,
      created_at: (r as { created_at?: string | null }).created_at ?? null,
      details:
        r.details && typeof r.details === "object" && !Array.isArray(r.details)
          ? (r.details as FieldReportRow["details"])
          : null,
    })),
    totalPrice: Number((jobRow as { total_price?: number | string | null }).total_price) || 0,
    totalPaid,
    firstCompletedAt: (jobRow as { first_completed_at?: string | null }).first_completed_at ?? null,
    postMeasurementKeepInitialQuote:
      (jobRow as Record<string, unknown>).post_measurement_keep_initial_quote === true,
    hasActiveProcurementComplaints,
    hasActiveShortageOrders,
    payments: paymentRows,
  });
  if (derived.status === currentStatus) return;

  const { data: updatedRows, error: updateError } = await db
    .from("jobs")
    .update({ status: derived.status })
    .eq("id", jobId)
    .select("id,status");
  if (updateError) throw updateError;
  if (!updatedRows?.length) {
    console.warn(
      "Auto job status: UPDATE jobs returned 0 rows (likely RLS). Deploy migration 20260418100000_rpc_recompute_job_status.sql.",
    );
    return;
  }

  await upsertSystemActivity({
    jobId,
    description: `Status automatski promenjen: ${labelJobStatus(currentStatus)} → ${labelJobStatus(derived.status)} (${derived.reason})`,
    systemKey: `auto-job-status:${jobId}:${currentStatus}:${derived.status}`,
    authorId: authorId ?? null,
  });
}
