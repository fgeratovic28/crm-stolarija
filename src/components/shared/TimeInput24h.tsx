import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeTimeHmInput } from "@/lib/work-order-schedule-calendar";

type TimeInput24hProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

/** Unos vremena u 24h formatu (HH:mm), bez AM/PM zavisnosti od pregledača. */
export function TimeInput24h({ id, value, onChange, disabled, required, className }: TimeInput24hProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="08:00"
      spellCheck={false}
      aria-label="Vreme (24h format)"
      title="Format: HH:mm (24 sata, npr. 14:30)"
      className={cn("tabular-nums", className)}
      value={draft}
      disabled={disabled}
      required={required}
      onChange={(e) => {
        let next = e.target.value.replace(/[^\d:]/g, "");
        if (next.length > 5) next = next.slice(0, 5);
        const colonCount = (next.match(/:/g) ?? []).length;
        if (colonCount > 1) {
          const [h, ...rest] = next.split(":");
          next = `${h}:${rest.join("")}`;
        }
        setDraft(next);
      }}
      onBlur={() => {
        const normalized = normalizeTimeHmInput(draft);
        setDraft(normalized);
        onChange(normalized);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
