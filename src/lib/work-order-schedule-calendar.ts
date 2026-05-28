import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
} from "@/lib/job-status-lifecycle";
import type { WorkOrderType } from "@/types";

export type WorkOrderScheduleKind = "measurement" | "installation";
export type WorkOrderScheduleDisplayKind = WorkOrderScheduleKind | "all";

export type WorkOrderScheduleCalendarEntry = {
  workOrderId: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  teamId: string | null;
  teamName: string;
  scheduledDay: string;
  scheduledTime: string | null;
  workOrderType: WorkOrderType;
  status: string;
  description: string;
  installationAddress?: string;
};

const SCHEDULED_TIME_RX =
  /(?:Zakazano merenje|Zakazana ugradnja)\s*\([^)]*?\s+(\d{1,2}:\d{2})\)/i;

export function workOrderTypesForScheduleKind(kind: WorkOrderScheduleKind): readonly WorkOrderType[] {
  return kind === "measurement" ? MEASUREMENT_WORK_ORDER_TYPES : [INSTALLATION_WORK_ORDER_TYPE];
}

export function workOrderTypesForScheduleDisplayKind(kind: WorkOrderScheduleDisplayKind): readonly WorkOrderType[] {
  if (kind === "all") {
    return [
      "measurement",
      "measurement_verification",
      "installation",
      "complaint",
      "service",
      "production",
      "site_visit",
      "control_visit",
    ];
  }
  return workOrderTypesForScheduleKind(kind);
}

export function scheduleKindLabel(kind: WorkOrderScheduleKind): string {
  return kind === "measurement" ? "merenje" : "ugradnja (montaža)";
}

export function scheduleDisplayKindLabel(kind: WorkOrderScheduleDisplayKind): string {
  if (kind === "all") return "svi tipovi naloga";
  return scheduleKindLabel(kind);
}

export function monthDateRangeYmd(visibleMonth: Date): { from: string; to: string } {
  const from = format(startOfMonth(visibleMonth), "yyyy-MM-dd");
  const to = format(endOfMonth(visibleMonth), "yyyy-MM-dd");
  return { from, to };
}

export function parseScheduledTimeFromDescription(description: string | null | undefined): string | null {
  const raw = description?.trim();
  if (!raw) return null;
  const match = raw.match(SCHEDULED_TIME_RX);
  if (!match?.[1]) return null;
  const [h, m] = match[1].split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return isMeaningfulScheduleTimeHm(hm) ? hm : null;
}

export function scheduledTimeFromIso(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || !isoHasExplicitScheduleTime(raw)) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return isMeaningfulScheduleTimeHm(hm) ? hm : null;
}

/** Da li HH:mm predstavlja stvarno uneto vreme (ne 00:00 placeholder). */
export function isMeaningfulScheduleTimeHm(hm: string | null | undefined): boolean {
  const raw = hm?.trim();
  if (!raw) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return false;
  return h !== 0 || min !== 0;
}

/** Da li ISO / timestamptz string nosi eksplicitno zakazano vreme (ne samo ponoć). */
export function isoHasExplicitScheduleTime(value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (!raw || !/T\d{1,2}:\d{2}/.test(raw)) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  // Samo datum u bazi često stigne kao ponoć UTC — lokalno izgleda kao 02:00, ali vreme nije uneto.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return false;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return isMeaningfulScheduleTimeHm(hm) || d.getSeconds() !== 0;
}

function formatDateWithLocalOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Vrednost za upis u `work_orders.date` (timestamptz). */
export function workOrderScheduledDatetimeForDb(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const hm = formatLocalTimeHm(d);
    if (!isMeaningfulScheduleTimeHm(hm)) return normalizeWorkOrderDateYmd(raw) ?? raw.slice(0, 10);
    return formatDateWithLocalOffset(d);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10) || null;
  const hm = formatLocalTimeHm(d);
  if (!isMeaningfulScheduleTimeHm(hm)) return normalizeWorkOrderDateYmd(d) ?? raw.slice(0, 10);
  return formatDateWithLocalOffset(d);
}

/** Normalizuje vrednost iz baze za formu (samo datum ili lokalni datetime-local). */
export function normalizeWorkOrderScheduleFormValue(
  value: string | null | undefined,
  options?: { dateOnly?: boolean },
): string {
  const raw = value?.trim();
  if (!raw) return "";
  const ymd = normalizeWorkOrderDateYmd(raw);
  if (!ymd) return raw;
  if (options?.dateOnly || !isoHasExplicitScheduleTime(raw)) return ymd;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return ymd;
  return combineDateAndTimeToDateTimeLocal(ymd, formatLocalTimeHm(d));
}

