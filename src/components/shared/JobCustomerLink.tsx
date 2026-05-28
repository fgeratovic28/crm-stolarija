import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { JobDetailsReturnState } from "@/lib/job-details-return";

type JobCustomerLinkProps = {
  jobId: string;
  jobNumber: string;
  customerName?: string;
  /** Lista sa koje je otvoren posao — dugme „Nazad” na kartici posla vodi ovde. */
  returnState?: JobDetailsReturnState;
  /** Potpuno zamenjuje podrazumevanu navigaciju na posao. */
  onClick?: () => void;
  className?: string;
};

export function JobCustomerLink({
  jobId,
  jobNumber,
  customerName,
  returnState,
  onClick,
  className,
}: JobCustomerLinkProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary shadow-sm transition-colors hover:border-primary/55 hover:bg-primary/10",
        className,
      )}
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        navigate(
          `/jobs/${jobId}`,
          returnState ? { state: returnState } : undefined,
        );
      }}
    >
      <ExternalLink className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <span>{jobNumber}</span>
        {customerName ? (
          <>
            <span className="text-primary/50" aria-hidden>
              ·
            </span>
            <span>{customerName}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}
