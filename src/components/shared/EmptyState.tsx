import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Zamenjuje jednostavno dugme (npr. padajući izbor) */
  actionsSlot?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionsSlot,
}: EmptyStateProps) {
  return (
    <div className="bg-card rounded-xl border border-border px-6 py-16 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {description ? <p className="text-sm text-muted-foreground max-w-sm">{description}</p> : null}
      {actionsSlot ? (
        <div className="mt-4 flex justify-center">{actionsSlot}</div>
      ) : actionLabel && onAction ? (
        <Button size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
