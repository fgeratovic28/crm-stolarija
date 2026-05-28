import { memo } from "react";
import { cn } from "@/lib/utils";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";

interface StatusBadgeProps {
  status: JobStatus;
  /** Ako je zadato, prikazuje se ovaj tekst umesto podrazumevanog za status (npr. „Nova ponuda“ za pod-posao). */
  labelOverride?: string;
  className?: string;
}

export const StatusBadge = memo(function StatusBadge({ status, labelOverride, className }: StatusBadgeProps) {
  const config = JOB_STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", config.color, className)}>
      {labelOverride ?? config.label}
    </span>
  );
});

interface GenericBadgeProps {
  label: string;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive text-destructive-foreground",
  info: "bg-info text-info-foreground",
  muted: "bg-muted text-muted-foreground",
};

export const GenericBadge = memo(function GenericBadge({ label, variant = "default", className }: GenericBadgeProps) {
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", variantClasses[variant], className)}>
      {label}
    </span>
  );
});
