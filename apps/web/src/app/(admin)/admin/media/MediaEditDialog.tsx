"use client";

import { useEffect, useState } from "react";
import type { GallerySize, MediaListItem } from "@repo/shared-types/api/media";

import { updateMedia } from "@/actions/media";
import { getMediaDetail } from "@/lib/client/api/media-read";
import {
  formatAperture,
  formatExposureBias,
  formatExposureTime,
  formatFlash,
  formatFocalLength,
  formatLensSpec,
  type ParsedExifData,
  parseExifBuffer,
} from "@/lib/client/media-exif";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { useToast } from "@/ui/Toast";

// Group definitions matching MediaPreviewDialog
const EXIF_GROUPS = {
  basic: {
    label: "基本信息",
    keys: [
      "make",
      "model",
      "software",
      "hostComputer",
      "dateTimeOriginal",
      "offsetTime",
      "subSecTime",
    ],
  },
  shooting: {
    label: "拍摄参数",
    keys: [
      "exposureTime",
      "fNumber",
      "iso",
      "exposureBiasValue",
      "focalLength",
      "focalLengthIn35mm",
      "meteringMode",
      "exposureProgram",
      "exposureMode",
      "whiteBalance",
      "sceneCaptureType",
      "flash",
    ],
  },
  lens: {
    label: "镜头信息",
    keys: ["lensModel", "lensMake", "lensSpecification"],
  },
  gps: {
    label: "GPS 信息",
    keys: [
      "latitude",
      "longitude",
      "altitude",
      "gpsImgDirection",
      "gpsHPositioningError",
      "gpsSpeed",
    ],
  },
  technical: {
    label: "技术信息",
    keys: [
      "colorSpace",
      "sensingMethod",
      "pixelXDimension",
      "pixelYDimension",
      "xResolution",
      "yResolution",
      "resolutionUnit",
    ],
  },
};

const EXIF_LABELS: Record<string, string> = {
  make: "相机品牌",
  model: "相机型号",
  software: "系统版本",
  hostComputer: "设备型号",
  dateTimeOriginal: "拍摄时间",
  offsetTime: "时区偏移",
  subSecTime: "亚秒时间",
  exposureTime: "快门速度",
  fNumber: "光圈",
  iso: "ISO 感光度",
  exposureBiasValue: "曝光补偿",
  focalLength: "焦距",
  focalLengthIn35mm: "等效焦距 (35mm)",
  meteringMode: "测光模式",
  exposureProgram: "曝光程序",
  exposureMode: "曝光模式",
  whiteBalance: "白平衡",
  sceneCaptureType: "场景类型",
  flash: "闪光灯",
  lensModel: "镜头型号",
  lensMake: "镜头制造商",
  lensSpecification: "镜头规格",
  latitude: "GPS 纬度",
  longitude: "GPS 经度",
  altitude: "GPS 海拔",
  gpsImgDirection: "拍摄方向",
  gpsHPositioningError: "定位精度",
  gpsSpeed: "移动速度",
  gpsSpeedRef: "速度单位",
  colorSpace: "色彩空间",
  sensingMethod: "传感器类型",
  pixelXDimension: "原始像素宽度",
  pixelYDimension: "原始像素高度",
  xResolution: "水平分辨率",
  yResolution: "垂直分辨率",
  resolutionUnit: "分辨率单位",
};

// Formatters for specific keys
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KEY_FORMATTERS: Partial<Record<string, (val: any) => string>> = {
  exposureTime: formatExposureTime,
  fNumber: formatAperture,
  focalLength: formatFocalLength,
  focalLengthIn35mm: (val) => `${val}mm`,
  exposureBiasValue: formatExposureBias,
  lensSpecification: formatLensSpec,
  flash: formatFlash,
};

