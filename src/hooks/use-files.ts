import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { AppFile, FileCategory } from "@/types";
import { toast } from "sonner";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelFileCategory } from "@/lib/activity-labels";
import {
  buildFieldPhotosFileKey,
  buildJobFilesObjectKey,
  buildMaterialOrderFileKey,
  deleteObjectFromR2,
  uploadFileToR2,
} from "@/lib/r2-storage";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import { extensionFromFile, maybeCompressImageForUpload } from "@/lib/compress-image";

export interface UploadFileInput {
  jobId?: string;
  /** Prilog uz konkretnu narudžbinu (bilo koji tip fajla). */
  materialOrderId?: string;
  category: FileCategory;
  file: File;
  uploadedBy: string;
}

export type FileRow = {
  id: string;
  job_id?: string;
  material_order_id?: string | null;
  filename: string;
  category: FileCategory;
  size: string;
  uploaded_at: string;
  storage_key?: string | null;
  storage_url?: string | null;
  users?: { name?: string } | { name?: string }[] | null;
};

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

/** Prazan string nije validan UUID za `files.job_id` — mora biti null. */
function toNullableJobId(jobId?: string | null): string | null {
  if (jobId === undefined || jobId === null) return null;
  const t = String(jobId).trim();
  return t.length > 0 ? t : null;
}

function invalidateMaterialOrderFilesQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "material-order-files",
  });
}

export const mapDbToFile = (d: FileRow): AppFile => {
  const userData = Array.isArray(d.users) ? d.users[0] : d.users;
  return {
    id: d.id,
    jobId: d.job_id,
    materialOrderId: d.material_order_id ?? undefined,
    name: d.filename,
    category: d.category,
    size: d.size,
    uploadedBy: userData?.name || "Sistem",
    uploadedAt: d.uploaded_at,
    type: "file",
    storageKey: d.storage_key ?? undefined,
    storageUrl: d.storage_url ?? undefined,
  };
};

export function useAllFiles() {
  const role = useAuthStore((s) => s.user?.role);

  return useQuery({
    queryKey: ["files", "all", role ?? "none"],
    queryFn: async () => {
      let q = supabase
        .from("files")
        .select(`
          *,
          users (name)
        `)
        .order("uploaded_at", { ascending: false });

      if (role === "procurement") {
        q = q.not("material_order_id", "is", null);
      }
      if (role === "office") {
        q = q.is("material_order_id", null);
      }

      const { data, error } = await q;

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToFile(row as FileRow));
    },
  });
}

export function useFiles() {
  const queryClient = useQueryClient();

  const uploadFile = useMutation({
    mutationFn: async (input: UploadFileInput) => {
      const { jobId, materialOrderId, category, file, uploadedBy } = input;
      const jobIdForDb = toNullableJobId(jobId);

      const prepared = await maybeCompressImageForUpload(file);

      // 1. R2: dokumenta → prefiks files/…; terenske foto (field_photos) → field-photos/…; narudžbina → files/material-orders/…
      const fileExt = extensionFromFile(prepared);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const objectKey = materialOrderId
        ? buildMaterialOrderFileKey(materialOrderId, fileName)
        : category === "field_photos"
          ? buildFieldPhotosFileKey(jobIdForDb ?? undefined, fileName)
          : buildJobFilesObjectKey(jobIdForDb ?? undefined, fileName);
      const storageUrl = await uploadFileToR2(objectKey, prepared);

      const materialOrderIdTrimmed = materialOrderId?.trim() ?? "";
      const useMoSupplierRpc = category === "supplier" && materialOrderIdTrimmed.length > 0;

      // 2. Zapis u `files`: za prilog uz narudžbinu (supplier + material_order_id) koristi RPC
      //    jer RLS za production često blokira direktan INSERT iako postoji politika za magacin.
      let dbData: FileRow;
      if (useMoSupplierRpc) {
        const { data: rpcRow, error: rpcError } = await supabase.rpc("register_material_order_supplier_file", {
          p_job_id: jobIdForDb,
          p_material_order_id: materialOrderIdTrimmed,
          p_filename: prepared.name || file.name,
          p_size: formatSize(prepared.size),
          p_size_bytes: prepared.size,
          p_storage_key: objectKey,
          p_storage_url: storageUrl,
        });
        if (rpcError) throw rpcError;
        if (!rpcRow || typeof rpcRow !== "object") {
          throw new Error("Nepoznat odgovor servera pri čuvanju priloga.");
        }
        dbData = rpcRow as FileRow;
      } else {
        const { data, error: dbError } = await supabase
          .from("files")
          .insert([{
            job_id: jobIdForDb,
            material_order_id: materialOrderId ?? null,
            category,
            filename: prepared.name || file.name,
            size: formatSize(prepared.size),
            size_bytes: prepared.size,
            uploaded_by: uploadedBy,
            uploaded_at: new Date().toISOString(),
            storage_key: objectKey,
            storage_url: storageUrl,
          }])
          .select(`
          *,
          users (name)
        `)
          .single();

        if (dbError) throw dbError;
        dbData = data as FileRow;
      }

      if (jobIdForDb) {
        const displayName = prepared.name || file.name;
        const desc = materialOrderId
          ? `Prilog narudžbine materijala: ${displayName}`
          : `Dodat fajl (${labelFileCategory(category)}): ${displayName}`;
        try {
          await upsertSystemActivity({
            jobId: jobIdForDb,
            description: desc,
            systemKey: `file-uploaded:${dbData.id}`,
            authorId: uploadedBy,
          });
        } catch (err) {
          // Magacin (production) često nema RLS INSERT na activities za posao bez njihovog RN;
          // migracija production_activities_* proširuje dozvolu za system_key file-uploaded:*.
          if (useMoSupplierRpc) {
            console.warn("[use-files] upsertSystemActivity nakon priloga narudžbine:", err);
          } else {
            throw err;
          }
        }
      }

      const mapped = mapDbToFile(dbData as FileRow);
      return {
        ...mapped,
        type: prepared.type.startsWith("image/") ? "image" : "file",
      } as AppFile;
    },
    onSuccess: (data, variables) => {
      const jobForList = toNullableJobId(data.jobId) ?? toNullableJobId(variables.jobId);
      if (jobForList) {
        queryClient.invalidateQueries({ queryKey: ["files", jobForList] });
      }
      if (variables.materialOrderId) {
        void invalidateMaterialOrderFilesQueries(queryClient);
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      invalidateFilesStorageUsage(queryClient);
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Fajl uspešno otpremljen");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri otpremanju fajla", { description: getErrorMessage(err) });
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (id: string) => {
      const { data: row, error: fetchError } = await supabase
        .from("files")
        .select("storage_key, job_id, material_order_id")
        .eq("id", id)
        .single();
      if (fetchError) throw fetchError;
      if (row?.storage_key) {
        await deleteObjectFromR2(row.storage_key);
      }
      const { error } = await supabase.from("files").delete().eq("id", id);
      if (error) throw error;
      return {
        jobId: toNullableJobId(row?.job_id as string | null | undefined),
        hadMaterialOrder: Boolean(row?.material_order_id),
      };
    },
    onSuccess: (meta) => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      invalidateFilesStorageUsage(queryClient);
      if (meta?.jobId) {
        queryClient.invalidateQueries({ queryKey: ["files", meta.jobId] });
      }
      if (meta?.hadMaterialOrder) {
        void invalidateMaterialOrderFilesQueries(queryClient);
      }
      toast.success("Fajl obrisan");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri brisanju fajla", { description: getErrorMessage(err) });
    },
  });

  return {
    uploadFile,
    deleteFile,
  };
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};
