import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { publicUrlWithCacheBust } from "@/lib/r2-storage";

function extLower(name: string) {
  const m = name.trim().match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : "";
}

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

export function isPdfFile(name: string, mime?: string) {
  if (mime === "application/pdf") return true;
  return extLower(name) === "pdf";
}

export function isImageFile(name: string, mime?: string) {
  if (mime?.startsWith("image/")) return true;
  return IMG_EXT.has(extLower(name));
}

export function isWordFile(name: string, mime?: string) {
  if (mime === "application/msword") return true;
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  const e = extLower(name);
  return e === "doc" || e === "docx";
}

/** Pregled fajla iz `files` (R2 javni URL) — PDF u iframe-u, slike kao `<img>`, Word preko Office pregleda. */
export function StoredFileInlinePreview({
  fileId,
  enabled = true,
}: {
  fileId: string;
  enabled?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["file-inline-preview", fileId],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("files")
        .select("filename, storage_url")
        .eq("id", fileId)
        .single();
      if (error) throw error;
      return row as { filename: string; storage_url?: string | null };
    },
    enabled: enabled && !!fileId,
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Učitavanje pregleda…</p>;
  }
  if (isError || !data?.storage_url) {
    return null;
  }

  const url = publicUrlWithCacheBust(data.storage_url);
  const name = data.filename || "";

  if (isPdfFile(name)) {
    return (
      <iframe
        title="Pregled dokumenta"
        src={url}
        className="w-full min-h-[22rem] sm:min-h-[28rem] rounded-md border border-border bg-background"
      />
    );
  }
  if (isWordFile(name)) {
    const embedSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    return (
      <iframe
        title="Pregled Word dokumenta"
        src={embedSrc}
        className="w-full min-h-[22rem] sm:min-h-[28rem] rounded-md border border-border bg-background"
      />
    );
  }
  if (isImageFile(name)) {
    return (
      <img
        src={url}
        alt=""
        className="max-h-80 w-full rounded-md border border-border object-contain bg-background"
      />
    );
  }
  return null;
}

/** Lokalni fajl pre čuvanja (slike i PDF u pregledu). */
export function LocalFileInlinePreview({ file }: { file: File | null }) {
  const url = useMemo(() => {
    if (!file) return null;
    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!file) return null;
  if (!url) {
    return <p className="text-xs text-muted-foreground break-all">{file.name}</p>;
  }
  if (file.type === "application/pdf") {
    return (
      <iframe
        title="Pregled PDF"
        src={url}
        className="w-full min-h-[14rem] rounded-md border border-border bg-background"
      />
    );
  }
  return (
    <img src={url} alt="" className="max-h-40 w-full rounded-md border border-border object-contain bg-background" />
  );
}
