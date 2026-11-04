import type { NextRequest } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import { authVerify } from "@/lib/server/auth-verify";
import {
  getCloudflareCacheCredentials,
  getCloudflareCacheSettings,
  saveCloudflareCacheSettings,
  testCloudflareCacheCredentials,
} from "@/lib/server/cloudflare-cache-config";
import limitControl from "@/lib/server/rate-limit";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const configSchema = z
  .object({
    action: z.enum(["save", "test"]),
    zoneId: z.string().regex(/^[a-fA-F0-9]{32}$/),
    siteUrl: z.string().url().max(255),
    token: z.string().max(4096).optional(),
  })
  .strict();

async function authorized(request: NextRequest): Promise<boolean> {
  if (!(await limitControl(request.headers, "adminCdnSettings"))) return false;
  return Boolean(await authVerify({ allowedRoles: ["ADMIN"] }));
}

export async function GET(request: NextRequest): Promise<Response> {
  if (request.nextUrl.search) {
    return Response.json(
      { success: false, message: "不接受查询参数" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (!(await authorized(request))) {
    return Response.json(
      { success: false, message: "无权查看 CDN 设置" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const data = await getCloudflareCacheSettings();
    return Response.json({ success: true, data }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json(
      { success: false, message: "读取 CDN 配置失败" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const parsed = await parseSameOriginJson(request, 5200);
  if (!parsed.ok) return parsed.response;
  if (!(await authorized(request))) {
    return Response.json(
      { success: false, message: "无权修改 CDN 设置" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const result = configSchema.safeParse(parsed.input);
  if (!result.success) {
    return Response.json(
      { success: false, message: "CDN 配置格式无效" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const { action, zoneId, siteUrl, token } = result.data;
  try {
    // Blank token means "keep existing", including migration from legacy env.
    const current = token?.trim()
      ? null
      : await getCloudflareCacheCredentials();
    const effectiveToken = token?.trim() || current?.token;
    if (!effectiveToken) {
      return Response.json(
        { success: false, message: "请先填写 Cloudflare Purge Token" },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    if (
      !(await testCloudflareCacheCredentials({
        zoneId,
        siteUrl,
        token: effectiveToken,
      }))
    ) {
      return Response.json(
        { success: false, message: "Cloudflare 连接验证失败，未保存配置" },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    if (action === "save") {
      await saveCloudflareCacheSettings({ zoneId, siteUrl, token });
    }
    return Response.json(
      {
        success: true,
        message: action === "save" ? "配置已保存并立即生效" : "连接测试通过",
        data: action === "save" ? await getCloudflareCacheSettings() : null,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[CDN config] Failed to process settings:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { success: false, message: "CDN 配置处理失败，请检查输入和服务日志" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
