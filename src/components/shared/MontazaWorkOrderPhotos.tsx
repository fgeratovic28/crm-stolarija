import { useRef } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useMontazaPhotos,
  useUploadMontazaPhoto,
  useDeleteMontazaPhoto,
} from "@/hooks/use-montaza-photos";

type MontazaWorkOrderPhotosProps = {
  workOrderId: string;
};

export function MontazaWorkOrderPhotos({ workOrderId }: MontazaWorkOrderPhotosProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: rows = [], isLoading } = useMontazaPhotos(workOrderId);
  const upload = useUploadMontazaPhoto();
  const remove = useDeleteMontazaPhoto();

  const stopParent = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await upload.mutateAsync({ workOrderId, file });
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border" onClick={stopParent}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">Fotografije montaže</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          disabled={upload.isPending}
          onClick={(e) => {
            stopParent(e);
            onPick();
          }}
        >
          {upload.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5 mr-1" />
          )}
          Dodaj sliku
        </Button>
        <span className="text-[10px] text-muted-foreground">do 1 MB, max 1920px</span>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : rows.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <div key={r.id} className="relative group w-16 h-16 rounded-md overflow-hidden border border-border bg-muted shrink-0">
              <img src={r.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  stopParent(e);
                  remove.mutate(r);
                }}
                disabled={remove.isPending}
                aria-label="Obriši sliku"
              >
                <Trash2 className="h-4 w-4 text-white" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
