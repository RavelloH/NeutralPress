import crypto from "crypto";

/**
 * 计算文本的 MD5 哈希值（规范化处理：小写 + 去除首尾空格）
 * @param text 输入文本（通常为邮箱地址）
 * @returns 十六进制 MD5 哈希字符串
 */
export function calculateMD5(text: string): string {
  return crypto.createHash("md5").update(text.toLowerCase().trim()).digest("hex");
}
