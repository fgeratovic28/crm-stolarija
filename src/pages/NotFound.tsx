import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Hammer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Hammer className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-5xl font-bold text-foreground mb-2">404</h1>
        <p className="text-lg text-muted-foreground mb-1">Stranica nije pronađena</p>
        <p className="text-sm text-muted-foreground mb-6">Tražena putanja <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.pathname}</code> ne postoji.</p>
        <Button asChild>
          <a href="/">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Nazad na kontrolnu tablu
          </a>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
