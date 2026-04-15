import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
}

export function FilterBar({ filters, values, onChange, onReset }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some(v => v !== "all");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map(f => (
        <Select key={f.key} value={values[f.key] || "all"} onValueChange={v => onChange(f.key, v)}>
          <SelectTrigger className="w-auto min-w-[140px] h-8 text-xs">
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sve — {f.label}</SelectItem>
            {f.options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={onReset}>
          <X className="w-3 h-3 mr-1" /> Resetuj filtere
        </Button>
      )}
    </div>
  );
}

export function ActiveFilterChips({ filters, values, onChange }: { filters: FilterConfig[]; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  const active = filters.filter(f => values[f.key] && values[f.key] !== "all");
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {active.map(f => {
        const opt = f.options.find(o => o.value === values[f.key]);
        return (
          <span key={f.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {f.label}: {opt?.label || values[f.key]}
            <button onClick={() => onChange(f.key, "all")} className="hover:text-primary/70">
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
