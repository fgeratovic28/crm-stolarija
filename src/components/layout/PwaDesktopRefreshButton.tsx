import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isPwaDesktopClient } from "@/lib/pwa-desktop";
import { refreshAppDataFromApi } from "@/lib/refresh-app-data";
import { useToast } from "@/hooks/use-toast";

export function PwaDesktopRefreshButton() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  if (!isPwaDesktopClient()) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAppDataFromApi(queryClient);
      toast({ title: "Podaci osveženi", description: "Učitani su najnoviji podaci sa servera." });
    } catch (err) {
      console.warn("refreshAppDataFromApi:", err);
      toast({
        title: "Osvežavanje nije uspelo",
        description: "Pokušajte ponovo za nekoliko sekundi.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="hidden sm:inline-flex gap-1.5 shrink-0"
      disabled={refreshing}
      onClick={() => void handleRefresh()}
      title="Učitaj najnovije podatke bez osvežavanja cele stranice"
    >
      <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
      Osveži
    </Button>
  );
}
