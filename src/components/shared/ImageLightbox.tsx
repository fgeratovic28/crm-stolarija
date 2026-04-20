import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ImageLightboxProps = {
  src: string | null;
  onClose: () => void;
};

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [src]);

  if (typeof document === "undefined" || !src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/88 p-4"
      onClick={onClose}
      role="presentation"
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full bg-background/90 p-2 text-foreground shadow-md hover:bg-background z-[1]"
        onClick={onClose}
        aria-label="Zatvori"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt=""
        className="max-h-[min(90dvh,900px)] max-w-full w-auto object-contain shadow-2xl rounded-sm"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body
  );
}
