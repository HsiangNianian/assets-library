/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

export function MediaPreview({
  mediaType,
  src,
  name,
  className,
}: {
  mediaType: "image" | "video";
  src: string;
  name: string;
  className?: string;
}) {
  if (mediaType === "video") {
    return (
      <video
        className={cn("h-full w-full bg-slate-950 object-contain", className)}
        src={src}
        controls
        preload="metadata"
        aria-label={name}
      />
    );
  }
  // API-served user media cannot use Next image optimization safely.
  return (
    <img
      className={cn("h-full w-full object-cover", className)}
      src={src}
      alt={name}
    />
  );
}
