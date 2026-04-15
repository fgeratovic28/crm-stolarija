import { useState, useEffect } from "react";
import { WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => {
      setIsOffline(true);
      setIsVisible(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline || !isVisible) return null;

  return (
    <div className={cn(
      "fixed bottom-4 left-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300",
      "sm:left-auto sm:right-4 sm:w-80"
    )}>
      <div className="bg-destructive text-destructive-foreground p-4 rounded-xl shadow-lg border border-destructive-foreground/10 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <WifiOff className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">Nema internet veze</p>
          <p className="text-xs opacity-90">Aplikacija trenutno radi u offline režimu. Neke promene možda neće biti sačuvane.</p>
        </div>
        <button 
          onClick={() => setIsVisible(false)}
          className="p-1 hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
