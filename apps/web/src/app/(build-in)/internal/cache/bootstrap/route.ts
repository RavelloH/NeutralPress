import { revalidatePath, revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

import {
  collectBootstrapTags,
  getCriticalRevalidatePathTargets,
} from "@/lib/server/cache-bootstrap-targets";
import { validateInternalBearerToken } from "@/lib/server/internal-auth";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { parseBearerToken } from "@/lib/shared/cache-bootstrap-auth";

const response = new ResponseBuilder("serverless");
const RATE_LIMIT_API_NAME = "internal.cache.bootstrap";

export async function POST(request: NextRequest): Promise<Response> {
  if (!(await limitControl(request.headers, RATE_LIMIT_API_NAME))) {
    return response.tooManyRequests() as Response;
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return response.unauthorized({
      message: "缺少或非法 Authorization",
      error: {
        code: "CACHE_BOOTSTRAP_UNAUTHORIZED",
        message: "缺少或非法 Authorization",
      },
    }) as Response;
  }

  const authResult = validateInternalBearerToken(
    request.headers.get("authorization"),
  );
  if (!authResult.ok && authResult.reason === "MASTER_SECRET_UNAVAILABLE") {
    return response.serviceUnavailable({
      message: "MASTER_SECRET 不可用，无法校验请求",
      error: {
        code: "CACHE_BOOTSTRAP_MASTER_SECRET_UNAVAILABLE",
        message: "MASTER_SECRET 不可用，无法校验请求",
      },
    }) as Response;
  }

  if (!authResult.ok) {
    return response.unauthorized({
      message: "认证失败",
      error: {
        code: "CACHE_BOOTSTRAP_UNAUTHORIZED",
        message: "认证失败",
      },
    }) as Response;
  }

  try {
    const tags = await collectBootstrapTags();
    for (const tag of tags) {
      revalidateTag(tag, { expire: 0 });
    }

    const pathTargets = getCriticalRevalidatePathTargets();
    for (const target of pathTargets) {
      revalidatePath(target.path, target.type);
    }

    return response.ok({
      message: "缓存标签与关键路径已刷新",
      data: {
        refreshedTagCount: tags.length,
        revalidatedPathCount: pathTargets.length,
      },
    }) as Response;
  } catch (error) {
    return response.serverError({
      message: "刷新缓存失败",
      error: {
        code: "CACHE_BOOTSTRAP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    }) as Response;
  }
}
