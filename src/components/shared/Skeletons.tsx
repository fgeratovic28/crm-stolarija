import { cn } from "@/lib/utils";

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SkeletonPulse className="w-10 h-10 rounded-lg" />
        <div className="space-y-2">
          <SkeletonPulse className="h-5 w-32" />
          <SkeletonPulse className="h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3">
            <SkeletonPulse className="h-3 w-24" />
            <SkeletonPulse className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3">
            <SkeletonPulse className="h-3 w-28" />
            <SkeletonPulse className="h-7 w-20" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={4} cols={4} />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="p-4 sm:p-5 border-b border-border flex items-center gap-3">
        <SkeletonPulse className="h-5 w-32" />
        <SkeletonPulse className="h-8 w-24 rounded-lg ml-auto" />
      </div>
      <div className="p-1">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 sm:px-5 py-3.5 border-b border-border last:border-0">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonPulse key={c} className={cn("h-4", c === 0 ? "w-20" : c === 1 ? "w-32" : "w-16")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SkeletonPulse className="w-10 h-10 rounded-lg" />
        <div className="space-y-2">
          <SkeletonPulse className="h-5 w-40" />
          <SkeletonPulse className="h-3 w-56" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
            <SkeletonPulse className="w-9 h-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-4 w-40" />
              <SkeletonPulse className="h-3 w-64" />
            </div>
            <SkeletonPulse className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonPulse className="h-3 w-48" />
      <SkeletonPulse className="h-8 w-24" />
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <div className="flex items-center gap-3">
          <SkeletonPulse className="h-6 w-36" />
          <SkeletonPulse className="h-5 w-20 rounded-full" />
        </div>
        <SkeletonPulse className="h-4 w-48" />
        <SkeletonPulse className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-lg border border-border p-3 space-y-2 flex flex-col items-center">
            <SkeletonPulse className="w-4 h-4 rounded" />
            <SkeletonPulse className="h-5 w-12" />
            <SkeletonPulse className="h-2 w-16" />
          </div>
        ))}
      </div>
      <SkeletonPulse className="h-10 w-full max-w-xl rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5 space-y-4">
          <SkeletonPulse className="h-5 w-28" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <SkeletonPulse className="h-3 w-16" />
                <SkeletonPulse className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3">
              <SkeletonPulse className="h-5 w-32" />
              <SkeletonPulse className="h-3 w-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
