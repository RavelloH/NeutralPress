import "server-only";

/**
 * 安全地将 token 转换为 tsquery 词素。
 * 移除所有 tsquery 运算符和特殊字符，防止 tsquery 注入。
 * 返回用单引号包裹的词素字符串，空 token 返回空字符串。
 */
export function sanitizeTsqueryToken(token: string): string {
  // 移除 tsquery 运算符: & | ! ( ) < > : * 以及引号和反斜杠
  const sanitized = token.replace(/[&|!()<>:*'"\\]/g, "").trim();
  if (!sanitized) return "";
  // 用单引号包裹作为 tsquery 字面词素
  return `'${sanitized}'`;
}
