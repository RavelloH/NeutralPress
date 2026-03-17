"use client";

import Image from "next/image";

import MarqueeText from "@/blocks/collection/HeroGallery/client/MarqueeText";
import { ProcessedText } from "@/blocks/core/components";
import { GridItem } from "@/components/client/layout/RowGrid";
import CMSImage from "@/components/ui/CMSImage";
import { useConfig } from "@/context/ConfigContext";
import { useMobile } from "@/hooks/use-mobile";
import type { ProcessedImageData } from "@/lib/shared/image-common";

interface HomeTextSectionProps {
  title?: string;
  slogan?: string;
  titleBold?: boolean;
  sloganBold?: boolean;
  logoImage?: ProcessedImageData;
}

/**
 * HomeTextSection - 客户端组件
 * 根据设备类型渲染不同的内容结构
 */
export default function HomeTextSection({
  title,
  slogan,
  titleBold = true,
  sloganBold = false,
  logoImage,
}: HomeTextSectionProps) {
  const configuredAvatar = useConfig("site.avatar");
  const avatarSrc = configuredAvatar?.trim() ? configuredAvatar : "/avatar.jpg";
  const isMobile = useMobile();

  if (!title && !slogan) return null;

  return (
    <>
      {/* 标题区域 */}
      {isMobile ? (
        // 移动端：标题和标语各自独占一行
        <>
          {title && (
            <GridItem
              areas={[7]}
              width={9}
              height={0.3}
              className="flex items-center text-8xl overflow-hidden"
            >
              <MarqueeText
                text={title}
                direction="right"
                className={titleBold ? "font-bold" : ""}
              />
            </GridItem>
          )}
          {slogan && (
            <GridItem
              areas={title ? [8] : [7, 8, 9]}
              width={9}
              height={0.3}
              className="flex items-center text-8xl overflow-hidden"
            >
              <MarqueeText
                text={slogan}
                direction="left"
                className={sloganBold ? "font-bold" : ""}
              />
            </GridItem>
          )}
        </>
      ) : (
        // 桌面端：静态标题
        <GridItem
          areas={[7, 8, 9]}
          width={9}
          height={0.3}
          className="flex items-center text-8xl overflow-hidden"
        >
          {title && (
            <div
              data-parallax="-0.5"
              className={`p-12 ${titleBold ? "font-bold" : ""}`}
              data-fade-char
            >
              <h1>
                <ProcessedText text={title} inline />
              </h1>
            </div>
          )}
        </GridItem>
      )}

      {/* 桌面端标语区域 */}
      {!isMobile && slogan && (
        <GridItem
          areas={[10, 11, 12]}
          width={9}
          height={0.3}
          className="flex items-center justify-start text-8xl"
        >
          <div className="h-full aspect-square mr-4 relative">
            {logoImage ? (
              <CMSImage
                src={logoImage.url}
                width={logoImage.width}
                height={logoImage.height}
                blur={logoImage.blur}
                alt="logo"
                fill
                className="object-cover"
              />
            ) : (
              <Image
                src={avatarSrc}
                alt="logo"
                width={100}
                height={100}
                className="h-full w-auto object-cover"
              />
            )}
          </div>
          <div
            className="flex-1 flex items-center justify-end pr-12 text-8xl"
            data-fade
          >
            <span data-parallax="0.5" className={sloganBold ? "font-bold" : ""}>
              <ProcessedText text={slogan} inline />
            </span>
          </div>
        </GridItem>
      )}
    </>
  );
}
