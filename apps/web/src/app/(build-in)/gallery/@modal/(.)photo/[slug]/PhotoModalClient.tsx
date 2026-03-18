"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RiCloseLine, RiLoader4Line } from "@remixicon/react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";

import CMSImage from "@/components/ui/CMSImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import Link from "@/components/ui/Link";
import UserAvatar from "@/components/ui/UserAvatar";
import { useMobile } from "@/hooks/use-mobile";
import {
  formatAperture,
  formatColorSpace,
  formatDateTime,
  formatExposureBias,
  formatExposureMode,
  formatExposureProgram,
  formatExposureTime,
  formatFlash,
  formatFocalLength,
  formatGPS,
  formatLensSpec,
  formatMeteringMode,
  formatSceneCaptureType,
  formatSensingMethod,
  formatShotDateTime,
  formatWhiteBalance,
  type ParsedExifData,
  parseExifBuffer,
} from "@/lib/client/media-exif";
import { useGalleryLightboxStore } from "@/store/gallery-lightbox-store";
import { Drawer } from "@/ui/Drawer";

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// 格式化分辨率
function formatResolution(
  xRes: number | undefined,
  yRes: number | undefined,
  unit: number | undefined,
): string {
  if (xRes === undefined || yRes === undefined) return "";
  const unitStr = unit === 2 ? "dpi" : unit === 3 ? "dpcm" : "dpi";
  return `${xRes} × ${yRes} ${unitStr}`;
}

// 格式化 GPS 方向
function formatGpsDirection(direction: number): string {
  return `${direction.toFixed(1)}° (罗盘方位)`;
}

// 格式化定位精度
function formatGpsAccuracy(error: number): string {
  return `±${error.toFixed(1)}m`;
}

// 格式化移动速度
function formatGpsSpeed(speed: number, ref?: string): string {
  // 根据 ref 转换单位，默认为 K (km/h)
  // K = km/h, M = mph, N = knots
  let unit = "km/h";
  if (ref === "M") {
    unit = "mph";
  } else if (ref === "N") {
    unit = "节";
  }
  return `${speed.toFixed(1)} ${unit}`;
}

interface PhotoWithMedia {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  size: string;
  showExif: boolean;
  hideGPS: boolean;
  overrideExif: unknown;
  shotAt: Date | null;
  sortTime: Date;
  createdAt: Date;
  updatedAt: Date;
  media: {
    shortHash: string;
    width: number | null;
    height: number | null;
    blur: string | null;
    altText: string | null;
    exif: unknown;
    size: number;
    createdAt: Date;
    user: {
      uid: number;
      username: string;
      nickname: string | null;
      avatar: string | null;
      bio: string | null;
      emailMd5: string | null;
    };
  };
}

interface PhotoModalClientProps {
  photo: PhotoWithMedia;
  imageUrl: string;
  imageType: "wide" | "tall" | "square";
}

