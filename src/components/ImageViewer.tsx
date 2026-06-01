import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, RotateCw, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ImageViewerProps {
  images: Array<{ filename: string; url: string; index: number }>;
  initialIndex?: number;
  onClose: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;

export default function ImageViewer({ images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const currentImage = images[currentIndex];

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") handlePrevious();
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "+") handleZoomIn();
      if (e.key === "-") handleZoomOut();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, images.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
    resetView();
  }, [images.length]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    resetView();
  }, [images.length]);

  const resetView = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setError(null);
    setIsLoading(true);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  };

  const handleFitToScreen = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleMouseWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    const maxPan = (zoom - 1) * 100;
    setPan({
      x: Math.max(-maxPan, Math.min(maxPan, newX)),
      y: Math.max(-maxPan, Math.min(maxPan, newY)),
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      setDragStart({ x: distance, y: 0 });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const delta = distance - dragStart.x;
      if (Math.abs(delta) > 5) {
        setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta * 0.01)));
      }
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(currentImage.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = currentImage.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch (err) {
      toast.error("Failed to download image");
    }
  };

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setError("Failed to load image");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 font-mono"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 bg-black/50 px-4 py-3 text-[12px] text-foreground">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            {currentIndex + 1} / {images.length}
          </span>
          <span className="text-muted-foreground">{currentImage.filename}</span>
          <span className="text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-sm p-1 hover:bg-white/10"
          title="Close (ESC)"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* Main viewer area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden bg-black cursor-grab active:cursor-grabbing"
        onWheel={handleMouseWheel}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {isLoading && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
            <span className="text-[11px]">Loading image...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 text-destructive">
            <span className="text-[12px]">{error}</span>
          </div>
        )}

        {!error && (
          <img
            ref={imageRef}
            src={currentImage.url}
            alt={currentImage.filename}
            onLoad={handleImageLoad}
            onError={handleImageError}
            className="max-h-full max-w-full select-none"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg) translate(${pan.x}px, ${pan.y}px)`,
              transition: isDragging ? "none" : "transform 0.1s ease-out",
            }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border-t border-border/30 bg-black/50 px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Navigation */}
          {images.length > 1 && (
            <>
              <button
                onClick={handlePrevious}
                className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40 disabled:opacity-50"
                title="Previous (←)"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                onClick={handleNext}
                className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40 disabled:opacity-50"
                title="Next (→)"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={handleZoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40 disabled:opacity-50"
            title="Zoom Out (-)"
          >
            <ZoomOut className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            onClick={handleFitToScreen}
            className="rounded-sm border border-border/50 bg-background/20 px-2 py-1.5 text-[11px] hover:bg-background/40"
            title="Fit to screen"
          >
            Fit
          </button>
          <button
            onClick={handleZoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40 disabled:opacity-50"
            title="Zoom In (+)"
          >
            <ZoomIn className="h-4 w-4" strokeWidth={2} />
          </button>

          {/* Rotation */}
          <div className="w-px h-6 bg-border/30" />
          <button
            onClick={handleRotate}
            className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40"
            title="Rotate 90°"
          >
            <RotateCw className="h-4 w-4" strokeWidth={2} />
          </button>

          {/* Download */}
          <div className="w-px h-6 bg-border/30" />
          <button
            onClick={handleDownload}
            className="rounded-sm border border-border/50 bg-background/20 p-1.5 hover:bg-background/40"
            title="Download"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="border-t border-border/30 bg-black/50 px-4 py-2 text-[10px] text-muted-foreground">
        <span>ESC: close • ←/→: navigate • +/-: zoom • Scroll: zoom • Drag: pan • Pinch: zoom (mobile)</span>
      </div>
    </div>
  );
}
