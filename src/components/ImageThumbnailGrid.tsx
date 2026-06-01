import { useState, useEffect } from "react";
import { Loader2, AlertCircle } from "lucide-react";

interface ThumbnailProps {
  filename: string;
  url: string;
  index: number;
  onSelect: (index: number) => void;
}

function Thumbnail({ filename, url, index, onSelect }: ThumbnailProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <button
      onClick={() => onSelect(index)}
      className="group relative h-24 w-24 overflow-hidden rounded-sm border border-border bg-background/50 hover:border-primary/60 hover:bg-background/80 transition-all"
      title={filename}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" strokeWidth={2} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <AlertCircle className="h-4 w-4 text-destructive" strokeWidth={2} />
        </div>
      )}

      <img
        src={url}
        alt={filename}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setError(true);
        }}
        className={`h-full w-full object-cover ${isLoading || error ? "hidden" : ""}`}
      />

      {/* Filename tooltip on hover */}
      <div className="absolute bottom-0 left-0 right-0 translate-y-full bg-background/95 px-2 py-1 text-[10px] text-foreground opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 border-t border-border/50">
        <div className="truncate">{filename}</div>
      </div>
    </button>
  );
}

interface ImageThumbnailGridProps {
  images: Array<{ filename: string; url: string; index: number }>;
  onSelectImage: (index: number) => void;
  imageCount?: number;
}

export default function ImageThumbnailGrid({
  images,
  onSelectImage,
  imageCount,
}: ImageThumbnailGridProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground font-semibold">
          Images ({images.length})
        </div>
        {imageCount && imageCount > images.length && (
          <div className="text-[10px] text-muted-foreground">
            +{imageCount - images.length} more
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {images.map((image, imagePosition) => (
          <Thumbnail
            key={`${image.filename}-${image.index}`}
            filename={image.filename}
            url={image.url}
            index={image.index}
            onSelect={() => onSelectImage(imagePosition)}
          />
        ))}
      </div>
    </div>
  );
}
