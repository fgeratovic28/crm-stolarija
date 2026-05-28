import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { sr } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { TimeInput24h } from "@/components/shared/TimeInput24h";
import { cn } from "@/lib/utils";
import { useWorkOrderScheduleCalendar } from "@/hooks/use-work-order-schedule-calendar";
import {
  combineDateAndTimeToDateTimeLocal,
  formatLocalDateYmd,
  formatLocalTimeHm,
  isLocalDateTodayYmd,
  normalizeTimeHmInput,
  parseLocalDateYmd,
  scheduleKindLabel,
  scheduleDisplayKindLabel,
  splitDateTimeLocalValue,
  workOrderScheduleFullDescription,
  workOrderScheduleShortDescription,
  type WorkOrderScheduleCalendarEntry,
  type WorkOrderScheduleDisplayKind,
  type WorkOrderScheduleKind,
} from "@/lib/work-order-schedule-calendar";
import { labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import { workOrderFieldBadgeClassName } from "@/lib/work-order-field-badge";

type WorkOrderScheduleDateTimePickerProps = {
  kind: WorkOrderScheduleKind;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputId: string;
  excludeWorkOrderId?: string;
  enabled?: boolean;
  /** Ranije sačuvan termin (plavo) — pri ponovnom zakazivanju. */
  priorScheduleDateYmd?: string | null;
  dateOnly?: boolean;
  displayKind?: WorkOrderScheduleDisplayKind;
};

const SCHEDULE_DAY_ORDERS_PREVIEW = 3;

const woStatusVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  completed: "success",
  in_progress: "info",
  pending: "warning",
  canceled: "muted",
};

function groupEntriesByTeam(entries: WorkOrderScheduleCalendarEntry[]) {
  const map = new Map<string, WorkOrderScheduleCalendarEntry[]>();
  for (const entry of entries) {
    const key = entry.teamName.trim() || "Neraspoređeno";
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "sr"));
}

function limitEntriesByTeam(
  groups: [string, WorkOrderScheduleCalendarEntry[]][],
  maxTotal: number,
): [string, WorkOrderScheduleCalendarEntry[]][] {
  let remaining = maxTotal;
  const result: [string, WorkOrderScheduleCalendarEntry[]][] = [];
  for (const [team, entries] of groups) {
    if (remaining <= 0) break;
    const slice = entries.slice(0, remaining);
    remaining -= slice.length;
    if (slice.length > 0) result.push([team, slice]);
  }
  return result;
}

