import { ImageResponse } from "next/og";

import { getConfigs } from "@/lib/server/config-cache";

interface IconMetadata {
  contentType: string;
  size: { width: number; height: number };
  id: string;
}

// 启用缓存
export const revalidate = 3600;
export const dynamic = "force-dynamic";

const FALLBACK_SITE_URL = "http://localhost:3000";
const FALLBACK_FAVICON_PATH = "/icon.png";

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function resolveSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim();
  if (!trimmed) {
    return FALLBACK_SITE_URL;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return FALLBACK_SITE_URL;
  }
}

function resolveFaviconUrl(favicon: string, siteUrl: string): string {
  const trimmedFavicon = favicon.trim();
  const normalizedFavicon = trimmedFavicon || FALLBACK_FAVICON_PATH;

  if (isExternalUrl(normalizedFavicon)) {
    return normalizedFavicon;
  }

  const normalizedPath = normalizedFavicon.startsWith("/")
    ? normalizedFavicon
    : `/${normalizedFavicon}`;

  try {
    return new URL(normalizedPath, resolveSiteUrl(siteUrl)).toString();
  } catch {
    return new URL(FALLBACK_FAVICON_PATH, FALLBACK_SITE_URL).toString();
  }
}

export function generateImageMetadata(): IconMetadata[] {
  return [
    {
      contentType: "image/png",
      size: { width: 16, height: 16 },
      id: "16x",
    },
    {
      contentType: "image/png",
      size: { width: 32, height: 32 },
      id: "32x",
    },
    {
      contentType: "image/png",
      size: { width: 36, height: 36 },
      id: "36x",
    },
    {
      contentType: "image/png",
      size: { width: 48, height: 48 },
      id: "48x",
    },
    {
      contentType: "image/png",
      size: { width: 72, height: 72 },
      id: "72x",
    },
    {
      contentType: "image/png",
      size: { width: 96, height: 96 },
      id: "96x",
    },
    {
      contentType: "image/png",
      size: { width: 128, height: 128 },
      id: "128x",
    },
    {
      contentType: "image/png",
      size: { width: 144, height: 144 },
      id: "144x",
    },
    {
      contentType: "image/png",
      size: { width: 192, height: 192 },
      id: "192x",
    },
    {
      contentType: "image/png",
      size: { width: 256, height: 256 },
      id: "256x",
    },
    {
      contentType: "image/png",
      size: { width: 384, height: 384 },
      id: "384x",
    },
    {
      contentType: "image/png",
      size: { width: 512, height: 512 },
      id: "512x",
    },
    {
      contentType: "image/png",
      size: { width: 1024, height: 1024 },
      id: "1024x",
    },
  ];
}

export default async function Icon({
  id,
}: {
  id: string | Promise<string>;
  params?: { __metadata_id__: string };
}) {
  const metadataId = await id;
  const [favicon, siteUrl] = await getConfigs(["site.favicon", "site.url"]);
  const iconSrc = resolveFaviconUrl(favicon, siteUrl);

  console.log("Generating icon for metadata ID:", metadataId);

  // 从 metadata 中查找匹配的尺寸
  const metadata = generateImageMetadata();
  const metadataItem = metadata.find((item) => item.id === metadataId);
  const size = metadataItem?.size.width || 192; // 默认 192

  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={iconSrc} width={size} height={size} alt="Icon" />
    ),
    {
      width: size,
      height: size,
      headers: {
        // 浏览器缓存 1 年，但在后台 1 天后可能重新验证 (SWR)
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "image/png",
        // 尝试在这里声明只 Vary 编码，但通常会被 Next.js 覆盖，所以需要 Middleware
        Vary: "Accept-Encoding",
      },
    },
  );
}
