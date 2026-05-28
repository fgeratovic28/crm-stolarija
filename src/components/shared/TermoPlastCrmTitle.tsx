import { cn } from "@/lib/utils";

/** Termo / Plast uvek iste boje u svetloj i tamnoj temi. */
export function TermoPlastCrmTitle({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-bold tracking-tight", className)}>
      <span className="text-[#c30426]">Termo</span>{" "}
      <span className="text-[#1d2c6f]">Plast</span>{" "}
      <span className="text-foreground">CRM</span>
    </span>
  );
}