export function normalizeWorkOrderDateYmd(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    const d = parseISO(raw);
    if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
    return format(d, "yyyy-MM-dd");
  } catch {
    return raw.slice(0, 10);
  }
}

/** Da li datum/vreme pada na dati kalendarski dan (YYYY-MM-DD). */
export function isDateOnDayYmd(value: unknown, dayYmd: string): boolean {
  const normalized = normalizeWorkOrderDateYmd(value);
  return normalized !== null && normalized === dayYmd;
}

/** Da li radni nalog ima zakazan termin na dati kalendarski dan (YYYY-MM-DD). */
export function isWorkOrderScheduledOnDayYmd(date: unknown, dayYmd: string): boolean {
  return isDateOnDayYmd(date, dayYmd);
}

export function groupScheduleEntriesByDay(
  entries: WorkOrderScheduleCalendarEntry[],
): Record<string, WorkOrderScheduleCalendarEntry[]> {
  const map: Record<string, WorkOrderScheduleCalendarEntry[]> = {};
  for (const entry of entries) {
    const day = entry.scheduledDay;
    if (!map[day]) map[day] = [];
    map[day].push(entry);
  }
  for (const day of Object.keys(map)) {
    map[day].sort((a, b) => {
      const ta = a.scheduledTime ?? "99:99";
      const tb = b.scheduledTime ?? "99:99";
      if (ta !== tb) return ta.localeCompare(tb);
      return a.jobNumber.localeCompare(b.jobNumber, "sr");
    });
  }
  return map;
}

/** Parsira YYYY-MM-DD u lokalni `Date` (bez UTC pomaka kod `parseISO`). */
export function parseLocalDateYmd(ymd: string | null | undefined): Date | undefined {
  const raw = ymd?.trim();
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function formatLocalDateYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalTimeHm(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Normalizuje unos vremena na HH:mm (24h). */
export function normalizeTimeHmInput(raw: string | null | undefined, fallback = "08:00"): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return fallback;
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmed);
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isLocalDateTodayYmd(ymd: string): boolean {
  return ymd === formatLocalDateYmd(new Date());
}

export function combineDateAndTimeToDateTimeLocal(dateYmd: string, timeHm: string): string {
  const time = timeHm.trim() || "08:00";
  return `${dateYmd}T${time}`;
}

const SCHEDULE_PREFIX_RX = /^(?:Zakazano merenje|Zakazana ugradnja)\s*\([^)]*\)\s*/i;

/** Kratak prikaz ispod kartice naloga (bez dispečerskog prefiksa termina). */
export function workOrderScheduleShortDescription(description: string | null | undefined): string {
  const raw = (description ?? "").trim();
  if (!raw) return "Bez dodatnog opisa.";

  const parts = raw
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(SCHEDULE_PREFIX_RX, "").trim())
    .filter((p) => p.length > 0 && !/^Napomena:\s*$/i.test(p));

  const notePart = parts.find((p) => /^Napomena:/i.test(p));
  const taskPart = parts.find((p) => !/^Napomena:/i.test(p));

  const summary = [taskPart, notePart?.replace(/^Napomena:\s*/i, "Napomena: ")].filter(Boolean).join(" · ");
  const text = summary || raw.replace(SCHEDULE_PREFIX_RX, "").trim() || raw;
  if (text.length <= 160) return text;
  return `${text.slice(0, 157).trimEnd()}…`;
}

/** Puni opis za dijalog „Detalji“. */
export function workOrderScheduleFullDescription(description: string | null | undefined): string {
  const raw = (description ?? "").trim();
  if (!raw) return "—";
  return raw
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");
}

export function splitDateTimeLocalValue(value: string): { dateYmd: string; timeHm: string } {
  const trimmed = value.trim();
  if (!trimmed) return { dateYmd: "", timeHm: "08:00" };
  if (!isoHasExplicitScheduleTime(trimmed)) {
    const ymd = normalizeWorkOrderDateYmd(trimmed) ?? trimmed.slice(0, 10);
    return { dateYmd: ymd, timeHm: "08:00" };
  }
  if (trimmed.includes("T")) {
    const [dateYmd, timePart] = trimmed.split("T");
    const d = new Date(trimmed);
    const timeHm = !Number.isNaN(d.getTime())
      ? formatLocalTimeHm(d)
      : (timePart ?? "08:00").slice(0, 5) || "08:00";
    return {
      dateYmd: normalizeWorkOrderDateYmd(dateYmd ?? trimmed) ?? dateYmd ?? "",
      timeHm,
    };
  }
  return { dateYmd: trimmed.slice(0, 10), timeHm: "08:00" };
}
