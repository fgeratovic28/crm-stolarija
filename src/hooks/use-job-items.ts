import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { JobItem } from "@/types";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { recomputeJobStatus } from "@/lib/job-status-automation";

type JobItemInsert = {
  profileCode: string;
  profileTitle: string;
  color: string;
  cutLength: number;
  quantity: number;
  barcode: string;
  metadata: Record<string, unknown>;
};

type JobItemsCacheRow = {
  id: string;
  isCompleted?: boolean;
  completedAt?: string;
  is_completed?: boolean;
  completed_at?: string;
};

function normalizeBarcode(value: string): string {
  return value
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

const mapRow = (d: Record<string, unknown>): JobItem => ({
  id: String(d.id),
  jobId: String(d.job_id),
  profileCode: String(d.profile_code ?? ""),
  profileTitle: String(d.profile_title ?? ""),
  color: String(d.color ?? ""),
  cutLength: Number(d.cut_length) || 0,
  quantity: Number(d.quantity) || 0,
  barcode: String(d.barcode ?? ""),
  isCompleted: d.is_completed === true,
  completedAt: d.completed_at ? String(d.completed_at) : undefined,
  metadata:
    d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata)
      ? (d.metadata as Record<string, unknown>)
      : {},
});

export function useJobItems(jobId?: string) {
  const queryClient = useQueryClient();

  const resolveJobNumber = async (targetJobId: string) => {
    const { data } = await supabase.from("jobs").select("job_number").eq("id", targetJobId).maybeSingle();
    return (data?.job_number as string | undefined) ?? "—";
  };

  const itemsQuery = useQuery({
    queryKey: ["job-items", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_items")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
    },
  });

  const replaceItems = useMutation({
    mutationFn: async ({ jobId: targetJobId, rows }: { jobId: string; rows: JobItemInsert[] }) => {
      const { error: delErr } = await supabase.from("job_items").delete().eq("job_id", targetJobId);
      if (delErr) throw delErr;
      if (rows.length === 0) return;
      const { error } = await supabase.from("job_items").insert(
        rows.map((row) => ({
          job_id: targetJobId,
          profile_code: row.profileCode,
          profile_title: row.profileTitle,
          color: row.color,
          cut_length: row.cutLength,
          quantity: row.quantity,
          barcode: row.barcode,
          metadata: row.metadata,
        })),
      );
      if (error) throw error;
      const jobNumber = await resolveJobNumber(targetJobId);
      await upsertSystemActivity({
        jobId: targetJobId,
        description: `Posao ${jobNumber}: Import krojne liste (${rows.length} stavki)`,
        systemKey: `job-items-import:${targetJobId}:${rows.length}`,
      });
      const { data: existingProdOrders, error: prodErr } = await supabase
        .from("work_orders")
        .select("id")
        .eq("job_id", targetJobId)
        .eq("type", "production")
        .in("status", ["pending", "in_progress"])
        .limit(1);
      if (prodErr) throw prodErr;
      if (!existingProdOrders || existingProdOrders.length === 0) {
        const { data: createdOrder, error: createErr } = await supabase
          .from("work_orders")
          .insert([
            {
              job_id: targetJobId,
              type: "production",
              description: `Proizvodnja po krojnoj listi (${rows.length} stavki)`,
              date: new Date().toISOString().split("T")[0],
              status: "pending",
            },
          ])
          .select("id")
          .single();
        if (createErr) throw createErr;
        await upsertSystemActivity({
          jobId: targetJobId,
          description: `Posao ${jobNumber}: Automatski kreiran proizvodni nalog (${createdOrder.id})`,
          systemKey: `production-order-auto-create:${targetJobId}:${createdOrder.id}`,
        });
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["job-items", vars.jobId] });
      toast.success("Krojna lista je uspešno importovana");
    },
    onError: (error: unknown) => {
      toast.error("Import krojne liste nije uspeo", {
        description: error instanceof Error ? error.message : "Nepoznata greška",
      });
    },
  });

  const completeByBarcode = useMutation({
    mutationFn: async ({ jobId: targetJobId, barcode }: { jobId: string; barcode: string }) => {
      const normalizedInput = normalizeBarcode(barcode);
      const { data, error } = await supabase
        .from("job_items")
        .select("id,is_completed,barcode")
        .eq("job_id", targetJobId)
        .limit(5000);
      if (error) throw error;
      const hit = (data ?? []).find((row) => normalizeBarcode(String(row.barcode ?? "")) === normalizedInput);
      if (!hit) throw new Error(`Bar kod "${barcode}" ne postoji za ovaj posao.`);
      const rowId = String(hit.id);
      const { error: updateErr } = await supabase
        .from("job_items")
        .update({ is_completed: true, completed_at: new Date().toISOString() })
        .eq("id", rowId);
      if (updateErr) throw updateErr;

      const { data: remaining, error: remainingErr } = await supabase
        .from("job_items")
        .select("id")
        .eq("job_id", targetJobId)
        .eq("is_completed", false)
        .limit(1);
      if (remainingErr) throw remainingErr;

      let jobNumber = "—";
      try {
        jobNumber = await resolveJobNumber(targetJobId);
        await upsertSystemActivity({
          jobId: targetJobId,
          description: `Posao ${jobNumber}: Skeniran bar kod ${barcode}`,
          systemKey: `job-item-scan:${targetJobId}:${barcode}`,
        });
      } catch (err) {
        // Scanning should stay successful even if activity log fails.
        console.warn("Activity logging after barcode scan failed:", err);
      }

      if ((remaining ?? []).length === 0) {
        try {
          const { data: productionOrders, error: prodErr } = await supabase
            .from("work_orders")
            .select("id,status")
            .eq("job_id", targetJobId)
            .eq("type", "production")
            .in("status", ["pending", "in_progress"]);
          if (prodErr) throw prodErr;

          for (const order of productionOrders ?? []) {
            const { error: closeErr } = await supabase
              .from("work_orders")
              .update({ status: "completed" })
              .eq("id", order.id);
            if (closeErr) throw closeErr;
            await upsertSystemActivity({
              jobId: targetJobId,
              description: `Posao ${jobNumber}: Proizvodni nalog završen (sve stavke skenirane)`,
              systemKey: `production-order-auto-complete:${order.id}`,
            });
          }

          try {
            await recomputeJobStatus(targetJobId);
          } catch (err) {
            console.warn("Job status recompute after production completion failed:", err);
          }
        } catch (err) {
          // Keep scan successful even if auto-complete/status workflow fails.
          console.warn("Post-scan production auto-complete failed:", err);
        }
      }
      return {
        rowId,
        completedAt: new Date().toISOString(),
      };
    },
    onSuccess: (result, vars) => {
      queryClient.setQueriesData(
        { queryKey: ["job-items", vars.jobId] },
        (oldData: JobItemsCacheRow[] | undefined) => {
          if (!oldData || !result) return oldData;
          return oldData.map((row) =>
            row.id === result.rowId
              ? {
                  ...row,
                  isCompleted: true,
                  completedAt: result.completedAt,
                  is_completed: true,
                  completed_at: result.completedAt,
                }
              : row,
          );
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["job-items", vars.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["job", vars.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["work-orders", vars.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["activities", vars.jobId] });
      toast.success("Stavka označena kao završena");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Skeniranje nije uspelo");
    },
  });

  return {
    items: itemsQuery.data ?? [],
    isLoading: itemsQuery.isLoading,
    replaceItems,
    completeByBarcode,
  };
}