// Options for Select components
const EXIF_OPTIONS: Record<string, { value: number; label: string }[]> = {
  meteringMode: [
    { value: 0, label: "未知" },
    { value: 1, label: "平均测光" },
    { value: 2, label: "中央重点平均测光" },
    { value: 3, label: "点测光" },
    { value: 4, label: "多点测光" },
    { value: 5, label: "评价测光" },
    { value: 6, label: "局部测光" },
    { value: 255, label: "其他" },
  ],
  exposureProgram: [
    { value: 0, label: "未定义" },
    { value: 1, label: "手动" },
    { value: 2, label: "程序自动" },
    { value: 3, label: "光圈优先" },
    { value: 4, label: "快门优先" },
    { value: 5, label: "创意程序" },
    { value: 6, label: "动作程序" },
    { value: 7, label: "人像模式" },
    { value: 8, label: "风景模式" },
  ],
  exposureMode: [
    { value: 0, label: "自动曝光" },
    { value: 1, label: "手动曝光" },
    { value: 2, label: "自动包围曝光" },
  ],
  whiteBalance: [
    { value: 0, label: "自动白平衡" },
    { value: 1, label: "手动白平衡" },
  ],
  sceneCaptureType: [
    { value: 0, label: "标准" },
    { value: 1, label: "风景" },
    { value: 2, label: "人像" },
    { value: 3, label: "夜景" },
  ],
  colorSpace: [
    { value: 1, label: "sRGB" },
    { value: 2, label: "Adobe RGB" },
    { value: 65535, label: "未校准" },
  ],
  sensingMethod: [
    { value: 1, label: "未定义" },
    { value: 2, label: "单芯片彩色区域传感器" },
    { value: 3, label: "双芯片彩色区域传感器" },
    { value: 4, label: "三芯片彩色区域传感器" },
    { value: 5, label: "彩色顺序区域传感器" },
    { value: 7, label: "三线性传感器" },
    { value: 8, label: "彩色顺序线性传感器" },
  ],
  resolutionUnit: [
    { value: 2, label: "英寸 (dpi)" },
    { value: 3, label: "厘米 (dpcm)" },
  ],
};

// Helper function for date formatting (YYYY-MM-DDTHH:mm:ss)
const formatDateForInput = (dateValue: string) => {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

interface MediaEditDialogProps {
  open: boolean;
  onClose: () => void;
  media: MediaListItem | null;
  onUpdate: () => void;
}

// Helper to strip file extension
function stripExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1) return filename;
  return filename.substring(0, lastDotIndex);
}

