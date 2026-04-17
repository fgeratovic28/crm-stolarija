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
    const { error } = await supabase
      .from("activities")
      .upsert([row], { onConflict: "job_id,system_key" });
    if (!error) return;
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
