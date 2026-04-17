import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/contexts/I18nContext";
import { MAINTENANCE_MODE_QUERY_KEY } from "@/hooks/use-maintenance-mode";

type Props = {
  title: string;
  description: string;
};

const UNLOCK_STEPS = 5;

/**
 * Klik na prvo slovo 1.–5. reči od (naslov + razmak + opis), redom.
 * Kod se šalje u RPC (spnpb / stufl); pogrešan redosled resetuje korak.
 */
export function MaintenanceUnlockText({ title, description }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  const titleWords = useMemo(
    () => title.trim().split(/\s+/).filter((w) => w.length > 0),
    [title],
  );
  const descWords = useMemo(
    () => description.trim().split(/\s+/).filter((w) => w.length > 0),
    [description],
  );
  const allWords = useMemo(() => [...titleWords, ...descWords], [titleWords, descWords]);

  const tryUnlock = useCallback(
    async (code: string) => {
      const { data, error } = await supabase.rpc("unlock_maintenance_mode", { p_secret: code });
      if (error || data !== true) {
        toast.error(t("maintenance.unlockFail"));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: [...MAINTENANCE_MODE_QUERY_KEY] });
      toast.success(t("maintenance.unlockSuccess"));
    },
    [queryClient, t],
  );

  const handleWordStartClick = useCallback(
    (globalWordIndex: number) => {
      if (globalWordIndex !== step || globalWordIndex >= UNLOCK_STEPS || !allWords[globalWordIndex]?.length) {
        setStep(0);
        return;
      }
      const next = step + 1;
      if (next === UNLOCK_STEPS) {
        const code = allWords
          .slice(0, UNLOCK_STEPS)
          .map((w) => w[0].toLowerCase())
          .join("");
        void tryUnlock(code);
        setStep(0);
        return;
      }
      setStep(next);
    },
    [allWords, step, tryUnlock],
  );

  const renderWordBlock = (words: string[], globalOffset: number) => (
    <>
      {words.map((word, wi) => {
        const g = globalOffset + wi;
        const clickable = g < UNLOCK_STEPS && word.length > 0;
        if (!clickable) {
          return (
            <span key={`w-${g}`}>
              {word}
              {wi < words.length - 1 ? " " : ""}
            </span>
          );
        }
        const first = word[0];
        const rest = word.slice(1);
        return (
          <span key={`w-${g}`}>
            <button
              type="button"
              tabIndex={-1}
              className="inline cursor-default border-0 bg-transparent p-0 font-inherit text-inherit"
              onClick={() => handleWordStartClick(g)}
            >
              {first}
            </button>
            {rest}
            {wi < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );

  return (
    <div className="max-w-md space-y-2 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">{renderWordBlock(titleWords, 0)}</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">{renderWordBlock(descWords, titleWords.length)}</p>
    </div>
  );
}