export default function PhotoModalClient({
  photo,
  imageUrl,
  imageType: _imageType,
}: PhotoModalClientProps) {
  const router = useRouter();
  const isMobile = useMobile();
  const [isOpen, setIsOpen] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [hdImageLoaded, setHdImageLoaded] = useState(false);
  const [openAnimationComplete, setOpenAnimationComplete] = useState(false);
  const [mounted, setMounted] = useState(false);

  // EXIF 解析状态
  const [parsedExif, setParsedExif] = useState<ParsedExifData | null>(null);
  const [exifLoading, setExifLoading] = useState(false);

  // 客户端挂载检测
  useEffect(() => {
    setMounted(true);
  }, []);

  // 从 store 获取源位置信息
  const sourceRect = useGalleryLightboxStore((s) => s.sourceRect);
  const openedPhotoId = useGalleryLightboxStore((s) => s.openedPhotoId);
  const thumbnailUrl = useGalleryLightboxStore((s) => s.thumbnailUrl);
  const clearStore = useGalleryLightboxStore((s) => s.clear);

  // 隐藏原图
  const hideOriginalImage = useCallback(() => {
    if (openedPhotoId !== null) {
      const originalImage = document.querySelector<HTMLDivElement>(
        `[data-gallery-image="${openedPhotoId}"]`,
      );
      if (originalImage) {
        // 立即隐藏，禁用 transition
        originalImage.style.transition = "none";
        originalImage.style.opacity = "0";
      }
    }
  }, [openedPhotoId]);

  // 恢复原图可见性
  const restoreOriginalImage = useCallback(() => {
    if (openedPhotoId !== null) {
      const originalImage = document.querySelector<HTMLDivElement>(
        `[data-gallery-image="${openedPhotoId}"]`,
      );
      if (originalImage) {
        // 立即显示，禁用 transition 避免闪烁
        originalImage.style.transition = "none";
        originalImage.style.opacity = "1";
        // 下一帧恢复 transition
        requestAnimationFrame(() => {
          originalImage.style.transition = "";
        });
      }
    }
  }, [openedPhotoId]);

  // 缩略图加载完成后的回调 - 此时再隐藏原图
  const handleThumbnailLoad = useCallback(() => {
    hideOriginalImage();
  }, [hideOriginalImage]);

  // 兜底：确保在组件挂载后尝试隐藏原图，防止缩略图加载失败时原图依然可见
  useEffect(() => {
    if (mounted) {
      hideOriginalImage();
    }
  }, [mounted, hideOriginalImage]);

  // 动画状态兜底：防止 spring 动画回调偶发不触发
  useEffect(() => {
    if (isOpen && !isClosing) {
      const timer = setTimeout(() => {
        setOpenAnimationComplete(true);
      }, 1000); // 1s 足够 spring 动画达到基本静止状态
      return () => clearTimeout(timer);
    }
  }, [isOpen, isClosing]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
  }, [isClosing]);

  // 动画完成后的处理
  const handleAnimationComplete = useCallback(
    (definition: string) => {
      if (definition === "open") {
        setOpenAnimationComplete(true);
      } else if (definition === "closed") {
        restoreOriginalImage();
        clearStore();
        setIsOpen(false);
        router.back();
      }
    },
    [restoreOriginalImage, clearStore, router],
  );

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen && !isClosing) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      // 只有非移动端才在这里禁用 body 滚动，移动端由 Drawer 处理或不需要
      if (!isMobile) {
        document.body.style.overflow = "hidden";
      }
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, isClosing, handleClose, isMobile]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
      // 组件卸载时恢复原图可见性（处理浏览器返回等情况）
      if (openedPhotoId !== null) {
        const originalImage = document.querySelector<HTMLDivElement>(
          `[data-gallery-image="${openedPhotoId}"]`,
        );
        if (originalImage) {
          originalImage.style.transition = "none";
          originalImage.style.opacity = "1";
          requestAnimationFrame(() => {
            originalImage.style.transition = "";
          });
        }
      }
    };
  }, [openedPhotoId]);

  // 解析 EXIF 数据
  useEffect(() => {
    const parseExifData = async () => {
      // 如果不显示 EXIF，跳过
      if (!photo.showExif) {
        setParsedExif(null);
        return;
      }

      // 如果没有 EXIF 数据，跳过
      if (!photo.media.exif) {
        setParsedExif(null);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exifData = photo.media.exif as any;

      // 如果有 raw 数据，尝试解析
      if (exifData.raw) {
        try {
          setExifLoading(true);

          // raw 数据可能是 Buffer 对象被序列化后的格式
          let buffer: Buffer;

          if (
            exifData.raw.type === "Buffer" &&
            Array.isArray(exifData.raw.data)
          ) {
            buffer = Buffer.from(exifData.raw.data);
          } else if (typeof exifData.raw === "string") {
            buffer = Buffer.from(exifData.raw, "base64");
          } else if (
            exifData.raw instanceof ArrayBuffer ||
            exifData.raw instanceof Uint8Array
          ) {
            buffer = Buffer.from(exifData.raw);
          } else {
            setExifLoading(false);
            return;
          }

          let parsed = parseExifBuffer(buffer);

          if (parsed) {
            // 如果 hideGPS 为 true，过滤 GPS 信息
            if (photo.hideGPS) {
              parsed.latitude = undefined;
              parsed.longitude = undefined;
              parsed.altitude = undefined;
              parsed.gpsImgDirection = undefined;
              parsed.gpsSpeed = undefined;
              parsed.gpsSpeedRef = undefined;
              parsed.gpsHPositioningError = undefined;
              parsed.gpsDateTime = undefined;
            }

            // 合并 overrideExif 到解析后的 EXIF 中（覆盖相同字段）
            if (
              photo.overrideExif &&
              typeof photo.overrideExif === "object" &&
              !Array.isArray(photo.overrideExif)
            ) {
              parsed = {
                ...parsed,
                ...(photo.overrideExif as Partial<ParsedExifData>),
              };
            }

            setParsedExif(parsed);
          }
          setExifLoading(false);
        } catch (error) {
          console.error("解析 EXIF 数据失败:", error);
          setExifLoading(false);
        }
      } else {
        setExifLoading(false);
      }
    };

    parseExifData();
  }, [photo.media.exif, photo.showExif, photo.hideGPS, photo.overrideExif]);

  // 计算图片的目标位置和尺寸
  const geometry = useMemo(() => {
    if (typeof window === "undefined") return null;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 获取根元素的 font-size（通常是 16px）
    const rootFontSize = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );

    // 信息区域尺寸（使用 em 单位计算）
    const infoWidthEm = 20; // 信息区域宽度（右侧时）约 20em
    const infoHeightEm = 10; // 信息区域高度（下方时）约 10em
    const infoWidth = infoWidthEm * rootFontSize;
    const infoHeight = infoHeightEm * rootFontSize;
    const gap = 0; // 图片和信息区域的间距

    // 判断信息区域位置
    // 手机端使用 Drawer，信息区域不参与几何计算（覆盖式），图片占据主要区域
    // 电脑端在右侧
    const infoPosition = isMobile ? "drawer" : "right";

    // 计算可用于图片的最大空间
    let maxImageWidth: number;
    let maxImageHeight: number;

    if (infoPosition === "right") {
      // 信息在右侧：图片宽度要减去信息区域宽度
      maxImageWidth = viewportWidth * 0.9 - infoWidth - gap;
      maxImageHeight = viewportHeight * 0.85;
    } else {
      // 手机端（Drawer）：图片占据上方大部分空间，留出底部给 Drawer peek
      // Drawer peek 设置为 35% (0.35)
      // 为了完全不重叠，我们将图片的最大高度限制在 60% 以内
      maxImageWidth = viewportWidth;
      maxImageHeight = viewportHeight * 0.6;
    }

    // 图片原始尺寸
    const naturalWidth = photo.media.width || 800;
    const naturalHeight = photo.media.height || 600;

    // 计算适配的尺寸
    const widthRatio = maxImageWidth / naturalWidth;
    const heightRatio = maxImageHeight / naturalHeight;
    const fitScale = Math.min(widthRatio, heightRatio, 1);

    const targetWidth = naturalWidth * fitScale;
    const targetHeight = naturalHeight * fitScale;

    // 计算整体容器尺寸
    let containerWidth: number;
    let containerHeight: number;

    if (infoPosition === "right") {
      containerWidth = targetWidth + infoWidth + gap;
      containerHeight = targetHeight;
    } else {
      // Drawer 模式下容器就是图片本身
      containerWidth = targetWidth;
      containerHeight = targetHeight;
    }

    // 整体容器居中位置
    const containerX = (viewportWidth - containerWidth) / 2;
    // 手机端让图片在抽屉之上可见区域 (65%) 内居中
    const containerY =
      infoPosition === "right"
        ? (viewportHeight - containerHeight) / 2
        : (viewportHeight * 0.65 - containerHeight) / 2;

    // 图片在容器内的位置
    const imageX = containerX;
    const imageY = containerY;

    // 初始位置（从 store 获取或使用默认值）
    const initialRect = sourceRect || {
      top: viewportHeight / 2 - targetHeight / 2,
      left: viewportWidth / 2 - targetWidth / 2,
      width: targetWidth,
      height: targetHeight,
    };

    return {
      initialRect,
      targetRect: {
        x: imageX,
        y: imageY,
        width: targetWidth,
        height: targetHeight,
      },
      infoPosition,
      infoWidth,
      infoHeight,
      containerWidth,
      containerHeight,
      containerX,
      containerY,
    };
  }, [photo.media.width, photo.media.height, sourceRect, isMobile]);

  // 如果没有 geometry，不渲染
  if (!geometry) return null;

  // 上传者信息
  const uploader = photo.media.user;

  // 信息区域内容
  const InfoContent = (
    <div className={`space-y-6 ${isMobile ? "pb-10" : ""}`}>
      {/* 标题和描述 */}
      <div>
        <h1
          className={`mb-2 font-bold text-foreground truncate ${
            isMobile ? "text-2xl" : "text-lg"
          }`}
        >
          {photo.name}
        </h1>
        {photo.description && (
          <p
            className={`${isMobile ? "text-base" : "text-sm"} text-muted-foreground`}
          >
            {photo.description}
          </p>
        )}
      </div>

      {/* 上传者信息 */}
      <div className="border-t border-foreground/10 pt-4">
        <h3
          className={`mb-3 font-semibold text-foreground/80 ${
            isMobile ? "text-base" : "sm"
          }`}
        >
          上传者
        </h3>
        <Link href={`/user/${uploader.uid}`} className="no-underline">
          <div className="flex items-center gap-3">
            <UserAvatar
              username={uploader.nickname || uploader.username}
              avatarUrl={uploader.avatar}
              emailMd5={uploader.emailMd5}
              size={isMobile ? 44 : 36}
              shape="circle"
            />
            <div className="flex-1 min-w-0">
              <div
                className={`font-medium text-foreground truncate ${
                  isMobile ? "text-base" : "text-sm"
                }`}
              >
                {uploader.nickname || uploader.username}
              </div>
              {uploader.nickname && (
                <div
                  className={`text-muted-foreground truncate ${
                    isMobile ? "text-sm" : "text-xs"
                  }`}
                >
                  @{uploader.username}
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* 基本信息 */}
      <div className="border-t border-foreground/10 pt-4">
        <h3
          className={`mb-3 font-semibold text-foreground/80 ${
            isMobile ? "text-base" : "text-sm"
          }`}
        >
          图片信息
        </h3>
        <div
          className={`grid ${
            isMobile ? "grid-cols-1 gap-y-4" : "grid-cols-2 gap-x-4 gap-y-2"
          } ${isMobile ? "text-sm" : "text-xs"}`}
        >
          {photo.media.width && photo.media.height && (
            <div>
              <span className="text-muted-foreground">尺寸</span>
              <p className="text-foreground font-medium">
                {photo.media.width} × {photo.media.height}
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">文件大小</span>
            <p className="text-foreground font-medium">
              {formatFileSize(photo.media.size)}
            </p>
          </div>
          {/* 优先显示 EXIF 中的拍摄时间 */}
          {photo.showExif && parsedExif?.dateTimeOriginal ? (
            <div className={isMobile ? "" : "col-span-2"}>
              <span className="text-muted-foreground">拍摄时间</span>
              <p className="text-foreground font-medium">
                {(() => {
                  const parts = formatShotDateTime(
                    parsedExif.dateTimeOriginal,
                    parsedExif.offsetTime,
                    parsedExif.subSecTime,
                  );
                  if (!parts) return null;
                  return (
                    <>
                      {parts.dateStr}
                      {parts.offsetTime && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ({parts.offsetTime})
                        </span>
                      )}
                      {parts.subSecTime && (
                        <span className="text-muted-foreground font-normal">
                          .{parts.subSecTime}
                        </span>
                      )}
                    </>
                  );
                })()}
              </p>
            </div>
          ) : photo.shotAt ? (
            <div>
              <span className="text-muted-foreground">拍摄时间</span>
              <p className="text-foreground font-medium">
                {formatDateTime(photo.shotAt)}
              </p>
            </div>
          ) : null}
          <div>
            <span className="text-muted-foreground">上传时间</span>
            <p className="text-foreground font-medium">
              {formatDateTime(photo.media.createdAt)}
            </p>
          </div>
          {/* 分辨率（DPI） */}
          {photo.showExif &&
            parsedExif &&
            (parsedExif.xResolution || parsedExif.yResolution) && (
              <div>
                <span className="text-muted-foreground">分辨率</span>
                <p className="text-foreground font-medium">
                  {formatResolution(
                    parsedExif.xResolution,
                    parsedExif.yResolution,
                    parsedExif.resolutionUnit,
                  )}
                </p>
              </div>
            )}
        </div>
      </div>

      {/* EXIF 信息 - 相机和拍摄参数 */}
      {photo.showExif && parsedExif && (
        <>
          {/* 相机信息 */}
          {(parsedExif.make || parsedExif.model || parsedExif.lensModel) && (
            <div className="border-t border-foreground/10 pt-4">
              <h3
                className={`mb-3 font-semibold text-foreground/80 ${
                  isMobile ? "text-base" : "text-sm"
                }`}
              >
                相机信息
              </h3>
              <div
                className={`grid grid-cols-1 ${
                  isMobile ? "gap-y-4 text-sm" : "gap-y-2 text-xs"
                }`}
              >
                {(parsedExif.make || parsedExif.model) && (
                  <div>
                    <span className="text-muted-foreground">相机</span>
                    <p className="text-foreground font-medium">
                      {[parsedExif.make, parsedExif.model]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  </div>
                )}
                {parsedExif.lensModel && (
                  <div>
                    <span className="text-muted-foreground">镜头</span>
                    <p className="text-foreground font-medium">
                      {parsedExif.lensModel}
                    </p>
                  </div>
                )}
                {parsedExif.lensSpecification && (
                  <div>
                    <span className="text-muted-foreground">镜头规格</span>
                    <p className="text-foreground font-medium">
                      {formatLensSpec(parsedExif.lensSpecification)}
                    </p>
                  </div>
                )}
                {parsedExif.software && (
                  <div>
                    <span className="text-muted-foreground">软件</span>
                    <p className="text-foreground font-medium">
                      {parsedExif.software}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 拍摄参数 */}
          {(parsedExif.exposureTime ||
            parsedExif.fNumber ||
            parsedExif.iso ||
            parsedExif.focalLength) && (
            <div className="border-t border-foreground/10 pt-4">
              <h3
                className={`mb-3 font-semibold text-foreground/80 ${
                  isMobile ? "text-base" : "text-sm"
                }`}
              >
                拍摄参数
              </h3>
              <div
                className={`grid ${
                  isMobile
                    ? "grid-cols-1 gap-y-4"
                    : "grid-cols-2 gap-x-4 gap-y-2"
                } ${isMobile ? "text-sm" : "text-xs"}`}
              >
                {parsedExif.exposureTime !== undefined && (
                  <div>
                    <span className="text-muted-foreground">快门</span>
                    <p className="text-foreground font-medium">
                      {formatExposureTime(parsedExif.exposureTime)}
                    </p>
                  </div>
                )}
                {parsedExif.fNumber !== undefined && (
                  <div>
                    <span className="text-muted-foreground">光圈</span>
                    <p className="text-foreground font-medium">
                      {formatAperture(parsedExif.fNumber)}
                    </p>
                  </div>
                )}
                {parsedExif.iso !== undefined && (
                  <div>
                    <span className="text-muted-foreground">ISO</span>
                    <p className="text-foreground font-medium">
                      {parsedExif.iso}
                    </p>
                  </div>
                )}
                {parsedExif.focalLength !== undefined && (
                  <div>
                    <span className="text-muted-foreground">焦距</span>
                    <p className="text-foreground font-medium">
                      {formatFocalLength(parsedExif.focalLength)}
                    </p>
                  </div>
                )}
                {parsedExif.focalLengthIn35mm !== undefined && (
                  <div>
                    <span className="text-muted-foreground">等效焦距</span>
                    <p className="text-foreground font-medium">
                      {parsedExif.focalLengthIn35mm}mm
                    </p>
                  </div>
                )}
                {parsedExif.exposureBiasValue !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光补偿</span>
                    <p className="text-foreground font-medium">
                      {formatExposureBias(parsedExif.exposureBiasValue)}
                    </p>
                  </div>
                )}
                {parsedExif.exposureProgram !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光程序</span>
                    <p className="text-foreground font-medium">
                      {formatExposureProgram(parsedExif.exposureProgram)}
                    </p>
                  </div>
                )}
                {parsedExif.exposureMode !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光模式</span>
                    <p className="text-foreground font-medium">
                      {formatExposureMode(parsedExif.exposureMode)}
                    </p>
                  </div>
                )}
                {parsedExif.meteringMode !== undefined && (
                  <div>
                    <span className="text-muted-foreground">测光模式</span>
                    <p className="text-foreground font-medium">
                      {formatMeteringMode(parsedExif.meteringMode)}
                    </p>
                  </div>
                )}
                {parsedExif.whiteBalance !== undefined && (
                  <div>
                    <span className="text-muted-foreground">白平衡</span>
                    <p className="text-foreground font-medium">
                      {formatWhiteBalance(parsedExif.whiteBalance)}
                    </p>
                  </div>
                )}
                {parsedExif.flash !== undefined && (
                  <div className={isMobile ? "" : "col-span-2"}>
                    <span className="text-muted-foreground">闪光灯</span>
                    <p className="text-foreground font-medium">
                      {formatFlash(parsedExif.flash)}
                    </p>
                  </div>
                )}
                {parsedExif.sceneCaptureType !== undefined && (
                  <div>
                    <span className="text-muted-foreground">场景类型</span>
                    <p className="text-foreground font-medium">
                      {formatSceneCaptureType(parsedExif.sceneCaptureType)}
                    </p>
                  </div>
                )}
                {parsedExif.colorSpace !== undefined && (
                  <div>
                    <span className="text-muted-foreground">色彩空间</span>
                    <p className="text-foreground font-medium">
                      {formatColorSpace(parsedExif.colorSpace)}
                    </p>
                  </div>
                )}
                {parsedExif.sensingMethod !== undefined && (
                  <div>
                    <span className="text-muted-foreground">传感器类型</span>
                    <p className="text-foreground font-medium">
                      {formatSensingMethod(parsedExif.sensingMethod)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GPS 信息 - 仅在 hideGPS 为 false 时显示 */}
          {!photo.hideGPS &&
            parsedExif.latitude !== undefined &&
            parsedExif.longitude !== undefined && (
              <div className="border-t border-foreground/10 pt-4">
                <h3
                  className={`mb-3 font-semibold text-foreground/80 ${
                    isMobile ? "text-base" : "text-sm"
                  }`}
                >
                  位置信息
                </h3>
                <div
                  className={`grid grid-cols-1 ${
                    isMobile ? "gap-y-4 text-sm" : "gap-y-2 text-xs"
                  }`}
                >
                  <div>
                    <span className="text-muted-foreground">坐标</span>
                    <p className="text-foreground font-medium">
                      {formatGPS(parsedExif.latitude, parsedExif.longitude)}
                    </p>
                  </div>
                  {parsedExif.altitude !== undefined && (
                    <div>
                      <span className="text-muted-foreground">海拔</span>
                      <p className="text-foreground font-medium">
                        {parsedExif.altitude.toFixed(1)}m
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsImgDirection !== undefined && (
                    <div>
                      <span className="text-muted-foreground">拍摄方向</span>
                      <p className="text-foreground font-medium">
                        {formatGpsDirection(parsedExif.gpsImgDirection)}
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsHPositioningError !== undefined && (
                    <div>
                      <span className="text-muted-foreground">定位精度</span>
                      <p className="text-foreground font-medium">
                        {formatGpsAccuracy(parsedExif.gpsHPositioningError)}
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsSpeed !== undefined && (
                    <div>
                      <span className="text-muted-foreground">移动速度</span>
                      <p className="text-foreground font-medium">
                        {formatGpsSpeed(
                          parsedExif.gpsSpeed,
                          parsedExif.gpsSpeedRef,
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
        </>
      )}

      {/* EXIF 加载中 */}
      {photo.showExif && exifLoading && (
        <div className="border-t border-foreground/10 pt-4">
          <div
            className={`flex items-center gap-2 text-muted-foreground ${
              isMobile ? "text-sm" : "text-xs"
            }`}
          >
            <RiLoader4Line size="1em" className="animate-spin" />
            <span>正在加载 EXIF 信息...</span>
          </div>
        </div>
      )}
    </div>
  );

  // 使用 createPortal 将模态框挂载到 body，避免受父级容器影响
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[59] overflow-hidden">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isClosing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={handleClose}
          />

          {/* 关闭按钮 */}
          {!isMobile && (
            <motion.button
              type="button"
              onClick={handleClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: isClosing ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="absolute right-4 top-4 z-[62] p-2 text-white/70 hover:text-white transition-colors hover:bg-white/10 rounded-full"
              aria-label="关闭"
            >
              <RiCloseLine size="2em" />
            </motion.button>
          )}

          {/* 图片容器 - 使用位置动画 */}
          <motion.div
            variants={{
              initial: {
                x: geometry.initialRect.left,
                y: geometry.initialRect.top,
                width: geometry.initialRect.width,
                height: geometry.initialRect.height,
                borderRadius: 4,
              },
              open: {
                x: geometry.targetRect.x,
                y: geometry.targetRect.y,
                width: geometry.targetRect.width,
                height: geometry.targetRect.height,
                borderRadius:
                  geometry.infoPosition === "right"
                    ? "8px 0 0 8px"
                    : "8px 8px 8px 8px", // Drawer 模式下图片圆角统一
                transition: {
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                },
              },
              closed: {
                x: geometry.initialRect.left,
                y: geometry.initialRect.top,
                width: geometry.initialRect.width,
                height: geometry.initialRect.height,
                borderRadius: 4,
                transition: {
                  duration: 0.25,
                  ease: "easeInOut",
                  delay: 0.1, // 等待信息区域先收起
                },
              },
            }}
            initial="initial"
            animate={isClosing ? "closed" : "open"}
            onAnimationComplete={handleAnimationComplete}
            className="fixed left-0 top-0 z-[60] overflow-hidden bg-background"
            style={{
              maxWidth: "none",
              maxHeight: "none",
              willChange: "transform, width, height",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 缩略图层 - 动画完成且高清图加载后通过 AnimatePresence 平滑淡出并移除 */}
            <AnimatePresence>
              {thumbnailUrl && !(hdImageLoaded && openAnimationComplete) && (
                <motion.img
                  key="modal-thumbnail"
                  src={thumbnailUrl}
                  alt={photo.media.altText || photo.name}
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 w-full h-full object-cover z-[1]"
                  draggable={false}
                  onLoad={handleThumbnailLoad}
                />
              )}
            </AnimatePresence>
            {/* 高清图层 */}
            <CMSImage
              src={imageUrl}
              alt={photo.media.altText || photo.name}
              fill
              sizes="(max-width: 768px) 100vw, 80vw"
              priority
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 z-[2] ${
                hdImageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setHdImageLoaded(true)}
              data-lightbox
            />
          </motion.div>

          <ImageLightbox skipFooterClose hideImageList />

          {/* 信息区域 - 桌面端从图片侧边/底部滑出 */}
          {!isMobile && (
            <motion.div
              variants={{
                // 初始状态：隐藏在图片后面（通过偏移位置）
                initial:
                  geometry.infoPosition === "right"
                    ? {
                        // 右侧布局：初始位置在图片下面，向左偏移隐藏
                        x:
                          geometry.targetRect.x +
                          geometry.targetRect.width -
                          geometry.infoWidth,
                        y: geometry.targetRect.y,
                        opacity: 0,
                      }
                    : {
                        // 底部布局（旧逻辑，现在 Mobile 用 Drawer）：初始位置在图片下面，向上偏移隐藏
                        x: geometry.targetRect.x,
                        y:
                          geometry.targetRect.y +
                          geometry.targetRect.height -
                          geometry.infoHeight,
                        opacity: 0,
                      },
                // 打开状态：滑出到最终位置
                open:
                  geometry.infoPosition === "right"
                    ? {
                        x: geometry.targetRect.x + geometry.targetRect.width,
                        y: geometry.targetRect.y,
                        opacity: 1,
                        transition: {
                          duration: 0.3,
                          ease: [0.32, 0.72, 0, 1],
                          delay: 0.25, // 等图片动画快完成时再显示
                        },
                      }
                    : {
                        x: geometry.targetRect.x,
                        y: geometry.targetRect.y + geometry.targetRect.height,
                        opacity: 1,
                        transition: {
                          duration: 0.3,
                          ease: [0.32, 0.72, 0, 1],
                          delay: 0.25,
                        },
                      },
                // 关闭状态：滑回图片后面
                closed:
                  geometry.infoPosition === "right"
                    ? {
                        x:
                          geometry.targetRect.x +
                          geometry.targetRect.width -
                          geometry.infoWidth,
                        y: geometry.targetRect.y,
                        opacity: 0,
                        transition: {
                          duration: 0.3,
                          ease: [0.32, 0.72, 0, 1],
                        },
                      }
                    : {
                        x: geometry.targetRect.x,
                        y:
                          geometry.targetRect.y +
                          geometry.targetRect.height -
                          geometry.infoHeight,
                        opacity: 0,
                        transition: {
                          duration: 0.3,
                          ease: [0.32, 0.72, 0, 1],
                        },
                      },
              }}
              initial="initial"
              animate={isClosing ? "closed" : "open"}
              onClick={(e) => e.stopPropagation()}
              className="fixed left-0 top-0 z-[59] bg-background overflow-y-auto"
              style={{
                width:
                  geometry.infoPosition === "right"
                    ? geometry.infoWidth
                    : geometry.targetRect.width,
                height:
                  geometry.infoPosition === "right"
                    ? geometry.targetRect.height
                    : geometry.infoHeight,
                borderRadius:
                  geometry.infoPosition === "right"
                    ? "0 8px 8px 0"
                    : "0 0 8px 8px",
                // 左侧或上侧添加阴影遮盖缝隙
                boxShadow:
                  geometry.infoPosition === "right"
                    ? "-16px 0 0 0 var(--color-background)"
                    : "0 -16px 0 0 var(--color-background)",
              }}
            >
              <div className="p-4">{InfoContent}</div>
            </motion.div>
          )}

          {/* 移动端 Drawer */}
          {isMobile && (
            <Drawer
              open={!isClosing}
              onClose={handleClose}
              initialSize={0.35} // 初始高度 35%
              showBackdrop={false} // 背景已经在 Modal 中有了
            >
              {InfoContent}
            </Drawer>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
