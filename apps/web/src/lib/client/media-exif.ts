import exifReader from "exif-reader";

export interface ParsedExifData {
  // 相机信息
  make?: string; // 制造商
  model?: string; // 型号
  software?: string; // 软件
  hostComputer?: string; // 设备型号
  // 拍摄参数
  exposureTime?: number; // 曝光时间
  fNumber?: number; // 光圈
  iso?: number; // ISO
  focalLength?: number; // 焦距
  focalLengthIn35mm?: number; // 等效35mm焦距
  exposureBiasValue?: number; // 曝光补偿
  brightnessValue?: number; // 亮度值
  lensModel?: string; // 镜头型号
  lensMake?: string; // 镜头制造商
  lensSpecification?: number[]; // 镜头规格
  // 拍摄模式
  exposureProgram?: number; // 曝光程序
  exposureMode?: number; // 曝光模式
  meteringMode?: number; // 测光模式
  sceneCaptureType?: number; // 场景类型
  whiteBalance?: number; // 白平衡
  flash?: number; // 闪光灯
  // 图片信息
  colorSpace?: number; // 色彩空间
  sensingMethod?: number; // 传感器类型
  pixelXDimension?: number; // 原始宽度
  pixelYDimension?: number; // 原始高度
  xResolution?: number; // X分辨率
  yResolution?: number; // Y分辨率
  resolutionUnit?: number; // 分辨率单位
  // 日期时间
  dateTime?: Date; // 拍摄时间
  dateTimeOriginal?: Date; // 原始拍摄时间
  offsetTime?: string; // 时区
  subSecTime?: string; // 毫秒
  // GPS 信息
  latitude?: number; // 纬度
  longitude?: number; // 经度
  altitude?: number; // 海拔
  gpsImgDirection?: number; // 拍摄方向
  gpsSpeed?: number; // 移动速度
  gpsSpeedRef?: string; // 速度单位
  gpsHPositioningError?: number; // 定位精度
  gpsDateTime?: string; // GPS时间
  // 其他
  orientation?: number; // 方向
  subjectArea?: number[]; // 对焦区域
}

// GPS 坐标转换（从 [度, 分, 秒] 转为十进制）
const convertGPSCoordinate = (coords: number[]): number | undefined => {
  if (!coords || coords.length !== 3) return undefined;
  const [degrees = 0, minutes = 0, seconds = 0] = coords;
  return degrees + minutes / 60 + seconds / 3600;
};

export function parseExifBuffer(buffer: Buffer): ParsedExifData | null {
  try {
    const parsed = exifReader(buffer);
    if (!parsed) return null;

    // exif-reader 返回的数据结构
    const photo = parsed.Photo || {}; // 拍摄参数
    const image = parsed.Image || {}; // 图片信息
    const gpsInfo = parsed.GPSInfo || {}; // GPS 信息

    let latitude: number | undefined;
    let longitude: number | undefined;

    if (gpsInfo.GPSLatitude && gpsInfo.GPSLongitude) {
      latitude = convertGPSCoordinate(gpsInfo.GPSLatitude);
      longitude = convertGPSCoordinate(gpsInfo.GPSLongitude);

      // 处理南纬和西经
      if (gpsInfo.GPSLatitudeRef === "S" && latitude) {
        latitude = -latitude;
      }
      if (gpsInfo.GPSLongitudeRef === "W" && longitude) {
        longitude = -longitude;
      }
    }

    return {
      // 从 Image 获取相机信息
      make: image.Make,
      model: image.Model,
      software: image.Software,
      hostComputer: image.HostComputer,
      // 从 Photo 获取拍摄参数
      exposureTime: photo.ExposureTime,
      fNumber: photo.FNumber,
      iso: photo.ISOSpeedRatings,
      focalLength: photo.FocalLength,
      focalLengthIn35mm: photo.FocalLengthIn35mmFilm,
      exposureBiasValue: photo.ExposureBiasValue,
      brightnessValue: photo.BrightnessValue,
      lensModel: photo.LensModel,
      lensMake: photo.LensMake,
      lensSpecification: photo.LensSpecification,
      // 拍摄模式
      exposureProgram: photo.ExposureProgram,
      exposureMode: photo.ExposureMode,
      meteringMode: photo.MeteringMode,
      sceneCaptureType: photo.SceneCaptureType,
      whiteBalance: photo.WhiteBalance,
      flash: photo.Flash,
      // 图片信息
      colorSpace: photo.ColorSpace,
      sensingMethod: photo.SensingMethod,
      pixelXDimension: photo.PixelXDimension,
      pixelYDimension: photo.PixelYDimension,
      xResolution: image.XResolution,
      yResolution: image.YResolution,
      resolutionUnit: image.ResolutionUnit,
      // 日期时间
      dateTime: image.DateTime,
      dateTimeOriginal: photo.DateTimeOriginal,
      offsetTime: photo.OffsetTime,
      subSecTime: photo.SubSecTimeOriginal,
      // GPS 信息
      latitude,
      longitude,
      altitude: gpsInfo.GPSAltitude,
      gpsImgDirection: gpsInfo.GPSImgDirection,
      gpsSpeed: gpsInfo.GPSSpeed,
      gpsSpeedRef: gpsInfo.GPSSpeedRef,
      gpsHPositioningError: gpsInfo.GPSHPositioningError,
      gpsDateTime: gpsInfo.GPSDateStamp
        ? `${gpsInfo.GPSDateStamp} ${gpsInfo.GPSTimeStamp?.join(":")}`
        : undefined,
      // 其他
      orientation: image.Orientation,
      subjectArea: photo.SubjectArea,
    };
  } catch (error) {
    console.error("EXIF parsing error:", error);
    return null;
  }
}

