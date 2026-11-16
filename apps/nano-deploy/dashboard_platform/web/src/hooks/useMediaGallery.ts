import type { MediaItem } from "../types";
import { usePaginatedGallery } from "./usePaginatedGallery";

export function useMediaGallery(token: string) {
  return usePaginatedGallery<MediaItem>({ token, path: "/api/media/gallery", keyOf: (item) => `${item.storage_kind}/${item.filename}` });
}
