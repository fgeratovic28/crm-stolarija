import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type OpenInGoogleMapsButtonProps = {
  address: string;
  className?: string;
  size?: "sm" | "default";
  /** Zaustavi propagaciju klika (npr. klik na karticu naloga). */
  stopPropagation?: boolean;
};

export function OpenInGoogleMapsButton({
  address,
  className,
  size = "default",
  stopPropagation = false,
}: OpenInGoogleMapsButtonProps) {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const isLarge = size === "default";

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn(
        "gap-2 font-medium shrink-0",
        isLarge ? "h-10 px-4 text-sm" : "h-8 gap-1.5 text-xs",
        className,
      )}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        const encoded = encodeURIComponent(trimmed);
        window.open(`https://www.google.com/maps/search/?api=1&query=${encoded}`, "_blank");
      }}
    >
      <MapPin className={cn("shrink-0", isLarge ? "h-4 w-4" : "h-3.5 w-3.5")} />
      Otvori u Google Mapama
    </Button>
  );
}