// ============================================================================
// Formatters
// ============================================================================

export const formatDateTime = (dateString: string | Date) => {
  if (!dateString) return "";
  const date =
    typeof dateString === "string" ? new Date(dateString) : dateString;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const formatExposureTime = (time: number) => {
  if (time >= 1) {
    return `${time}s`;
  }
  const denominator = Math.round(1 / time);
  return `1/${denominator}s`;
};

export const formatAperture = (fNumber: number) => {
  return `f/${fNumber.toFixed(1)}`;
};

export const formatFocalLength = (length: number) => {
  return `${length}mm`;
};

export const formatGPS = (lat: number, lon: number) => {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}°${latDir}, ${Math.abs(lon).toFixed(6)}°${lonDir}`;
};

export const formatMeteringMode = (mode: number) => {
  const modes: Record<number, string> = {
    0: "未知",
    1: "平均测光",
    2: "中央重点平均测光",
    3: "点测光",
    4: "多点测光",
    5: "评价测光",
    6: "局部测光",
    255: "其他",
  };
  return modes[mode] || `未知 (${mode})`;
};

export const formatExposureProgram = (program: number) => {
  const programs: Record<number, string> = {
    0: "未定义",
    1: "手动",
    2: "程序自动",
    3: "光圈优先",
    4: "快门优先",
    5: "创意程序",
    6: "动作程序",
    7: "人像模式",
    8: "风景模式",
  };
  return programs[program] || `未知 (${program})`;
};

export const formatExposureMode = (mode: number) => {
  const modes: Record<number, string> = {
    0: "自动曝光",
    1: "手动曝光",
    2: "自动包围曝光",
  };
  return modes[mode] || `未知 (${mode})`;
};

export const formatWhiteBalance = (wb: number) => {
  const modes: Record<number, string> = {
    0: "自动白平衡",
    1: "手动白平衡",
  };
  return modes[wb] || `未知 (${wb})`;
};

export const formatSceneCaptureType = (type: number) => {
  const types: Record<number, string> = {
    0: "标准",
    1: "风景",
    2: "人像",
    3: "夜景",
  };
  return types[type] || `未知 (${type})`;
};

export const formatFlash = (flash: number) => {
  const parts: string[] = [];

  // 位 0: 闪光灯是否闪光
  if (flash & 0x01) {
    parts.push("已闪光");
  } else {
    parts.push("未闪光");
  }

  // 位 1-2: 闪光灯返回
  const returnBits = (flash >> 1) & 0x03;
  if (returnBits === 2) parts.push("检测到返回光");
  if (returnBits === 3) parts.push("未检测到返回光");

  // 位 3-4: 闪光灯模式
  const modeBits = (flash >> 3) & 0x03;
  if (modeBits === 1) parts.push("强制闪光");
  if (modeBits === 2) parts.push("强制关闭");
  if (modeBits === 3) parts.push("自动模式");

  // 位 6: 红眼消除
  if (flash & 0x40) parts.push("红眼消除");

  return parts.join(", ");
};

export const formatColorSpace = (space: number) => {
  const spaces: Record<number, string> = {
    1: "sRGB",
    2: "Adobe RGB",
    65535: "未校准",
  };
  return spaces[space] || `未知 (${space})`;
};

export const formatSensingMethod = (method: number) => {
  const methods: Record<number, string> = {
    1: "未定义",
    2: "单芯片彩色区域传感器",
    3: "双芯片彩色区域传感器",
    4: "三芯片彩色区域传感器",
    5: "彩色顺序区域传感器",
    7: "三线性传感器",
    8: "彩色顺序线性传感器",
  };
  return methods[method] || `未知 (${method})`;
};

export const formatExposureBias = (bias: number) => {
  const sign = bias >= 0 ? "+" : "";
  return `${sign}${bias.toFixed(1)} EV`;
};

export const formatLensSpec = (spec: number[]) => {
  if (!spec || spec.length < 4) return "";
  const [minFocal = 0, maxFocal = 0, minAperture = 0, maxAperture = 0] = spec;
  if (minFocal === maxFocal) {
    return `${minFocal.toFixed(1)}mm f/${minAperture.toFixed(1)}`;
  }
  return `${minFocal.toFixed(1)}-${maxFocal.toFixed(1)}mm f/${minAperture.toFixed(1)}-${maxAperture.toFixed(1)}`;
};

// ============================================================================
// 拍摄时间格式化
// ============================================================================

export interface ShotDateTimeParts {
  dateStr: string;
  offsetTime?: string;
  subSecTime?: string;
}

/**
 * 格式化拍摄时间，返回分离的部分以便分别设置样式
 */
export function formatShotDateTime(
  dateTime: Date | undefined,
  offsetTime: string | undefined,
  subSecTime: string | undefined,
): ShotDateTimeParts | null {
  if (!dateTime) return null;
  const date = new Date(dateTime);
  const dateStr = date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return {
    dateStr,
    offsetTime: offsetTime || undefined,
    subSecTime: subSecTime || undefined,
  };
}
