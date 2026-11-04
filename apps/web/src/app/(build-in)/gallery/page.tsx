import GalleryClient from "@/app/(build-in)/gallery/GalleryClient";
import MainLayout from "@/components/client/layout/MainLayout";
import JsonLdScript from "@/components/server/seo/JsonLdScript";
import { getGalleryPhotosData } from "@/lib/server/media";
import { getRawPage } from "@/lib/server/page-cache";
import { generateJsonLdGraph, generateMetadata } from "@/lib/server/seo";

export const revalidate = false;

const page = await getRawPage("/gallery");

export const metadata = await generateMetadata(
  {
    title: page?.title,
    description: page?.metaDescription,
    keywords: page?.metaKeywords,
    robots: {
      index: page?.robotsIndex,
    },
  },
  {
    pathname: "/gallery",
  },
);

export default async function GalleryIndex() {
  const { photos, nextCursor } = await getGalleryPhotosData({});
  const jsonLdGraph = await generateJsonLdGraph({
    kind: "gallery",
    pathname: "/gallery",
    title: page?.title || "画廊",
    description: page?.metaDescription || "浏览站点画廊照片",
    keywords: page?.metaKeywords || "画廊,照片,摄影",
    robots: {
      index: page?.robotsIndex,
    },
    updatedAt: page?.updatedAt,
    breadcrumb: [
      { name: "首页", item: "/" },
      { name: "画廊", item: "/gallery" },
    ],
    gallery: {
      items: photos.slice(0, 12).map((photo) => ({
        name: photo.name,
        url: `/gallery/photo/${photo.slug}`,
        image: photo.imageUrl,
        description: photo.alt || undefined,
      })),
    },
  });

  return (
    <MainLayout type="horizontal">
      <JsonLdScript id="jsonld-gallery" graph={jsonLdGraph} />
      <GalleryClient initialPhotos={photos} initialCursor={nextCursor} />
    </MainLayout>
  );
}
