import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DashboardWarningSection = {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
};

type WarningFilter = "all" | "urgent" | "sales" | "unscheduled" | "procurement" | "attention" | "sla";

const FILTER_CHIPS: { key: WarningFilter; label: string }[] = [
  { key: "all", label: "Sve" },
  { key: "urgent", label: "Hitno" },
  { key: "sales", label: "Prodaja" },
  { key: "sla", label: "SLA" },
  { key: "unscheduled", label: "Nalozi" },
  { key: "procurement", label: "Nabavka" },
  { key: "attention", label: "Finansije" },
];

const COLLAPSED_MAX_PX = 280;

function inferFilterCategory(sectionId: string): WarningFilter {
  if (sectionId === "urgent-predracun") return "urgent";
  if (sectionId === "sales") return "sales";
  if (sectionId === "sla-stale") return "sla";
  if (sectionId === "unscheduled") return "unscheduled";
  if (sectionId === "attention") return "attention";
  if (sectionId.startsWith("proc-")) return "procurement";
  return "all";
}

function ExpandableSectionBody({ sectionKey, children }: { sectionKey: string; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showToggle, setShowToggle] = useState(false);

  const measure = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    setShowToggle(el.scrollHeight > COLLAPSED_MAX_PX + 24);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, children, sectionKey]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  if (!showToggle) {
    return <div className="min-w-0">{children}</div>;
  }

  return (
    <div className="min-w-0 space-y-2">
      <div
        className={cn(
          "relative min-w-0 rounded-md border border-border/40 bg-muted/10",
          !expanded && "max-h-[min(280px,38vh)] overflow-hidden",
        )}
      >
        <div ref={innerRef} className="min-w-0 p-2 sm:p-3">
          {children}
        </div>
        {!expanded ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card via-card/90 to-transparent"
            aria-hidden
          />
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs font-medium text-primary hover:text-primary"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Suzi prikaz" : "Vidi više"}
      </Button>
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  sections: DashboardWarningSection[];
};

export function DashboardWarningsModal({ open, onOpenChange, heading, sections }: Props) {
  const [filter, setFilter] = useState<WarningFilter>("all");

  useEffect(() => {
    if (open) setFilter("all");
  }, [open]);

  if (sections.length === 0) return null;

  const visible =
    filter === "all"
      ? sections
      : sections.filter((s) => inferFilterCategory(s.id) === filter);

  const availableFilters = FILTER_CHIPS.filter((chip) => {
    if (chip.key === "all") return true;
    return sections.some((s) => inferFilterCategory(s.id) === chip.key);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex w-[min(96vw,42rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          "max-h-[min(92dvh,880px)] border-0 bg-card p-0 shadow-xl sm:rounded-lg",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/70 px-5 pb-3 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
          <DialogTitle className="pr-10 text-base sm:text-lg">{heading}</DialogTitle>
          <DialogDescription className="text-left text-xs text-muted-foreground sm:text-sm">
            Filtriraj po vrsti, skroluj sadržaj ispod. Duga sekcija može da se proširi dugmetom „Vidi više“.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b border-border/60 bg-muted/25 px-3 py-2.5 sm:px-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Filter</p>
          <div className="flex max-h-[88px] flex-wrap gap-1.5 overflow-y-auto sm:max-h-none">
            {availableFilters.map((chip) => (
              <Button
                key={chip.key}
                type="button"
                size="sm"
                variant={filter === chip.key ? "default" : "outline"}
                className="h-8 shrink-0 rounded-full px-3 text-xs"
                onClick={() => setFilter(chip.key)}
              >
                {chip.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 sm:px-6 sm:py-4">
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              Nema upozorenja u izabranoj kategoriji.
            </p>
          ) : (
            <div className="space-y-6 pb-2">
              {visible.map((s) => (
                <section
                  key={s.id}
                  className="space-y-2 border-b border-border/40 pb-6 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold tracking-wide text-foreground">{s.title}</h3>
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">
                      {FILTER_CHIPS.find((c) => c.key === inferFilterCategory(s.id))?.label ?? "—"}
                    </span>
                  </div>
                  {s.description ? (
                    <p className="text-xs leading-snug text-muted-foreground">{s.description}</p>
                  ) : null}
                  <ExpandableSectionBody key={`${s.id}-${filter}`} sectionKey={s.id}>
                    <div className="min-w-0 [&_.mb-4]:mb-2 [&_.mb-4:last-child]:mb-0">{s.content}</div>
                  </ExpandableSectionBody>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