export default function MediaEditDialog({
  open,
  onClose,
  media,
  onUpdate,
}: MediaEditDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);

  // Basic Fields
  const [originalName, setOriginalName] = useState("");
  const [altText, setAltText] = useState("");
  const [persistentPath, setPersistentPath] = useState("");
  const [inGallery, setInGallery] = useState(false);

  // Gallery Fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [gallerySize, setGallerySize] = useState<GallerySize>("AUTO");
  const [showExif, setShowExif] = useState(true);
  const [hideGPS, setHideGPS] = useState(true);
  const [overrideExif, setOverrideExif] = useState<Partial<ParsedExifData>>({});

  // Parsed Exif Data for Reference
  const [parsedExif, setParsedExif] = useState<Partial<ParsedExifData>>({});
  const [activeExifKeys, setActiveExifKeys] = useState<Set<string>>(new Set());

  // Fetch detail when dialog opens
  useEffect(() => {
    if (open && media) {
      setLoading(true);
      getMediaDetail({ id: media.id })
        .then((res) => {
          if (res.success && res.data) {
            const d = res.data;
            setOriginalName(d.originalName);
            setAltText(d.altText || "");
            setPersistentPath(d.persistentPath || "");
            setInGallery(d.inGallery);

            if (d.galleryPhoto) {
              setName(d.galleryPhoto.name);
              setSlug(d.galleryPhoto.slug);
              setDescription(d.galleryPhoto.description || "");
              setGallerySize(d.galleryPhoto.size as GallerySize);
              setShowExif(d.galleryPhoto.showExif);
              setHideGPS(d.galleryPhoto.hideGPS);
              setOverrideExif(d.galleryPhoto.overrideExif || {});
            } else {
              // Defaults
              setName(stripExtension(d.originalName));
              setSlug(""); // Let backend generate or user input
              setDescription("");
              setGallerySize("AUTO");
              setShowExif(true);
              setHideGPS(true);
              setOverrideExif({});
            }

            // Parse Exif
            parseExif(d.exif);
          } else {
            toast.error("获取文件详情失败");
            onClose();
          }
        })
        .catch(() => {
          toast.error("获取文件详情失败");
          onClose();
        })
        .finally(() => setLoading(false));
    } else {
      // Reset loading state when closed so next open shows loading
      setLoading(true);
    }
  }, [open, media, toast, onClose]);

  const parseExif = (exifData: {
    raw?: { type?: string; data?: number[] } | string;
  }) => {
    if (!exifData || !exifData.raw) {
      setParsedExif({});
      setActiveExifKeys(new Set());
      return;
    }

    try {
      let buffer: Buffer;
      if (typeof exifData.raw === "string") {
        buffer = Buffer.from(exifData.raw, "base64");
      } else if (
        exifData.raw.type === "Buffer" &&
        Array.isArray(exifData.raw.data)
      ) {
        buffer = Buffer.from(exifData.raw.data);
      } else {
        return;
      }

      const parsed = parseExifBuffer(buffer);
      if (parsed) {
        setParsedExif(parsed);
        // Identify keys that have values
        const keys = new Set(
          Object.keys(parsed).filter(
            (k) => parsed[k as keyof ParsedExifData] !== undefined,
          ),
        );
        setActiveExifKeys(keys);
      }
    } catch (e) {
      console.error("Exif parse error", e);
    }
  };

  const handleExifChange = (
    key: keyof ParsedExifData,
    value: string | number,
    compareAgainst?: string,
  ) => {
    // Check if value equals original
    const originalValue = parsedExif[key];
    const originalStr = String(originalValue);
    const valueStr = String(value);

    // Use provided comparison string or default to raw original string
    const targetStr =
      compareAgainst !== undefined ? compareAgainst : originalStr;

    if (valueStr === targetStr) {
      const newOverride = { ...overrideExif };
      delete newOverride[key];
      setOverrideExif(newOverride);
    } else {
      let newValue: string | number = value;
      const originalType = typeof originalValue;

      if (originalType === "number" && typeof value === "string") {
        const num = Number(value);
        if (!isNaN(num)) newValue = num;
      }

      setOverrideExif((prev) => ({ ...prev, [key]: newValue }));
    }
  };

  const handleSubmit = async () => {
    if (!media) return;

    try {
      const result = await updateMedia({
        id: media.id,
        originalName,
        altText: altText || null,
        persistentPath: persistentPath.trim() ? persistentPath.trim() : null,
        inGallery,
        // Gallery fields
        ...(inGallery
          ? {
              name,
              slug: slug || undefined,
              description,
              gallerySize,
              showExif,
              hideGPS,
              overrideExif:
                Object.keys(overrideExif).length > 0 ? overrideExif : undefined,
            }
          : {}),
      });

      if (result.success) {
        toast.success("更新成功");
        onUpdate();
        onClose();
      } else {
        toast.error(result.message || "更新失败");
      }
    } catch (e) {
      console.error(e);
      toast.error("更新失败");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="编辑媒体文件" size="lg">
      <AutoResizer>
        <AutoTransition>
          {loading ? (
            <div className="p-10 flex justify-center h-[32em]" key="loading">
              <LoadingIndicator />
            </div>
          ) : (
            <div className="px-6 py-6 space-y-6 overflow-y-auto" key="content">
              {/* Basic Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                  基本信息
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="显示名称"
                    value={originalName}
                    size="sm"
                    onChange={(e) => setOriginalName(e.target.value)}
                    helperText="文件名"
                  />
                  <Input
                    label="替代文本"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    helperText="Alt Text"
                    size="sm"
                  />
                  <div className="md:col-span-2">
                    <Input
                      label="持久化路径"
                      value={persistentPath}
                      onChange={(e) => setPersistentPath(e.target.value)}
                      helperText="填写相对路径，例如 avatar.jpg 或 icons/icon.png"
                      size="sm"
                    />
                    <p className="text-sm text-muted-foreground mt-2">
                      填写后，下次构建部署时，文件将被保存到 public
                      目录下，可以以 /path/to/file.jpg 形式访问。
                    </p>
                  </div>
                </div>
              </div>

              {/* Gallery Settings */}
              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between border-b border-foreground/10 pb-2">
                  <h3 className="text-lg font-medium text-foreground">
                    图库设置
                  </h3>
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium">在图库中显示</label>
                    <Switch
                      checked={inGallery}
                      onCheckedChange={setInGallery}
                      size="md"
                    />
                  </div>
                </div>

                <div className="space-y-6 pt-2">
                  {/* Basic Gallery Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="照片标题"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="留空则使用显示名称"
                      size="sm"
                      disabled={!inGallery}
                    />
                    <Input
                      label="Slug"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="留空自动生成"
                      size="sm"
                      disabled={!inGallery}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="描述"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="照片描述..."
                        rows={3}
                        size="sm"
                        disabled={!inGallery}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        展示尺寸
                      </label>
                      <Select
                        value={gallerySize}
                        onChange={(v) => setGallerySize(v as GallerySize)}
                        options={[
                          { label: "自动 (Auto)", value: "AUTO" },
                          { label: "方形 (Square)", value: "SQUARE" },
                          { label: "高 (Tall)", value: "TALL" },
                          { label: "宽 (Wide)", value: "WIDE" },
                          { label: "大 (Large)", value: "LARGE" },
                        ]}
                        size="sm"
                        disabled={!inGallery}
                      />
                      <p className="text-muted-foreground text-sm pt-2">
                        控制图库中照片的显示尺寸。
                        <br />
                        在自动模式下，尺寸由照片的宽高比决定，
                        <br />
                        20% 的方形图片将自动放大以优化显示效果。
                      </p>
                    </div>
                    <div className="flex flex-col justify-end gap-3 pb-1">
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        展示设置
                      </label>
                      <div
                        className={`flex items-center justify-start gap-3 py-2`}
                      >
                        <Switch
                          checked={showExif}
                          onCheckedChange={setShowExif}
                          size="sm"
                          disabled={!inGallery}
                        />
                        <label className="text-sm">显示 Exif 信息</label>
                      </div>
                      <div
                        className={`flex items-center justify-start gap-3 py-2`}
                      >
                        <Switch
                          checked={hideGPS}
                          onCheckedChange={setHideGPS}
                          size="sm"
                          disabled={!inGallery}
                        />
                        <label className="text-sm">隐藏 GPS 坐标</label>
                      </div>
                    </div>
                  </div>

                  {/* Exif Overrides - Grouped */}
                  {activeExifKeys.size > 0 && (
                    <div className="space-y-6 mt-6 pt-4 border-t border-foreground/10">
                      <div className="flex items-center gap-2">
                        <h4
                          className={`text-base font-medium transition-colors ${!inGallery ? "text-muted-foreground" : "text-foreground"}`}
                        >
                          Exif 数据覆盖
                        </h4>
                      </div>

                      {Object.entries(EXIF_GROUPS).map(([groupId, group]) => {
                        // Check if any key in this group is active
                        const groupKeys = group.keys.filter((k) =>
                          activeExifKeys.has(k),
                        );
                        if (groupKeys.length === 0) return null;

                        return (
                          <div key={groupId} className="space-y-3">
                            <h5
                              className={`text-sm font-medium border-b border-border/50 pb-1 transition-colors ${!inGallery ? "text-muted-foreground/50" : "text-muted-foreground"}`}
                            >
                              {group.label}
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {groupKeys.map((key) => {
                                const originalVal =
                                  parsedExif[key as keyof ParsedExifData];
                                const overrideVal =
                                  overrideExif[key as keyof ParsedExifData];
                                const isOverridden = overrideVal !== undefined;
                                const options = EXIF_OPTIONS[key];

                                // Determine display value using formatter if available
                                const formatter = KEY_FORMATTERS[key];
                                const formattedOriginal = formatter
                                  ? formatter(originalVal)
                                  : String(originalVal);

                                const displayValue = isOverridden
                                  ? String(overrideVal)
                                  : formattedOriginal;

                                const isDateTime = key === "dateTimeOriginal";

                                return (
                                  <div key={key}>
                                    {options ? (
                                      <div className="space-y-1">
                                        <label
                                          className={`text-sm flex justify-between transition-colors ${!inGallery ? "text-muted-foreground/50" : "text-foreground"}`}
                                        >
                                          {EXIF_LABELS[key] || key}
                                          {isOverridden && (
                                            <span className="text-primary text-xs ml-2">
                                              (已覆盖)
                                            </span>
                                          )}
                                        </label>
                                        <Select
                                          value={String(
                                            isOverridden
                                              ? overrideVal
                                              : originalVal,
                                          )}
                                          onChange={(v) =>
                                            handleExifChange(
                                              key as keyof ParsedExifData,
                                              v,
                                            )
                                          }
                                          options={options.map((opt) => ({
                                            value: String(opt.value),
                                            label: opt.label,
                                          }))}
                                          size="sm"
                                          disabled={!inGallery}
                                        />
                                      </div>
                                    ) : (
                                      <Input
                                        type={
                                          isDateTime ? "datetime-local" : "text"
                                        }
                                        step={isDateTime ? "1" : undefined}
                                        label={EXIF_LABELS[key] || key}
                                        value={
                                          isDateTime
                                            ? formatDateForInput(displayValue)
                                            : displayValue
                                        }
                                        onChange={(e) => {
                                          const val = isDateTime
                                            ? new Date(
                                                e.target.value,
                                              ).toString()
                                            : e.target.value;
                                          handleExifChange(
                                            key as keyof ParsedExifData,
                                            val,
                                            formattedOriginal,
                                          );
                                        }}
                                        size="sm"
                                        className={
                                          isOverridden ? "border-primary" : ""
                                        }
                                        tips={
                                          isOverridden ? "(已覆盖)" : undefined
                                        }
                                        disabled={!inGallery}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-foreground/10">
                <Button
                  label="取消"
                  variant="ghost"
                  onClick={onClose}
                  size="sm"
                />
                <Button
                  label="保存"
                  variant="primary"
                  onClick={handleSubmit}
                  size="sm"
                />
              </div>
            </div>
          )}
        </AutoTransition>
      </AutoResizer>
    </Dialog>
  );
}
