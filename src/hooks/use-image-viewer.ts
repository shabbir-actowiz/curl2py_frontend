import { useState, useCallback } from "react";

export interface ImageData {
  filename: string;
  url: string;
  index: number;
}

export function useImageViewer() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [images, setImages] = useState<ImageData[]>([]);

  const openViewer = useCallback((imageList: ImageData[], startIndex = 0) => {
    setImages(imageList);
    setSelectedIndex(Math.max(0, Math.min(startIndex, imageList.length - 1)));
    setIsOpen(true);
  }, []);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
  }, []);

  const selectImage = useCallback((index: number) => {
    setSelectedIndex(Math.max(0, Math.min(index, images.length - 1)));
  }, [images.length]);

  return {
    isOpen,
    selectedIndex,
    images,
    openViewer,
    closeViewer,
    selectImage,
  };
}
