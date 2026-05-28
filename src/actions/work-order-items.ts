import { supabase } from "@/lib/supabase";

export async function toggleWorkOrderItem(itemId: string, isCompleted: boolean) {
  const { error } = await supabase
    .from("work_order_items")
    .update({
      is_completed: isCompleted,
      ...(isCompleted ? {} : { measurements: "" }),
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function updateWorkOrderItemMeasurements(itemId: string, measurements: string) {
  const { error } = await supabase
    .from("work_order_items")
    .update({ measurements: measurements.trim() })
    .eq("id", itemId);
  if (error) throw error;
}
