import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AppFile, FileCategory } from "@/types";
import { toast } from "sonner";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelFileCategory } from "@/lib/activity-labels";

export interface UploadFileInput {
  jobId?: string;
  category: FileCategory;
  file: File;
  uploadedBy: string;
}

type FileRow = {
  id: string;
  job_id?: string;
  filename: string;
  category: FileCategory;
  size: string;
  uploaded_at: string;
  users?: { name?: string } | { name?: string }[] | null;
};

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

export const mapDbToFile = (d: FileRow): AppFile => {
  const userData = Array.isArray(d.users) ? d.users[0] : d.users;
  return {
    id: d.id,
    jobId: d.job_id,
    name: d.filename,
    category: d.category,
    size: d.size,
    uploadedBy: userData?.name || "Sistem",
    uploadedAt: d.uploaded_at,
    type: "file",
  };
};

export function useAllFiles() {
  return useQuery({
    queryKey: ["files", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("files")
        .select(`
          *,
          users (name)
        `)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToFile(row as FileRow));
    },
  });
}

export function useFiles() {
  const queryClient = useQueryClient();

  const uploadFile = useMutation({
    mutationFn: async (input: UploadFileInput) => {
      const { jobId, category, file, uploadedBy } = input;
      
      // 1. Upload to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = jobId ? `jobs/${jobId}/${fileName}` : `misc/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("files")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 2. Insert into files table
      const { data: dbData, error: dbError } = await supabase
        .from("files")
        .insert([{
          job_id: jobId,
          category,
          filename: file.name,
          size: formatSize(file.size),
          uploaded_by: uploadedBy,
          uploaded_at: new Date().toISOString(),
          // storage_path: filePath // if column exists
        }])
        .select(`
          *,
          users (name)
        `)
        .single();

      if (dbError) throw dbError;

      if (jobId) {
        await upsertSystemActivity({
          jobId,
          description: `Dodat fajl (${labelFileCategory(category)}): ${file.name}`,
          systemKey: `file-uploaded:${dbData.id}`,
          authorId: uploadedBy,
        });
      }

      const mapped = mapDbToFile(dbData as FileRow);
      return {
        ...mapped,
        type: file.type.startsWith("image/") ? "image" : "file",
      } as AppFile;
    },
    onSuccess: (_, variables) => {
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["files", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Fajl uspešno otpremljen");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri otpremanju fajla", { description: getErrorMessage(err) });
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (id: string) => {
      // Note: In a real app, you'd also delete from Storage. 
      // But we need the storage path which isn't in our current schema's files table.
      // For now, just delete from DB.
      const { error } = await supabase.from("files").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
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
