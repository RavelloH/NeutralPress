"use client";

import { useEffect, useMemo, useState } from "react";
import { useInView } from "react-intersection-observer";

import GalleryGrid from "@/app/(build-in)/gallery/GalleryGrid";
import GalleryListMobile from "@/app/(build-in)/gallery/GalleryListMobile";
import HorizontalScroll from "@/components/client/layout/HorizontalScroll";
import { useMobile } from "@/hooks/use-mobile";
import { getGalleryPhotos } from "@/lib/client/api/media-read";
import type { GalleryPhoto, LayoutState, Tile } from "@/lib/gallery-layout";
import { generateLayout } from "@/lib/gallery-layout";
import { generateSkeletonPhotos } from "@/lib/gallery-skeleton";

interface GalleryClientProps {
  initialPhotos: GalleryPhoto[];
  initialCursor?: number;
}

export default function GalleryClient({
  initialPhotos,
  initialCursor,
}: GalleryClientProps) {
  const isMobile = useMobile();
  const initialResult = useMemo(
    () => generateLayout(initialPhotos),
    [initialPhotos],
  );

  const [tiles, setTiles] = useState<Tile[]>(initialResult.tiles);
  const [layoutState, setLayoutState] = useState<LayoutState>(
    initialResult.nextState,
  );
  const [cursor, setCursor] = useState<number | undefined>(initialCursor);
  const [isLoading, setIsLoading] = useState(false);

  const { ref, inView } = useInView({
    threshold: 0,
    // rootMargin is no longer needed as we position the sentinel at 80% of the list
  });

  // Generate skeleton tiles when loading
  const skeletonTiles = useMemo(() => {
    if (!isLoading) return [];
    // Generate 20 dummy photos
    const dummyPhotos = generateSkeletonPhotos(20);
    // Calculate layout for them based on current state (non-destructive)
    // IMPORTANT: We use a clone of layoutState inside generateLayout, so this is safe
    const { tiles: skelTiles } = generateLayout(dummyPhotos, layoutState);
    return skelTiles;
  }, [isLoading, layoutState]);

  // Combine real tiles and skeleton tiles for display
  const displayTiles = useMemo(() => {
    return [...tiles, ...skeletonTiles];
  }, [tiles, skeletonTiles]);

  useEffect(() => {
    if (inView && cursor && !isLoading) {
      const loadMore = async () => {
        setIsLoading(true);
        try {
          const response = await getGalleryPhotos({ cursorId: cursor });

          if (response.data && response.data.photos.length > 0) {
            const { photos: newPhotos, nextCursor } = response.data;
            // Use functional update to ensure we use the very latest layout state if multiple updates happened (unlikely here but good practice)
            // But we can't easily access 'latest state' inside async unless we use refs.
            // Relying on effect dependency [layoutState] is safe enough here because isLoading blocks concurrent runs.
            const result = generateLayout(newPhotos, layoutState);

            setTiles((prev) => [...prev, ...result.tiles]);
            setLayoutState(result.nextState);
            setCursor(nextCursor);
          } else {
            setCursor(undefined);
          }
        } catch (error) {
          console.error("Failed to load more photos", error);
        } finally {
          setIsLoading(false);
        }
      };

      loadMore();
    }
  }, [inView, cursor, isLoading, layoutState]);

  // Determine the sentinel tile (fixed buffer from the end)
  const sentinelTile = useMemo(() => {
    if (tiles.length === 0) return null;
    // Trigger load when user reaches 20 items from the end
    // This ensures a consistent buffer regardless of total list length
    const index = Math.max(0, tiles.length - 20);
    return tiles[index];
  }, [tiles]);

  if (isMobile) {
    return (
      <div className="h-full w-full">
        <GalleryListMobile tiles={displayTiles} />
        {/* Mobile Sentinel: Just a div at the bottom (or near bottom if we want pre-fetching) */}
        {cursor !== undefined && (
          <div ref={ref} className="h-10 w-full opacity-0" />
        )}
      </div>
    );
  }

  return (
    <HorizontalScroll className="h-full w-full [container-type:size]">
      <div
        className="relative grid h-full grid-flow-col grid-rows-4 gap-1 p-1"
        style={{
          // 强制每一列的宽度等于单行的高度
          gridAutoColumns: "calc((100cqh - 0.5rem - 0.75rem) / 4)",
        }}
      >
        <GalleryGrid tiles={displayTiles} />

        {/* Sentinel for Infinite Scroll Trigger */}
        {sentinelTile && cursor !== undefined && (
          <div
            ref={ref}
            className="pointer-events-none absolute h-full w-px opacity-0"
            style={{
              gridColumnStart: sentinelTile.col + 1,
              gridRowStart: 1, // Span full height to ensure intersection regardless of vertical scroll position (if any)
              gridRowEnd: "span 4",
            }}
          />
        )}
      </div>
    </HorizontalScroll>
  );
}
