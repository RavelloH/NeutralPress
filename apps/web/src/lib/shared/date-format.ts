/**
 * 共享日期格式化工具函数（统一使用 zh-CN 区域设置）
 */

type DateInput = Date | string | null | undefined;

/**
 * 格式化为仅日期字符串，如 "2024/11/25"
 * @param date 输入日期
 * @param fallback 日期为空时的回退字符串，默认 "-"
 */
export function formatDate(date: DateInput, fallback = "-"): string {
  if (!date) return fallback;
  try {
    return new Date(date).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return fallback;
  }
}

/**
 * 格式化为使用点号分隔的日期字符串，如 "2024.11.25"
 * @param date 输入日期
 * @param fallback 日期为空时的回退字符串，默认 "-"
 */
export function formatDateWithDots(date: DateInput, fallback = "-"): string {
  if (!date) return fallback;
  try {
    return new Date(date)
      .toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, ".");
  } catch {
    return fallback;
  }
}

/**
 * 格式化为日期时间字符串（精确到分钟），如 "2024/11/25 14:30"
 * @param date 输入日期
 * @param fallback 日期为空时的回退字符串，默认 "-"
 */
export function formatDateTime(date: DateInput, fallback = "-"): string {
  if (!date) return fallback;
  try {
    return new Date(date).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return fallback;
  }
}

/**
 * 格式化为日期时间字符串（精确到秒），如 "2024/11/25 14:30:55"
 * @param date 输入日期
 * @param fallback 日期为空时的回退字符串，默认 "-"
 */
export function formatDateTimeWithSeconds(
  date: DateInput,
  fallback = "-",
): string {
  if (!date) return fallback;
  try {
    return new Date(date).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return fallback;
  }
}

/**
 * 格式化为默认 zh-CN 区域的完整日期时间字符串
 * @param date 输入日期
 * @param fallback 日期为空时的回退字符串，默认 "-"
 */
export function formatDateTimeLocale(date: DateInput, fallback = "-"): string {
  if (!date) return fallback;
  try {
    return new Date(date).toLocaleString("zh-CN");
  } catch {
    return fallback;
  }
}

/**
 * 判断值是否为 ISO 8601 日期字符串
 * @param value 输入值
 */
export function isDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
  if (!isoDateRegex.test(value)) return false;

  const date = new Date(value);
  return !isNaN(date.getTime());
}
