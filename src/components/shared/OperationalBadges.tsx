import { AlertTriangle, Clock, Calendar, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, MaterialOrder, WorkOrder } from "@/types";

export function OverduePaymentBadge({ job }: { job: Job }) {
  if (job.unpaidBalance <= 0) return null;
  const daysSinceCreation = Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 86400000);
  if (daysSinceCreation < 30) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/10 text-destructive">
      <DollarSign className="w-3 h-3" /> Dospelo
    </span>
  );
}

export function DelayedDeliveryBadge({ order }: { order: MaterialOrder }) {
  if (order.deliveryStatus === "delivered") return null;
  const isLate = new Date(order.expectedDelivery) < new Date();
  if (!isLate) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warning/10 text-warning">
      <Clock className="w-3 h-3" /> Kasni
    </span>
  );
}

export function ScheduledBadge({ date }: { date: string }) {
  const d = new Date(date);
  const daysUntil = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (daysUntil > 7 || daysUntil < 0) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-info/10 text-info">
      <Calendar className="w-3 h-3" /> Za {daysUntil}d
    </span>
  );
}

export function AttentionIndicator({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-warning font-medium">
      <AlertTriangle className="w-3.5 h-3.5" />
      <span>{count} {label}</span>
    </div>
  );
}

export function MissingDataWarning({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/20 text-xs">
      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-warning">Nedostaju podaci</p>
        <p className="text-muted-foreground mt-0.5">{fields.join(", ")}</p>
      </div>
    </div>
  );
}
