import type { SupabaseClient } from "@supabase/supabase-js";

/** Sklapa blok teksta za polje mere u terenskom izveštaju (stavke naloga označene kao mere). */
export async function fetchWorkOrderChecklistMeasurementsSummary(
  client: SupabaseClient,
  workOrderId: string,
): Promise<string> {
  const { data, error } = await client
    .from("work_order_items")
    .select("description, measurements, is_completed")
    .eq("work_order_id", workOrderId)
    .order("id", { ascending: true });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const lines: string[] = [];
  for (const row of rows) {
    const desc = typeof row.description === "string" ? row.description.trim() : "";
    const mere = typeof row.measurements === "string" ? row.measurements.trim() : "";
    if (!row.is_completed || !mere) continue;
    const label = desc || "Stavka";
    lines.push(`• ${label}: ${mere}`);
  }
  if (lines.length === 0) return "";
  return ["Mere po stavkama naloga:", ...lines].join("\n");
}
