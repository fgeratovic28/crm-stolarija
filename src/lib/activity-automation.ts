import { supabase } from "@/lib/supabase";
import type { CommunicationType } from "@/types";

type UpsertSystemActivityInput = {
  jobId: string;
  description: string;
  systemKey?: string;
  authorId?: string | null;
  type?: CommunicationType;
  date?: string;
};

export async function upsertSystemActivity({
  jobId,
  description,
  systemKey,
  authorId = null,
  type = "other",
  date,
}: UpsertSystemActivityInput): Promise<void> {
  const normalizedDescription = description.startsWith("[AUTO] ")
    ? description
    : `[AUTO] ${description}`;
  const row = {
    job_id: jobId,
    type,
    description: normalizedDescription,
    author_id: authorId,
    date: date ?? new Date().toISOString(),
    ...(systemKey ? { system_key: systemKey } : {}),
  };

  if (systemKey) {
    const { data: existingBySystemKey, error: existingBySystemKeyError } = await supabase
      .from("activities")
      .select("id")
      .eq("job_id", jobId)
      .eq("system_key", systemKey)
      .limit(1);
    if (existingBySystemKeyError) throw existingBySystemKeyError;

    const existingId = existingBySystemKey?.[0]?.id;
    if (existingId) {
      const { error: updateError } = await supabase
        .from("activities")
        .update({
          type,
          description: normalizedDescription,
          author_id: authorId,
          date: date ?? new Date().toISOString(),
        })
        .eq("id", existingId);
      if (updateError) throw updateError;
      return;
    }

    const { error: insertWithKeyError } = await supabase.from("activities").insert([row]);
    if (!insertWithKeyError) return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("id")
    .eq("job_id", jobId)
    .eq("type", type)
    .eq("description", normalizedDescription)
    .limit(1);
  if (existingError) throw existingError;
  if ((existing ?? []).length > 0) return;

  const { error: insertError } = await supabase.from("activities").insert([
    {
      job_id: jobId,
      type,
      description: normalizedDescription,
      author_id: authorId,
      date: date ?? new Date().toISOString(),
    },
  ]);
  if (insertError) throw insertError;
}

/** Sistem / automatski unosi počinju prefiksom `[AUTO] ` — vidi upsertSystemActivity. */
export function isAutomatedActivityDescription(description: string): boolean {
  return description.trimStart().startsWith("[AUTO] ");
}
