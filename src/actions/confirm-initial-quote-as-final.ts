import { supabase } from "@/lib/supabase";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { upsertSystemActivity } from "@/lib/activity-automation";

export async function confirmInitialQuoteAsFinal(jobId: string, authorId?: string | null): Promise<void> {
  const { data: job, error: jErr } = await supabase.from("jobs").select("id, status").eq("id", jobId).maybeSingle();
  if (jErr) throw jErr;
  if (!job) throw new Error("Posao nije pronađen.");
  if (job.status !== "measurement_processing") {
    throw new Error('Status posla nije „Obrada mera“ (measurement_processing).');
  }

  const { error: flagErr } = await supabase
    .from("jobs")
    .update({ post_measurement_keep_initial_quote: true })
    .eq("id", jobId)
    .eq("status", "measurement_processing");
  if (flagErr) throw flagErr;

  await recomputeJobStatus(jobId, authorId ?? null);

  await upsertSystemActivity({
    jobId,
    description: "Potvrđeno: postojeća ponuda ostaje važeća posle merenja (nema nove finalne ponude).",
    systemKey: `post-measurement-keep-initial-quote:${jobId}`,
    authorId: authorId ?? null,
  });
}
