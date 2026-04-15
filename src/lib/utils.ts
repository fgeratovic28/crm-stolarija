import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tekst greške iz React Query / Supabase (PostgrestError nije uvek pouzdan preko instanceof u bundlu). */
export function formatQueryError(err: unknown): string {
  if (err == null) return "Nepoznata greška.";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) {
      const e = err as { details?: string; hint?: string; code?: string };
      const parts = [m];
      if (typeof e.details === "string" && e.details.trim()) parts.push(e.details.trim());
      if (typeof e.hint === "string" && e.hint.trim()) parts.push(`Savet: ${e.hint.trim()}`);
      if (typeof e.code === "string" && e.code.trim()) parts.push(`Kod: ${e.code.trim()}`);
      return parts.join(" · ");
    }
  }
  if (err instanceof Error && err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Nepoznata greška.";
  }
}
