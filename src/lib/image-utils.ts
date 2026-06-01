import { getIssueFileUrl } from "./api";

/**
 * Image utility functions for preview system
 */

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];

/**
 * Check if a filename is an image
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get image MIME type from filename
 */
export function getImageMimeType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  };
  return mimeTypes[ext] || "image/jpeg";
}

/**
 * Generate thumbnail URL for an issue file
 * Uses the full image URL as thumbnail (browser will cache it)
 */
export function getThumbnailUrl(issueId: string, fileIndex: number): string {
  return getIssueFileUrl(issueId, fileIndex);
}

/**
 * Generate full image URL for viewing
 */
export function getImageUrl(issueId: string, fileIndex: number): string {
  return getIssueFileUrl(issueId, fileIndex);
}

/**
 * Filter and map files to image data
 */
export function extractImageFiles(
  issueId: string,
  files: Array<{ filename: string; index?: number }>,
  fileStartIndex = 0
) {
  return files
    .map((file, idx) => ({
      filename: file.filename,
      index: typeof file.index === "number" ? file.index : fileStartIndex + idx,
    }))
    .filter((file) => isImageFile(file.filename))
    .map((file) => ({
      filename: file.filename,
      url: getImageUrl(issueId, file.index),
      index: file.index,
    }));
}
