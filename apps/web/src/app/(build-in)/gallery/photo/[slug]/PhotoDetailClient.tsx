"use client";

import { useEffect, useState } from "react";
import { RiLoader4Line } from "@remixicon/react";

import RowGrid, { GridItem } from "@/components/client/layout/RowGrid";
import CMSImage from "@/components/ui/CMSImage";
import ImageLightbox from "@/components/ui/ImageLightbox";
import UserAvatar from "@/components/ui/UserAvatar";
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

interface PhotoDetailClientProps {
  photo: PhotoWithMedia;
  imageUrl: string;
}

export default function PhotoDetailClient({
  photo,
  imageUrl,
}: PhotoDetailClientProps) {
  // EXIF 解析状态
  const [parsedExif, setParsedExif] = useState<ParsedExifData | null>(null);
  const [exifLoading, setExifLoading] = useState(false);

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

  // 上传者信息
  const uploader = photo.media.user;

  // 信息区域内容
  const InfoContent = (
    <div className="space-y-4">
      {/* 标题和描述 */}
      <div>
        <h1 className="mb-2 text-xl font-bold text-foreground">{photo.name}</h1>
        {photo.description && (
          <p className="text-sm text-muted-foreground">{photo.description}</p>
        )}
      </div>

      {/* 上传者信息 */}
      <div className="border-t border-foreground/10 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground/80">
          上传者
        </h3>
        <div className="flex items-center gap-3">
          <UserAvatar
            username={uploader.nickname || uploader.username}
            avatarUrl={uploader.avatar}
            emailMd5={uploader.emailMd5}
            size={36}
            shape="circle"
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-foreground truncate">
              {uploader.nickname || uploader.username}
            </div>
            {uploader.nickname && (
              <div className="text-xs text-muted-foreground truncate">
                @{uploader.username}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <div className="border-t border-foreground/10 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground/80">
          图片信息
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          {photo.media.width && photo.media.height && (
            <div>
              <span className="text-muted-foreground">尺寸</span>
              <p className="text-foreground">
                {photo.media.width} × {photo.media.height}
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">文件大小</span>
            <p className="text-foreground">
              {formatFileSize(photo.media.size)}
            </p>
          </div>

          {/* 分辨率（DPI） */}
          {photo.showExif &&
            parsedExif &&
            (parsedExif.xResolution || parsedExif.yResolution) && (
              <div className="col-span-2">
                <span className="text-muted-foreground">分辨率</span>
                <p className="text-foreground">
                  {formatResolution(
                    parsedExif.xResolution,
                    parsedExif.yResolution,
                    parsedExif.resolutionUnit,
                  )}
                </p>
              </div>
            )}
          {/* 优先显示 EXIF 中的拍摄时间 */}
          {photo.showExif && parsedExif?.dateTimeOriginal ? (
            <div>
              <span className="text-muted-foreground">拍摄时间</span>
              <p className="text-foreground">
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
                        <span className="text-muted-foreground">
                          {" "}
                          ({parts.offsetTime})
                        </span>
                      )}
                      {parts.subSecTime && (
                        <span className="text-muted-foreground">
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
              <p className="text-foreground">{formatDateTime(photo.shotAt)}</p>
            </div>
          ) : null}
          <div>
            <span className="text-muted-foreground">上传时间</span>
            <p className="text-foreground">
              {formatDateTime(photo.media.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* EXIF 信息 - 相机和拍摄参数 */}
      {photo.showExif && parsedExif && (
        <>
          {/* 相机信息 */}
          {(parsedExif.make || parsedExif.model || parsedExif.lensModel) && (
            <div className="border-t border-foreground/10 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">
                相机信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-y-2 gap-x-4 text-xs">
                {(parsedExif.make || parsedExif.model) && (
                  <div>
                    <span className="text-muted-foreground">相机</span>
                    <p className="text-foreground">
                      {[parsedExif.make, parsedExif.model]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  </div>
                )}
                {parsedExif.lensModel && (
                  <div>
                    <span className="text-muted-foreground">镜头</span>
                    <p className="text-foreground">{parsedExif.lensModel}</p>
                  </div>
                )}
                {parsedExif.lensSpecification && (
                  <div>
                    <span className="text-muted-foreground">镜头规格</span>
                    <p className="text-foreground">
                      {formatLensSpec(parsedExif.lensSpecification)}
                    </p>
                  </div>
                )}
                {parsedExif.software && (
                  <div>
                    <span className="text-muted-foreground">软件</span>
                    <p className="text-foreground">{parsedExif.software}</p>
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
              <h3 className="mb-3 text-sm font-semibold text-foreground/80">
                拍摄参数
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                {parsedExif.exposureTime !== undefined && (
                  <div>
                    <span className="text-muted-foreground">快门</span>
                    <p className="text-foreground">
                      {formatExposureTime(parsedExif.exposureTime)}
                    </p>
                  </div>
                )}
                {parsedExif.fNumber !== undefined && (
                  <div>
                    <span className="text-muted-foreground">光圈</span>
                    <p className="text-foreground">
                      {formatAperture(parsedExif.fNumber)}
                    </p>
                  </div>
                )}
                {parsedExif.iso !== undefined && (
                  <div>
                    <span className="text-muted-foreground">ISO</span>
                    <p className="text-foreground">{parsedExif.iso}</p>
                  </div>
                )}
                {parsedExif.focalLength !== undefined && (
                  <div>
                    <span className="text-muted-foreground">焦距</span>
                    <p className="text-foreground">
                      {formatFocalLength(parsedExif.focalLength)}
                    </p>
                  </div>
                )}
                {parsedExif.focalLengthIn35mm !== undefined && (
                  <div>
                    <span className="text-muted-foreground">等效焦距</span>
                    <p className="text-foreground">
                      {parsedExif.focalLengthIn35mm}mm
                    </p>
                  </div>
                )}
                {parsedExif.exposureBiasValue !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光补偿</span>
                    <p className="text-foreground">
                      {formatExposureBias(parsedExif.exposureBiasValue)}
                    </p>
                  </div>
                )}
                {parsedExif.exposureProgram !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光程序</span>
                    <p className="text-foreground">
                      {formatExposureProgram(parsedExif.exposureProgram)}
                    </p>
                  </div>
                )}
                {parsedExif.exposureMode !== undefined && (
                  <div>
                    <span className="text-muted-foreground">曝光模式</span>
                    <p className="text-foreground">
                      {formatExposureMode(parsedExif.exposureMode)}
                    </p>
                  </div>
                )}
                {parsedExif.meteringMode !== undefined && (
                  <div>
                    <span className="text-muted-foreground">测光模式</span>
                    <p className="text-foreground">
                      {formatMeteringMode(parsedExif.meteringMode)}
                    </p>
                  </div>
                )}
                {parsedExif.whiteBalance !== undefined && (
                  <div>
                    <span className="text-muted-foreground">白平衡</span>
                    <p className="text-foreground">
                      {formatWhiteBalance(parsedExif.whiteBalance)}
                    </p>
                  </div>
                )}
                {parsedExif.flash !== undefined && (
                  <div>
                    <span className="text-muted-foreground">闪光灯</span>
                    <p className="text-foreground">
                      {formatFlash(parsedExif.flash)}
                    </p>
                  </div>
                )}
                {parsedExif.sceneCaptureType !== undefined && (
                  <div>
                    <span className="text-muted-foreground">场景类型</span>
                    <p className="text-foreground">
                      {formatSceneCaptureType(parsedExif.sceneCaptureType)}
                    </p>
                  </div>
                )}
                {parsedExif.colorSpace !== undefined && (
                  <div>
                    <span className="text-muted-foreground">色彩空间</span>
                    <p className="text-foreground">
                      {formatColorSpace(parsedExif.colorSpace)}
                    </p>
                  </div>
                )}
                {parsedExif.sensingMethod !== undefined && (
                  <div>
                    <span className="text-muted-foreground">传感器类型</span>
                    <p className="text-foreground">
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
                <h3 className="mb-3 text-sm font-semibold text-foreground/80">
                  位置信息
                </h3>
                <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">坐标</span>
                    <p className="text-foreground">
                      {formatGPS(parsedExif.latitude, parsedExif.longitude)}
                    </p>
                  </div>
                  {parsedExif.altitude !== undefined && (
                    <div>
                      <span className="text-muted-foreground">海拔</span>
                      <p className="text-foreground">
                        {parsedExif.altitude.toFixed(1)}m
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsImgDirection !== undefined && (
                    <div>
                      <span className="text-muted-foreground">拍摄方向</span>
                      <p className="text-foreground">
                        {formatGpsDirection(parsedExif.gpsImgDirection)}
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsHPositioningError !== undefined && (
                    <div>
                      <span className="text-muted-foreground">定位精度</span>
                      <p className="text-foreground">
                        {formatGpsAccuracy(parsedExif.gpsHPositioningError)}
                      </p>
                    </div>
                  )}
                  {parsedExif.gpsSpeed !== undefined && (
                    <div>
                      <span className="text-muted-foreground">移动速度</span>
                      <p className="text-foreground">
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
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <RiLoader4Line size="1em" className="animate-spin" />
            <span>正在加载 EXIF 信息...</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <RowGrid>
      <GridItem
        areas={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
        width={photo.media.width! / photo.media.height!}
      >
        <CMSImage
          src={imageUrl}
          blur={photo.media.blur}
          sizes="(max-width: 768px) 100vw, 60vw"
          alt={photo.media.altText || photo.name}
          width={photo.media.width || 800}
          height={photo.media.height || 800}
          className="h-full object-contain"
          data-lightbox
          priority
        />
      </GridItem>
      <GridItem
        areas={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
        className="px-10 py-5"
        width={2}
      >
        {InfoContent}
      </GridItem>
      <ImageLightbox skipFooterClose />
    </RowGrid>
  );
}
