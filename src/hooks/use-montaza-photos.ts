import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { compressImageForUpload } from "@/lib/compress-image";
import { buildWorkOrderMontazaImageKey, deleteObjectFromR2, uploadFileToR2 } from "@/lib/r2-storage";
import { toast } from "sonner";

export type MontazaRow = {
  id: string;
  work_order_id: string;
  image_url: string;
  storage_key: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export function useMontazaPhotos(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["montaza-photos", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("montaze")
        .select("id, work_order_id, image_url, storage_key, uploaded_by, created_at")
        .eq("work_order_id", workOrderId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MontazaRow[];
    },
    enabled: !!workOrderId,
  });
}

export function useUploadMontazaPhoto() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ workOrderId, file }: { workOrderId: string; file: File }) => {
      const compressed = await compressImageForUpload(file);
      const ext = compressed.name.split(".").pop() || "jpg";
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const storageKey = buildWorkOrderMontazaImageKey(workOrderId, unique);
      const imageUrl = await uploadFileToR2(storageKey, compressed);

      const { data, error } = await supabase
        .from("montaze")
        .insert({
          work_order_id: workOrderId,
          image_url: imageUrl,
          storage_key: storageKey,
          uploaded_by: user?.id ?? null,
        })
        .select("id, work_order_id, image_url, storage_key, uploaded_by, created_at")
        .single();

      if (error) throw error;
      return data as MontazaRow;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["montaza-photos", variables.workOrderId] });
      void queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
      toast.success("Slika sačuvana");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Greška pri otpremanju";
      toast.error(msg);
    },
  });
}

export function useDeleteMontazaPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (row: MontazaRow) => {
      if (row.storage_key) {
        await deleteObjectFromR2(row.storage_key);
      }
      const { error } = await supabase.from("montaze").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_, row) => {
      void queryClient.invalidateQueries({ queryKey: ["montaza-photos", row.work_order_id] });
      void queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
      toast.success("Slika obrisana");
    },
    onError: () => {
      toast.error("Brisanje nije uspelo");
    },
  });
}