function ScheduleOrderDetailDialog({
  entry,
  dayLabel,
  open,
  onOpenChange,
}: {
  entry: WorkOrderScheduleCalendarEntry | null;
  dayLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!entry) return null;

  const fullDescription = workOrderScheduleFullDescription(entry.description);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span>Radni nalog — {entry.jobNumber}</span>
            <Badge className={cn("border text-xs", workOrderFieldBadgeClassName(entry.workOrderType))}>
              {labelWorkOrderType(entry.workOrderType)}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {dayLabel}
            {entry.scheduledTime ? ` · ${entry.scheduledTime}` : ""} · {entry.teamName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="space-y-0.5">
              <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Posao</dt>
              <dd>
                <Link to={`/jobs/${entry.jobId}`} className="font-medium text-primary hover:underline">
                  {entry.jobNumber}
                </Link>
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Kupac</dt>
              <dd className="font-medium">{entry.customerName}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Tim</dt>
              <dd className="inline-flex items-center gap-1.5 font-medium">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {entry.teamName}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Status</dt>
              <dd>
                <GenericBadge
                  label={labelWorkOrderStatus(entry.status)}
                  variant={woStatusVariant[entry.status] ?? "muted"}
                />
              </dd>
            </div>
            {entry.scheduledTime ? (
              <div className="space-y-0.5">
                <dt className="text-[11px] font-semibold uppercase text-muted-foreground">Vreme</dt>
                <dd className="font-medium tabular-nums">{entry.scheduledTime}</dd>
              </div>
            ) : null}
          </dl>

          {entry.installationAddress ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Adresa
              </p>
              <p className="text-sm leading-relaxed">{entry.installationAddress}</p>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              Opis naloga
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{fullDescription}</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
          <Button type="button" asChild>
            <Link to={`/jobs/${entry.jobId}`}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Otvori posao
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDayOrderCard({
  entry,
  onDetails,
}: {
  entry: WorkOrderScheduleCalendarEntry;
  onDetails: () => void;
}) {
  const shortDescription = workOrderScheduleShortDescription(entry.description);
  const teamLabel = entry.teamName.trim() || "Neraspoređeno";

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={`/jobs/${entry.jobId}`}
              className="text-sm font-semibold text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {entry.jobNumber}
            </Link>
            {entry.scheduledTime ? (
              <Badge variant="secondary" className="text-[10px] tabular-nums font-medium">
                {entry.scheduledTime}
              </Badge>
            ) : null}
            <GenericBadge
              label={labelWorkOrderStatus(entry.status)}
              variant={woStatusVariant[entry.status] ?? "muted"}
            />
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {entry.customerName} · {teamLabel}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={onDetails}>
          Detalji
        </Button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/80 pt-2">
        {shortDescription}
      </p>
    </article>
  );
}

export function WorkOrderScheduleDateTimePicker({
  kind,
  value,
  onChange,
  disabled = false,
  inputId,
  excludeWorkOrderId,
  enabled = true,
  priorScheduleDateYmd,
  dateOnly = false,
  displayKind,
}: WorkOrderScheduleDateTimePickerProps) {
  const { dateYmd, timeHm } = splitDateTimeLocalValue(value);
  const priorDayKey =
    priorScheduleDateYmd?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(priorScheduleDateYmd.trim())
      ? priorScheduleDateYmd.trim()
      : null;
  const [pickedYmd, setPickedYmd] = useState(dateYmd);
  const selectedDate = parseLocalDateYmd(pickedYmd);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => selectedDate ?? new Date());
  const [detailEntry, setDetailEntry] = useState<WorkOrderScheduleCalendarEntry | null>(null);
  const [dayOrdersExpanded, setDayOrdersExpanded] = useState(false);

  useEffect(() => {
    setPickedYmd(dateYmd);
  }, [dateYmd]);

  /** Samo kad se promeni izabrani datum spolja (ne pri listanju meseca strelicama). */
  useEffect(() => {
    const d = parseLocalDateYmd(pickedYmd);
    if (d) setVisibleMonth(d);
  }, [pickedYmd]);

  const { byDay, isLoading } = useWorkOrderScheduleCalendar(kind, visibleMonth, enabled, excludeWorkOrderId, displayKind);

  const selectedDayKey = pickedYmd || null;

  useEffect(() => {
    setDayOrdersExpanded(false);
  }, [selectedDayKey]);
  const selectedDayEntries = selectedDayKey ? (byDay[selectedDayKey] ?? []) : [];
  const entriesByTeam = useMemo(() => groupEntriesByTeam(selectedDayEntries), [selectedDayEntries]);
  const hasMoreDayOrders = selectedDayEntries.length > SCHEDULE_DAY_ORDERS_PREVIEW;
  const hiddenDayOrdersCount = Math.max(0, selectedDayEntries.length - SCHEDULE_DAY_ORDERS_PREVIEW);
  const visibleEntriesByTeam = useMemo(
    () =>
      dayOrdersExpanded
        ? entriesByTeam
        : limitEntriesByTeam(entriesByTeam, SCHEDULE_DAY_ORDERS_PREVIEW),
    [entriesByTeam, dayOrdersExpanded],
  );

  const handleDateSelect = (date: Date | undefined) => {
    if (disabled || !date) return;
    const ymd = formatLocalDateYmd(date);
    setPickedYmd(ymd);
    const nextTime =
      !dateOnly && isLocalDateTodayYmd(ymd) ? formatLocalTimeHm(new Date()) : timeHm;
    onChange(dateOnly ? ymd : combineDateAndTimeToDateTimeLocal(ymd, nextTime));
  };

  const handleTimeChange = (nextTime: string) => {
    const day = pickedYmd || formatLocalDateYmd(new Date());
    const normalized = normalizeTimeHmInput(nextTime);
    onChange(dateOnly ? day : combineDateAndTimeToDateTimeLocal(day, normalized));
  };

  const kindLabel = scheduleKindLabel(kind);
  const displayKindLabel = scheduleDisplayKindLabel(displayKind ?? kind);
  const selectedDayLabel = selectedDayKey
    ? format(parseLocalDateYmd(selectedDayKey) ?? new Date(), "EEEE, d. MMMM yyyy.", { locale: sr })
    : "";

  return (
    <div className="space-y-4">
      {/* Skriveno polje samo za E2E — kalendar je primarni izvor izbora datuma. */}
      <input
        id={inputId}
        type={dateOnly ? "date" : "datetime-local"}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          const { dateYmd: nextYmd } = splitDateTimeLocalValue(next);
          setPickedYmd(nextYmd);
          onChange(dateOnly ? nextYmd : next);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      <div className="rounded-xl border border-border bg-gradient-to-b from-muted/25 to-card overflow-hidden shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-muted/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kalendar — {kindLabel}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/15 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Novi termin
            </span>
            {priorDayKey ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-600/15 px-2 py-0.5 font-medium text-blue-800 dark:text-blue-300">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                Stari termin
              </span>
            ) : null}
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        <div className="flex justify-center px-3 py-3">
          <Calendar
            mode="single"
            locale={sr}
            month={visibleMonth}
            onMonthChange={setVisibleMonth}
            selected={selectedDate}
            onSelect={handleDateSelect}
            onDayClick={(day) => handleDateSelect(day)}
            fixedWeeks
            className="p-3 pointer-events-auto w-full max-w-[340px]"
            modifiers={{
              hasOrders: (date) => (byDay[formatLocalDateYmd(date)]?.length ?? 0) > 0,
              currentPick: (date) => !!pickedYmd && pickedYmd === formatLocalDateYmd(date),
              priorPick: (date) =>
                !!priorDayKey &&
                priorDayKey === formatLocalDateYmd(date) &&
                pickedYmd !== formatLocalDateYmd(date),
            }}
            modifiersClassNames={{
              hasOrders: "font-semibold underline decoration-primary decoration-2 underline-offset-4",
              currentPick:
                "!bg-emerald-600 !text-white hover:!bg-emerald-600 focus:!bg-emerald-600 rounded-md",
              priorPick: "!bg-blue-600 !text-white hover:!bg-blue-600 focus:!bg-blue-600 rounded-md",
            }}
            classNames={{
              months: "w-full",
              month: "space-y-4 w-full",
              caption: "flex justify-center pt-1 relative items-center",
              caption_label: "text-sm font-medium",
              nav_button: cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"),
              nav_button_previous: "absolute left-1",
              nav_button_next: "absolute right-1",
              table: "w-full border-collapse space-y-1",
              head_row: "flex",
              head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
              row: "flex w-full mt-2",
              cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
              day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
              day_selected: "",
              day_today: "bg-accent text-accent-foreground",
              day_outside:
                "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
              day_disabled: "text-muted-foreground opacity-50",
            }}
          />
        </div>

        <p className="border-t border-border/80 px-4 py-2.5 text-[11px] text-muted-foreground leading-snug bg-muted/20">
          Kliknite dan za novi termin (zeleno). Broj ispod datuma = nalozi tog dana.
          {priorDayKey ? " Plavo = ranije sačuvan termin." : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            Datum
          </Label>
          <div
            className={cn(
              "rounded-lg border px-3 py-2.5 text-sm",
              selectedDate
                ? "border-emerald-500/40 bg-emerald-500/10 font-medium text-emerald-900 dark:text-emerald-100"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            {selectedDate ? format(selectedDate, "d. MMM yyyy.", { locale: sr }) : "Izaberite na kalendaru"}
          </div>
        </div>
        {!dateOnly ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-time`} className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Vreme *
          </Label>
          <TimeInput24h
            id={`${inputId}-time`}
            value={timeHm}
            onChange={handleTimeChange}
            disabled={disabled || !dateYmd}
            required
            className="h-10"
          />
          <p className="text-[11px] text-muted-foreground">24h format (npr. 14:30)</p>
        </div>
        ) : null}
      </div>

      {selectedDayKey ? (
        <section className="rounded-xl border border-border bg-muted/15 overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raspored za dan</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{selectedDayLabel}</p>
            </div>
            <Badge variant="secondary" className="tabular-nums shrink-0">
              {selectedDayEntries.length} {selectedDayEntries.length === 1 ? "nalog" : "naloga"}
            </Badge>
          </header>

          {selectedDayEntries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              Nema drugih zakazanih naloga za {displayKindLabel} tog dana.
            </p>
          ) : (
            <div className="p-3 space-y-4">
              {visibleEntriesByTeam.map(([teamName, teamEntries]) => (
                <div key={teamName} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">{teamName}</h4>
                    <span className="text-[11px] text-muted-foreground tabular-nums">({teamEntries.length})</span>
                  </div>
                  <ul className="space-y-2">
                    {teamEntries.map((entry) => (
                      <li key={entry.workOrderId}>
                        <ScheduleDayOrderCard entry={entry} onDetails={() => setDetailEntry(entry)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {hasMoreDayOrders ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setDayOrdersExpanded((v) => !v)}
                >
                  {dayOrdersExpanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5 mr-1.5" />
                      Prikaži manje
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                      Prikaži više (+{hiddenDayOrdersCount})
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">Izaberite datum da vidite sve naloge tog dana.</p>
      )}

      <ScheduleOrderDetailDialog
        entry={detailEntry}
        dayLabel={selectedDayLabel}
        open={detailEntry != null}
        onOpenChange={(open) => {
          if (!open) setDetailEntry(null);
        }}
      />
    </div>
  );
}
