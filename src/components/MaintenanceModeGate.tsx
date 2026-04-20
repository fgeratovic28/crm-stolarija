import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { useAuthStore } from "@/stores/auth-store";
import { useMaintenanceModeQuery } from "@/hooks/use-maintenance-mode";
import { Button } from "@/components/ui/button";
import { performClientSignOut } from "@/lib/sign-out";
import { MaintenanceUnlockText } from "@/components/MaintenanceUnlockText";
import { MaintenanceCheckingScreen } from "@/components/MaintenanceCheckingScreen";

type MaintenanceModeGateProps = {
  children: React.ReactNode;
};

/**
 * Režim održavanja: prikaz kao greška učitavanja/veze; ni prijava ni rad dok je uključeno.
 * Isključivanje: SQL u bazi, klik na prva slova prvih 5 reči naslova, ili Podešavanja kad je UI dostupan.
 */
export function MaintenanceModeGate({ children }: MaintenanceModeGateProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const { data: maintenanceOn, isLoading, isError } = useMaintenanceModeQuery(true);

  if (isLoading) {
    return <MaintenanceCheckingScreen />;
  }

  if (!isError && maintenanceOn === true) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <MaintenanceUnlockText title={t("maintenance.title")} description={t("maintenance.description")} />
        {isAuthenticated ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void performClientSignOut(queryClient);
            }}
          >
            {t("maintenance.signOut")}
          </Button>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
