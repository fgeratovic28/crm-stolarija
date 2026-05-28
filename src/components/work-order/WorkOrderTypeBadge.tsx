import { Badge } from "@/components/ui/badge";
import { labelWorkOrderType } from "@/lib/activity-labels";
import { workOrderFieldBadgeClassName, workOrderFieldBadgeLabel } from "@/lib/work-order-field-badge";
import { cn } from "@/lib/utils";
import type { WorkOrderType } from "@/types";

type WorkOrderTypeBadgeProps = {
  type: WorkOrderType | string | null | undefined;
  size?: "sm" | "md" | "lg";
  /** Kraći nazivi za teren / montažu (npr. Montaža umesto Ugradnja). */
  fieldLabel?: boolean;
  className?: string;
};

const SIZE_CLASS: Record<NonNullable<WorkOrderTypeBadgeProps["size"]>, string> = {
  sm: "text-xs px-2 py-0.5 font-semibold",
  md: "text-sm px-2.5 py-1 font-semibold",
  lg: "text-base px-3 py-1.5 font-semibold leading-snug",
};

export function WorkOrderTypeBadge({
  type,
  size = "md",
  fieldLabel = false,
  className,
}: WorkOrderTypeBadgeProps) {
  const trimmed = typeof type === "string" ? type.trim() : "";
  if (!trimmed) return null;

  const woType = trimmed as WorkOrderType;
  const label = fieldLabel ? workOrderFieldBadgeLabel(woType) : labelWorkOrderType(woType);

  return (
    <Badge
      variant="outline"
      className={cn(
        "border shadow-none h-auto whitespace-normal text-left inline-flex max-w-full rounded-md",
        SIZE_CLASS[size],
        workOrderFieldBadgeClassName(woType),
        className,
      )}
    >
      {label}
    </Badge>
  );
}
