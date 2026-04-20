import { Loader2 } from "lucide-react";

/** Kratak ekran dok se hidrira sesija — posle prvog bogatog splasha u sesiji. */
export function AuthHydratingFallback() {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background"
      aria-busy="true"
      aria-label="Provera sesije"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Provera sesije…</p>
    </div>
  );
}
