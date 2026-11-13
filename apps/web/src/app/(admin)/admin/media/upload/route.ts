import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { head as headBlob } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import type { NextRequest } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import {
  consumeDirectUploadTicket,
  createDirectUploadTicket,
  DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES,
  DIRECT_UPLOAD_TICKET_TTL_SECONDS,
} from "@/lib/server/direct-upload";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import { generateSignedImageId } from "@/lib/server/image-crypto";
import {
  processImage,
  type ProcessMode,
  SUPPORTED_IMAGE_FORMATS,
} from "@/lib/server/image-processor";
import { buildObjectKey, deleteObject, uploadObject } from "@/lib/server/oss";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import {
  readRequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/server/request-body";
import ResponseBuilder from "@/lib/server/response";
import {
  fetchPublicHttpUrlBuffer,
  readResponseBufferWithLimit,
} from "@/lib/server/url-security";
import { getOrCreateVirtualStorage } from "@/lib/server/virtual-storage";

const response = new ResponseBuilder("serverless");
const DEFAULT_EXTERNAL_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const EXTERNAL_FETCH_TIMEOUT_MS = 15000;
const MAX_UPLOAD_REQUEST_BYTES = DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES + 64 * 1024;
const TEMP_UPLOAD_PATH_TEMPLATE = "temp/{year}/{month}/{filename}";
type ExternalImportMode = "record" | "transfer";
type StorageProviderRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.storageProvider.findFirst>>
>;

function getMediaHashLockKey(hash: string): bigint {
  return BigInt(`0x${hash.slice(0, 15)}`);
}

function normalizePosixPath(p: string): string {
  const trimmed = p.trim();
  const normalized = path.posix.normalize(trimmed || "/{filename}");
  const withoutDots = normalized.replace(/^(\.\.(\/|\\|$))+/, "");
  return withoutDots.replace(/^\/+/, "");
}

function joinStoragePrefix(prefix: string | undefined, key: string): string {
  const normalizedKey = normalizePosixPath(key);
  if (!prefix) return normalizedKey;

  const normalizedPrefix = normalizePosixPath(prefix);
  if (!normalizedPrefix) return normalizedKey;

  if (
    normalizedKey === normalizedPrefix ||
    normalizedKey.startsWith(`${normalizedPrefix}/`)
  ) {
    return normalizedKey;
  }

  return normalizePosixPath(path.posix.join(normalizedPrefix, normalizedKey));
}

function parseUploadFileSize(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

async function readS3BodyWithLimit(
  body: unknown,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) {
    throw new Error("临时文件内容为空");
  }

  if (
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new Error("文件大小超出限制");
      }
      chunks.push(buf);
    }

    return Buffer.concat(chunks, total);
  }

  throw new Error("不支持的临时文件响应格式");
}

function closeS3Body(body: unknown): void {
  if (typeof body !== "object" || body === null) return;

  const stream = body as {
    destroy?: () => void;
    cancel?: () => Promise<unknown> | void;
  };
  if (typeof stream.destroy === "function") {
    stream.destroy();
  } else if (typeof stream.cancel === "function") {
    void Promise.resolve(stream.cancel()).catch(() => undefined);
  }
}

/**
 * @openapi
 * /admin/media/upload:
 *   post:
 *     summary: 上传单个媒体文件
 *     description: 上传单个图片文件，支持多种处理模式
 *     tags: [Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               mode:
 *                 type: string
 *                 enum: [lossy, lossless, original]
 *                 default: lossy
 *               storageProviderId:
 *                 type: string
 *                 description: 存储提供商ID（可选）
 *               importMode:
 *                 type: string
 *                 enum: [record, transfer]
 *                 description: 外部导入模式（record=外链优化，transfer=转存托管）
 *     responses:
 *       200:
 *         description: 上传成功
 *       400:
 *         description: 请求参数错误
 *       401:
 *         description: 未授权
 *       429:
 *         description: 请求过于频繁
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    // 速率限制
    if (!(await limitControl(request.headers))) {
      return response.tooManyRequests() as Response;
    }

    // 获取 access_token（从 header 或 cookie）
    const authHeader = request.headers.get("authorization");
    const accessToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : request.cookies.get("ACCESS_TOKEN")?.value;

    if (!accessToken) {
      return response.unauthorized({
        message: "未提供访问令牌",
      }) as Response;
    }

    // 身份验证
    const user = await authVerify({
      allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
      accessToken,
    });

    if (!user) {
      return response.unauthorized() as Response;
    }

    // 在解析 multipart 前限制整个请求体，包含无 Content-Length 的请求。
    let formData: FormData;
    try {
      const body = await readRequestBodyWithLimit(
        request,
        MAX_UPLOAD_REQUEST_BYTES,
      );
      const contentType = request.headers.get("content-type");
      formData = await new Response(body, {
        headers: contentType ? { "content-type": contentType } : undefined,
      }).formData();
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return response.response({
          status: 413,
          message: "上传请求内容过大",
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "上传请求最大允许 50 MiB + 64 KiB",
          },
        }) as Response;
      }
      throw error;
    }
    const actionRaw = formData.get("action") as string | null;
    const action = actionRaw?.trim().toLowerCase();
    const mode = (formData.get("mode") as string) || "lossy";
    const storageProviderId = formData.get("storageProviderId") as
      | string
      | null;
    const importModeRaw = formData.get("importMode") as string | null;
    const normalizedImportMode = importModeRaw?.trim().toLowerCase();
    const importMode: ExternalImportMode =
      normalizedImportMode === "record" || normalizedImportMode === "transfer"
        ? normalizedImportMode
        : storageProviderId || mode !== "original"
          ? "transfer"
          : "record";
    const folderIdStr = formData.get("folderId") as string | null;
    let folderId = folderIdStr ? parseInt(folderIdStr, 10) : null;
    let file = formData.get("file") as File | null;
    const initFileName = (formData.get("fileName") as string | null)?.trim();
    const initFileSize = parseUploadFileSize(
      formData.get("fileSize") as string | null,
    );
    const initContentTypeRaw = (formData.get("contentType") as string | null)
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    const initContentType = initContentTypeRaw || "application/octet-stream";
    const completeTempKey = (formData.get("tempKey") as string | null)?.trim();
    const completeOriginalName = (
      formData.get("originalName") as string | null
    )?.trim();

    // 如果没有指定文件夹，默认使用公共空间根目录
    if (folderId === null) {
      const publicRoot = await prisma.virtualFolder.findFirst({
        where: { systemType: "ROOT_PUBLIC" },
        select: { id: true },
      });
      if (publicRoot) {
        folderId = publicRoot.id;
      }
    }

    // 验证目标文件夹：不能上传到 ROOT_USERS
    if (folderId !== null) {
      const targetFolder = await prisma.virtualFolder.findUnique({
        where: { id: folderId },
        select: { id: true, systemType: true, userUid: true, path: true },
      });
      if (!targetFolder) {
        return response.badRequest({
          message: "目标文件夹不存在",
          error: {
            code: "INVALID_FOLDER",
            message: "请选择有效的文件夹",
          },
        }) as Response;
      }

      if (targetFolder?.systemType === "ROOT_USERS") {
        return response.badRequest({
          message: "不能上传到用户目录",
          error: {
            code: "INVALID_FOLDER",
            message: "请选择公共空间或我的文件夹",
          },
        }) as Response;
      }

      if (user.role === "AUTHOR") {
        const pathIds = targetFolder.path
          .split("/")
          .filter(Boolean)
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id));

        const ancestors = pathIds.length
          ? await prisma.virtualFolder.findMany({
              where: { id: { in: pathIds } },
              select: { id: true, systemType: true, userUid: true },
            })
          : [];

        const hasPublicAccess = ancestors.some(
          (folder) => folder.systemType === "ROOT_PUBLIC",
        );
        const hasOwnHomeAccess = ancestors.some(
          (folder) =>
            folder.systemType === "USER_HOME" && folder.userUid === user.uid,
        );
        const hasOtherUserHome = ancestors.some(
          (folder) =>
            folder.systemType === "USER_HOME" &&
            folder.userUid !== null &&
            folder.userUid !== user.uid,
        );

        if ((!hasPublicAccess && !hasOwnHomeAccess) || hasOtherUserHome) {
          return response.forbidden({
            message: "没有权限上传到该文件夹",
            error: {
              code: "FORBIDDEN_FOLDER",
              message: "只能上传到公共空间或自己的文件夹",
            },
          }) as Response;
        }
      }
    }

    // 检查是否为外部图片导入
    const externalUrl = formData.get("externalUrl") as string | null;
    const altText = formData.get("altText") as string | null;
    const displayName = formData.get("displayName") as string | null;

    // 验证模式
    if (!["lossy", "lossless", "original"].includes(mode)) {
      return response.badRequest({
        message: "无效的处理模式",
        error: {
          code: "INVALID_MODE",
          message: "处理模式必须为: lossy/lossless/original",
        },
      }) as Response;
    }

    // ========================================================================
    // 客户端直传初始化分支
    // ========================================================================
    if (action === "init") {
      if (!initFileName || initFileSize === null) {
        return response.badRequest({
          message: "缺少上传初始化参数",
          error: {
            code: "INVALID_INIT_PARAMS",
            message: "请提供 fileName 与 fileSize",
          },
        }) as Response;
      }

      if (
        initFileSize <= 0 ||
        initFileSize > DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES
      ) {
        return response.badRequest({
          message: "文件大小必须大于 0 且不超过 50 MiB",
          error: {
            code: "FILE_TOO_LARGE",
            message: "直传文件最大允许 50 MiB",
          },
        }) as Response;
      }

      let storageProvider: StorageProviderRecord | null = null;
      if (storageProviderId) {
        storageProvider = await prisma.storageProvider.findUnique({
          where: { id: storageProviderId, isActive: true },
        });

        if (!storageProvider) {
          return response.badRequest({
            message: "指定的存储提供商不存在或未启用",
            error: {
              code: "INVALID_STORAGE",
              message: "无效的存储提供商ID",
            },
          }) as Response;
        }

        if (user.role === "AUTHOR" && !storageProvider.isDefault) {
          return response.forbidden({
            message: "权限不足，只能使用默认存储提供商",
            error: {
              code: "FORBIDDEN",
              message: "AUTHOR 角色只能使用默认存储",
            },
          }) as Response;
        }
      } else {
        storageProvider = await prisma.storageProvider.findFirst({
          where: { isDefault: true, isActive: true },
        });
      }

      if (!storageProvider) {
        return response.badRequest({
          message: "未找到可用的存储提供商",
          error: { code: "NO_STORAGE", message: "请先配置存储提供商" },
        }) as Response;
      }

      if (initFileSize > storageProvider.maxFileSize) {
        return response.badRequest({
          message: `文件大小超出限制: ${(initFileSize / 1024 / 1024).toFixed(2)}MB，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
          error: {
            code: "FILE_TOO_LARGE",
            message: `文件大小超出限制，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
          },
        }) as Response;
      }

      if (!initContentType.startsWith("image/")) {
        return response.badRequest({
          message: `不是图片文件: ${initContentType || "未知"}`,
          error: {
            code: "NOT_IMAGE",
            message: "只能上传图片文件",
          },
        }) as Response;
      }

      if (mode !== "original") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!SUPPORTED_IMAGE_FORMATS.includes(initContentType as any)) {
          const ext = initFileName.split(".").pop()?.toLowerCase();
          const isHeicHeif = ext === "heic" || ext === "heif";
          return response.badRequest({
            message: isHeicHeif
              ? "HEIC/HEIF 格式请选择「保留原片」模式上传"
              : `不支持的图片格式: ${initContentType || "未知"}，请选择「保留原片」模式`,
            error: {
              code: "UNSUPPORTED_FORMAT",
              message: isHeicHeif
                ? "HEIC/HEIF 格式请选择「保留原片」模式上传"
                : "不支持的图片格式，请选择「保留原片」模式",
            },
          }) as Response;
        }
      }

      if (
        storageProvider.type === "LOCAL" ||
        storageProvider.type === "GITHUB_PAGES" ||
        storageProvider.type === "EXTERNAL_URL"
      ) {
        return response.ok({
          data: {
            uploadStrategy: "server",
            providerType: storageProvider.type,
            storageProviderId: storageProvider.id,
          },
        }) as Response;
      }

      const tempKey = buildObjectKey({
        filename: `${randomUUID()}${path.extname(initFileName)}`,
        pathTemplate: TEMP_UPLOAD_PATH_TEMPLATE,
        ensureUniqueName: true,
      });

      if (storageProvider.type === "AWS_S3") {
        const s3Config = (storageProvider.config || {}) as {
          accessKeyId?: string;
          secretAccessKey?: string;
          region?: string;
          bucket?: string;
          endpoint?: string;
          basePath?: string;
          forcePathStyle?: boolean | string;
        };

        if (
          !s3Config.accessKeyId ||
          !s3Config.secretAccessKey ||
          !s3Config.region ||
          !s3Config.bucket
        ) {
          return response.badRequest({
            message: "AWS_S3 配置不完整",
            error: {
              code: "INVALID_STORAGE_CONFIG",
              message: "请检查 accessKeyId/secretAccessKey/region/bucket",
            },
          }) as Response;
        }

        const objectKey = joinStoragePrefix(s3Config.basePath, tempKey);
        const s3Client = new S3Client({
          region: s3Config.region,
          endpoint: s3Config.endpoint,
          requestChecksumCalculation: "WHEN_REQUIRED",
          forcePathStyle:
            s3Config.forcePathStyle === true ||
            s3Config.forcePathStyle === "true",
          credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
          },
        });

        const uploadCommand = new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: objectKey,
          ContentType: initContentType,
          ContentLength: initFileSize,
        });
        const uploadUrl = await getSignedUrl(
          s3Client as unknown as Parameters<typeof getSignedUrl>[0],
          uploadCommand as unknown as Parameters<typeof getSignedUrl>[1],
          {
            expiresIn: DIRECT_UPLOAD_TICKET_TTL_SECONDS,
            signableHeaders: new Set(["content-length", "content-type"]),
          },
        );

        await createDirectUploadTicket({
          uid: user.uid,
          providerId: String(storageProvider.id),
          tempKey,
          expectedSize: initFileSize,
          contentType: initContentType,
        });

        return response.ok({
          data: {
            uploadStrategy: "client",
            providerType: "AWS_S3",
            storageProviderId: storageProvider.id,
            tempKey,
            uploadMethod: "PUT",
            uploadUrl,
            uploadHeaders: {
              "Content-Type": initContentType,
            },
          },
        }) as Response;
      }

      if (storageProvider.type === "VERCEL_BLOB") {
        const blobConfig = (storageProvider.config || {}) as {
          token?: string;
          basePath?: string;
        };

        if (!blobConfig.token) {
          return response.badRequest({
            message: "VERCEL_BLOB 配置缺少 token",
            error: {
              code: "INVALID_STORAGE_CONFIG",
              message: "请检查 Vercel Blob token 配置",
            },
          }) as Response;
        }

        const blobPathname = joinStoragePrefix(blobConfig.basePath, tempKey);
        const blobClientToken = await generateClientTokenFromReadWriteToken({
          token: blobConfig.token,
          pathname: blobPathname,
          maximumSizeInBytes: initFileSize,
          allowedContentTypes: ["image/*"],
          validUntil: Date.now() + DIRECT_UPLOAD_TICKET_TTL_SECONDS * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
        });

        await createDirectUploadTicket({
          uid: user.uid,
          providerId: String(storageProvider.id),
          tempKey,
          expectedSize: initFileSize,
          contentType: initContentType,
        });

        return response.ok({
          data: {
            uploadStrategy: "client",
            providerType: "VERCEL_BLOB",
            storageProviderId: storageProvider.id,
            tempKey,
            blobPathname,
            blobClientToken,
          },
        }) as Response;
      }

      return response.ok({
        data: {
          uploadStrategy: "server",
          providerType: storageProvider.type,
          storageProviderId: storageProvider.id,
        },
      }) as Response;
    }

    // ========================================================================
    // 客户端直传完成分支：下载 temp 后复用原上传流程
    // ========================================================================
    if (action === "complete") {
      if (!completeTempKey) {
        return response.badRequest({
          message: "缺少 tempKey",
          error: {
            code: "INVALID_COMPLETE_PARAMS",
            message: "请提供 tempKey",
          },
        }) as Response;
      }

      if (!storageProviderId) {
        return response.badRequest({
          message: "缺少存储提供商ID",
          error: {
            code: "INVALID_COMPLETE_PARAMS",
            message: "complete 模式必须提供 storageProviderId",
          },
        }) as Response;
      }

      const storageProvider = await prisma.storageProvider.findUnique({
        where: { id: storageProviderId, isActive: true },
      });

      if (!storageProvider) {
        return response.badRequest({
          message: "指定的存储提供商不存在或未启用",
          error: {
            code: "INVALID_STORAGE",
            message: "无效的存储提供商ID",
          },
        }) as Response;
      }

      if (user.role === "AUTHOR" && !storageProvider.isDefault) {
        return response.forbidden({
          message: "权限不足，只能使用默认存储提供商",
          error: {
            code: "FORBIDDEN",
            message: "AUTHOR 角色只能使用默认存储",
          },
        }) as Response;
      }

      if (
        storageProvider.type !== "AWS_S3" &&
        storageProvider.type !== "VERCEL_BLOB"
      ) {
        return response.badRequest({
          message: "该存储类型不支持 complete 流程",
          error: {
            code: "UNSUPPORTED_COMPLETE_MODE",
            message: `当前存储类型 ${storageProvider.type} 暂不支持 complete`,
          },
        }) as Response;
      }

      const directUploadTicket = await consumeDirectUploadTicket({
        uid: user.uid,
        providerId: String(storageProvider.id),
        tempKey: completeTempKey,
      });

      if (!directUploadTicket) {
        return response.badRequest({
          message: "直传票据无效、已过期或已使用",
          error: {
            code: "INVALID_DIRECT_UPLOAD",
            message: "请重新初始化上传",
          },
        }) as Response;
      }

      const { after } = await import("next/server");
      after(async () => {
        await deleteObject({
          type: storageProvider.type,
          baseUrl: storageProvider.baseUrl,
          pathTemplate: storageProvider.pathTemplate,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: storageProvider.config as any,
          key: directUploadTicket.tempKey,
        }).catch((error) => {
          console.error("Delete temp object failed:", error);
        });
      });

      if (directUploadTicket.expectedSize > storageProvider.maxFileSize) {
        return response.badRequest({
          message: "直传文件大小超过当前存储限制",
          error: {
            code: "FILE_TOO_LARGE",
            message: "文件大小超出限制",
          },
        }) as Response;
      }

      let tempBuffer: Buffer;
      const tempMimeType = directUploadTicket.contentType;

      try {
        if (storageProvider.type === "AWS_S3") {
          const s3Config = (storageProvider.config || {}) as {
            accessKeyId?: string;
            secretAccessKey?: string;
            region?: string;
            bucket?: string;
            endpoint?: string;
            basePath?: string;
            forcePathStyle?: boolean | string;
          };

          if (
            !s3Config.accessKeyId ||
            !s3Config.secretAccessKey ||
            !s3Config.region ||
            !s3Config.bucket
          ) {
            return response.badRequest({
              message: "AWS_S3 配置不完整",
              error: {
                code: "INVALID_STORAGE_CONFIG",
                message: "请检查 accessKeyId/secretAccessKey/region/bucket",
              },
            }) as Response;
          }

          const objectKey = joinStoragePrefix(
            s3Config.basePath,
            directUploadTicket.tempKey,
          );
          const s3Client = new S3Client({
            region: s3Config.region,
            endpoint: s3Config.endpoint,
            forcePathStyle:
              s3Config.forcePathStyle === true ||
              s3Config.forcePathStyle === "true",
            credentials: {
              accessKeyId: s3Config.accessKeyId,
              secretAccessKey: s3Config.secretAccessKey,
            },
          });

          const object = await s3Client.send(
            new GetObjectCommand({
              Bucket: s3Config.bucket,
              Key: objectKey,
            }),
          );

          if (
            typeof object.ContentLength === "number" &&
            object.ContentLength > storageProvider.maxFileSize
          ) {
            closeS3Body(object.Body);
            return response.badRequest({
              message: `文件大小超出限制: ${(object.ContentLength / 1024 / 1024).toFixed(2)}MB，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
              error: {
                code: "FILE_TOO_LARGE",
                message: `文件大小超出限制，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
              },
            }) as Response;
          }

          if (object.ContentLength !== directUploadTicket.expectedSize) {
            closeS3Body(object.Body);
            return response.badRequest({
              message: "直传对象大小与初始化声明不一致",
              error: {
                code: "FILE_SIZE_MISMATCH",
                message: "请重新初始化上传",
              },
            }) as Response;
          }

          const objectContentType = object.ContentType?.split(";")[0]
            ?.trim()
            .toLowerCase();
          if (objectContentType !== directUploadTicket.contentType) {
            closeS3Body(object.Body);
            return response.badRequest({
              message: "直传对象类型与初始化声明不一致",
              error: {
                code: "CONTENT_TYPE_MISMATCH",
                message: "请重新初始化上传",
              },
            }) as Response;
          }

          tempBuffer = await readS3BodyWithLimit(
            object.Body,
            directUploadTicket.expectedSize,
          );
        } else {
          const blobConfig = (storageProvider.config || {}) as {
            token?: string;
            basePath?: string;
          };

          if (!blobConfig.token) {
            return response.badRequest({
              message: "VERCEL_BLOB 配置缺少 token",
              error: {
                code: "INVALID_STORAGE_CONFIG",
                message: "请检查 Vercel Blob token 配置",
              },
            }) as Response;
          }

          const blobPathname = joinStoragePrefix(
            blobConfig.basePath,
            directUploadTicket.tempKey,
          );
          const blobMeta = await headBlob(blobPathname, {
            token: blobConfig.token,
          });
          if (blobMeta.size !== directUploadTicket.expectedSize) {
            return response.badRequest({
              message: "直传对象大小与初始化声明不一致",
              error: {
                code: "FILE_SIZE_MISMATCH",
                message: "请重新初始化上传",
              },
            }) as Response;
          }
          if (
            blobMeta.contentType.split(";")[0]?.trim().toLowerCase() !==
            directUploadTicket.contentType
          ) {
            return response.badRequest({
              message: "直传对象类型与初始化声明不一致",
              error: {
                code: "CONTENT_TYPE_MISMATCH",
                message: "请重新初始化上传",
              },
            }) as Response;
          }

          const blobResponse = await fetch(blobMeta.downloadUrl, {
            method: "GET",
          });
          if (!blobResponse.ok) {
            throw new Error(
              `无法读取临时文件: HTTP ${blobResponse.status} ${blobResponse.statusText}`,
            );
          }

          tempBuffer = await readResponseBufferWithLimit(
            blobResponse,
            directUploadTicket.expectedSize,
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "读取临时文件失败";
        return response.badRequest({
          message: errorMessage,
          error: {
            code: "TEMP_FILE_READ_FAILED",
            message: errorMessage,
          },
        }) as Response;
      }

      if (tempBuffer.byteLength !== directUploadTicket.expectedSize) {
        return response.badRequest({
          message: "直传对象大小与初始化声明不一致",
          error: {
            code: "FILE_SIZE_MISMATCH",
            message: "请重新初始化上传",
          },
        }) as Response;
      }

      file = new File(
        [new Uint8Array(tempBuffer)],
        completeOriginalName || initFileName || `upload-${Date.now()}.bin`,
        {
          type: tempMimeType,
          lastModified: Date.now(),
        },
      );
    }

    // ========================================================================
    // 外部图片导入分支
    // ========================================================================
    if (externalUrl) {
      try {
        let transferStorageProvider: StorageProviderRecord | null = null;
        if (importMode === "transfer") {
          if (storageProviderId) {
            transferStorageProvider = await prisma.storageProvider.findUnique({
              where: { id: storageProviderId, isActive: true },
            });

            if (!transferStorageProvider) {
              return response.badRequest({
                message: "指定的存储提供商不存在或未启用",
                error: {
                  code: "INVALID_STORAGE",
                  message: "无效的存储提供商ID",
                },
              }) as Response;
            }

            // AUTHOR 只能使用默认存储提供商
            if (user.role === "AUTHOR" && !transferStorageProvider.isDefault) {
              return response.forbidden({
                message: "权限不足，只能使用默认存储提供商",
                error: {
                  code: "FORBIDDEN",
                  message: "AUTHOR 角色只能使用默认存储",
                },
              }) as Response;
            }
          } else {
            transferStorageProvider = await prisma.storageProvider.findFirst({
              where: { isDefault: true, isActive: true },
            });
          }

          if (!transferStorageProvider) {
            return response.badRequest({
              message: "未找到可用的存储提供商",
              error: { code: "NO_STORAGE", message: "请先配置存储提供商" },
            }) as Response;
          }
        }

        let maxExternalSize = DEFAULT_EXTERNAL_MAX_FILE_SIZE;
        if (
          transferStorageProvider?.maxFileSize &&
          transferStorageProvider.maxFileSize > 0
        ) {
          maxExternalSize = transferStorageProvider.maxFileSize;
        } else {
          const defaultStorage = await prisma.storageProvider.findFirst({
            where: { isDefault: true, isActive: true },
            select: { maxFileSize: true },
          });
          if (defaultStorage?.maxFileSize && defaultStorage.maxFileSize > 0) {
            maxExternalSize = defaultStorage.maxFileSize;
          }
        }

        // 外链优化模式使用虚拟存储；转存模式走真实存储提供商
        const virtualStorage =
          importMode === "record" ? await getOrCreateVirtualStorage() : null;

        // 在每次请求前解析并固定公网 IP，防止 DNS 重绑定 SSRF。
        const fetchedExternal = await fetchPublicHttpUrlBuffer(
          externalUrl.trim(),
          {
            method: "GET",
            timeoutMs: EXTERNAL_FETCH_TIMEOUT_MS,
            maxBytes: maxExternalSize,
            maxRedirects: 0,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; NeutralPress/1.0; +https://neutralpress.net/bot)",
            },
          },
        );
        const normalizedExternalUrl = fetchedExternal.finalUrl;

        if (fetchedExternal.status >= 300 && fetchedExternal.status < 400) {
          return response.badRequest({
            message: "外部图片地址不允许重定向",
            error: {
              code: "REDIRECT_NOT_ALLOWED",
              message: "请使用最终图片地址",
            },
          }) as Response;
        }

        if (fetchedExternal.status < 200 || fetchedExternal.status >= 300) {
          return response.badRequest({
            message: `无法获取外部图片: HTTP ${fetchedExternal.status}`,
            error: {
              code: "FETCH_FAILED",
              message: `HTTP 状态码: ${fetchedExternal.status}`,
            },
          }) as Response;
        }

        // 检查 Content-Type
        const contentTypeHeader =
          fetchedExternal.headers.get("content-type") || "image/jpeg";
        const contentType =
          contentTypeHeader.split(";")[0]?.trim() || "image/jpeg";
        if (!contentType.startsWith("image/")) {
          return response.badRequest({
            message: `URL 返回的不是图片类型: ${contentType}`,
            error: {
              code: "NOT_IMAGE",
              message: "只能导入图片文件",
            },
          }) as Response;
        }

        const buffer = fetchedExternal.body;

        // 提取文件名
        const urlObj = new URL(normalizedExternalUrl);
        const pathParts = urlObj.pathname.split("/");
        const urlFilename =
          displayName ||
          pathParts[pathParts.length - 1] ||
          `external-${Date.now()}.jpg`;

        // 先使用 original 模式提取完整的元数据（包括 EXIF）
        const metadata = await processImage(
          buffer,
          urlFilename,
          contentType,
          "original",
        );

        // 根据用户选择的模式处理图片（如果需要压缩）
        const processed =
          mode === "original"
            ? metadata
            : await processImage(
                buffer,
                urlFilename,
                contentType,
                mode as ProcessMode,
              );

        // 合并元数据（确保使用原始元数据）
        processed.exif = metadata.exif;
        processed.hash = metadata.hash;
        processed.shortHash = metadata.shortHash;
        processed.width = metadata.width;
        processed.height = metadata.height;

        // 检查去重
        const existingMedia = await prisma.media.findFirst({
          where: { hash: processed.hash },
          select: {
            id: true,
            originalName: true,
            shortHash: true,
            storageUrl: true,
            width: true,
            height: true,
            size: true,
          },
        });

        if (existingMedia) {
          // 文件已存在，直接返回现有记录
          const imageId = generateSignedImageId(existingMedia.shortHash);
          return response.ok({
            data: {
              id: existingMedia.id,
              originalName: existingMedia.originalName,
              shortHash: existingMedia.shortHash,
              imageId,
              url: `/p/${imageId}`,
              originalSize: buffer.length,
              processedSize: existingMedia.size,
              isDuplicate: true,
              width: existingMedia.width,
              height: existingMedia.height,
            },
            message: "文件已存在（已去重）",
          }) as Response;
        }

        let transferUploadResult: Awaited<
          ReturnType<typeof uploadObject>
        > | null = null;
        let transferFileName: string | null = null;

        if (importMode === "transfer" && transferStorageProvider) {
          transferFileName = `${processed.shortHash}.${processed.extension}`;
          transferUploadResult = await uploadObject({
            type: transferStorageProvider.type,
            baseUrl: transferStorageProvider.baseUrl,
            pathTemplate: transferStorageProvider.pathTemplate,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: transferStorageProvider.config as any,
            file: {
              buffer: processed.buffer,
              filename: transferFileName,
              contentType: processed.mimeType,
            },
          });
        }

        const mediaFileName =
          importMode === "transfer" && transferFileName
            ? transferFileName
            : urlFilename;
        const mediaStorageUrl =
          importMode === "transfer" && transferUploadResult
            ? transferUploadResult.url
            : normalizedExternalUrl;
        const mediaStorageProviderId =
          importMode === "transfer"
            ? transferStorageProvider?.id
            : virtualStorage?.id;

        if (!mediaStorageProviderId) {
          throw new Error("未找到可用的存储提供商");
        }

        const lockKey = getMediaHashLockKey(processed.hash);
        const lockedCreateResult = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

          const lockedExisting = await tx.media.findFirst({
            where: { hash: processed.hash },
            select: {
              id: true,
              originalName: true,
              shortHash: true,
              storageUrl: true,
              width: true,
              height: true,
              size: true,
            },
          });

          if (lockedExisting) {
            return { existing: lockedExisting, media: null };
          }

          const media = await tx.media.create({
            data: {
              fileName: mediaFileName,
              originalName: urlFilename,
              mimeType: processed.mimeType,
              size: processed.size,
              shortHash: processed.shortHash,
              hash: processed.hash,
              mediaType: "IMAGE",
              width: processed.width,
              height: processed.height,
              altText: altText || undefined,
              blur: processed.blur,
              thumbnails: {},
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              exif: (processed.exif || {}) as any,
              isOptimized: mode !== "original",
              storageUrl: mediaStorageUrl,
              storageProviderId: mediaStorageProviderId,
              userUid: user.uid,
              folderId: folderId || undefined,
            },
          });

          return { existing: null, media };
        });

        if (lockedCreateResult.existing) {
          if (
            importMode === "transfer" &&
            transferUploadResult &&
            transferStorageProvider
          ) {
            await deleteObject({
              type: transferStorageProvider.type,
              baseUrl: transferStorageProvider.baseUrl,
              pathTemplate: transferStorageProvider.pathTemplate,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              config: transferStorageProvider.config as any,
              key: transferUploadResult.key,
            }).catch((error) => {
              console.error(
                "Delete duplicate transferred object failed:",
                error,
              );
            });
          }

          const imageId = generateSignedImageId(
            lockedCreateResult.existing.shortHash,
          );
          return response.ok({
            data: {
              id: lockedCreateResult.existing.id,
              originalName: lockedCreateResult.existing.originalName,
              shortHash: lockedCreateResult.existing.shortHash,
              imageId,
              url: `/p/${imageId}`,
              originalSize: buffer.length,
              processedSize: lockedCreateResult.existing.size,
              isDuplicate: true,
              width: lockedCreateResult.existing.width,
              height: lockedCreateResult.existing.height,
            },
            message: "文件已存在（已去重）",
          }) as Response;
        }

        const media = lockedCreateResult.media!;

        // 记录审计日志
        await logAuditEvent({
          user: {
            uid: String(user.uid),
            ipAddress: (await getClientIP()) || "Unknown",
            userAgent: (await getClientUserAgent()) || "Unknown",
          },
          details: {
            action: "IMPORT_EXTERNAL_MEDIA",
            resourceType: "Media",
            resourceId: String(media.id),
            value: {
              old: null,
              new: {
                fileName: media.fileName,
                originalName: media.originalName,
                importMode,
                externalUrl: normalizedExternalUrl,
                size: buffer.length,
                processedSize: processed.size,
                storageProviderId: media.storageProviderId,
              },
            },
            description: `${importMode === "transfer" ? "转存" : "导入"}外部图片: ${normalizedExternalUrl}`,
          },
        });

        const imageId = generateSignedImageId(processed.shortHash);
        return response.ok({
          data: {
            id: media.id,
            originalName: media.originalName,
            shortHash: media.shortHash,
            imageId,
            url: `/p/${imageId}`,
            originalSize: buffer.length,
            processedSize: processed.size,
            isDuplicate: false,
            width: media.width,
            height: media.height,
          },
          message: "导入成功",
        }) as Response;
      } catch (error) {
        console.error("Import external image error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "导入外部图片失败";
        return response.badRequest({
          message: errorMessage,
          error: {
            code: "IMPORT_FAILED",
            message: errorMessage,
          },
        }) as Response;
      }
    }

    // ========================================================================
    // 文件上传分支（原有逻辑）
    // ========================================================================

    // 验证文件
    if (!file) {
      return response.badRequest({
        message: "请上传一个文件",
        error: { code: "NO_FILE", message: "未找到文件" },
      }) as Response;
    }

    // 获取存储提供商
    let storageProvider;

    if (storageProviderId) {
      // 如果提供了 storageProviderId，查找指定的存储提供商
      storageProvider = await prisma.storageProvider.findUnique({
        where: { id: storageProviderId, isActive: true },
      });

      if (!storageProvider) {
        return response.badRequest({
          message: "指定的存储提供商不存在或未启用",
          error: { code: "INVALID_STORAGE", message: "无效的存储提供商ID" },
        }) as Response;
      }

      // AUTHOR 只能使用默认存储提供商
      if (user.role === "AUTHOR" && !storageProvider.isDefault) {
        return response.forbidden({
          message: "权限不足，只能使用默认存储提供商",
          error: { code: "FORBIDDEN", message: "AUTHOR 角色只能使用默认存储" },
        }) as Response;
      }
    } else {
      // 未提供 storageProviderId，使用默认存储提供商
      storageProvider = await prisma.storageProvider.findFirst({
        where: { isDefault: true, isActive: true },
      });
    }

    if (!storageProvider) {
      return response.badRequest({
        message: "未找到可用的存储提供商",
        error: { code: "NO_STORAGE", message: "请先配置存储提供商" },
      }) as Response;
    }

    // 验证文件类型
    // 在 original 模式下，接受所有图片格式
    if (mode === "original") {
      // 只检查是否为图片类型
      if (!file.type.startsWith("image/")) {
        return response.badRequest({
          message: `不是图片文件: ${file.type || "未知"}`,
          error: {
            code: "NOT_IMAGE",
            message: "只能上传图片文件",
          },
        }) as Response;
      }
    } else {
      // lossy/lossless 模式需要 sharp 支持的格式
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!SUPPORTED_IMAGE_FORMATS.includes(file.type as any)) {
        // 检查是否是 HEIC/HEIF 格式（浏览器可能识别为 application/octet-stream）
        const ext = file.name.split(".").pop()?.toLowerCase();
        const isHeicHeif = ext === "heic" || ext === "heif";

        return response.badRequest({
          message: isHeicHeif
            ? "HEIC/HEIF 格式请选择「保留原片」模式上传"
            : `不支持的图片格式: ${file.type || "未知"}，请选择「保留原片」模式`,
          error: {
            code: "UNSUPPORTED_FORMAT",
            message: isHeicHeif
              ? "HEIC/HEIF 格式请选择「保留原片」模式上传"
              : `不支持的图片格式，请选择「保留原片」模式`,
          },
        }) as Response;
      }
    }

    // 验证文件大小
    if (file.size > storageProvider.maxFileSize) {
      return response.badRequest({
        message: `文件大小超出限制: ${(file.size / 1024 / 1024).toFixed(2)}MB，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
        error: {
          code: "FILE_TOO_LARGE",
          message: `文件大小超出限制，最大允许 ${(storageProvider.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
        },
      }) as Response;
    }

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 先使用 original 模式提取完整的元数据（包括 EXIF）
    const metadata = await processImage(
      buffer,
      file.name,
      file.type,
      "original",
    );

    // 根据用户选择的模式处理图片（如果需要压缩）
    const processed =
      mode === "original"
        ? metadata
        : await processImage(buffer, file.name, file.type, mode as ProcessMode);

    // 合并元数据（确保使用原始元数据）
    processed.exif = metadata.exif;
    processed.hash = metadata.hash;
    processed.shortHash = metadata.shortHash;
    processed.width = metadata.width;
    processed.height = metadata.height;

    // 检查去重
    const existingMedia = await prisma.media.findFirst({
      where: { hash: processed.hash },
      select: {
        id: true,
        originalName: true,
        shortHash: true,
        storageUrl: true,
        width: true,
        height: true,
        size: true,
      },
    });

    if (existingMedia) {
      // 文件已存在，直接返回现有记录
      const imageId = generateSignedImageId(existingMedia.shortHash);
      return response.ok({
        data: {
          id: existingMedia.id,
          originalName: existingMedia.originalName,
          shortHash: existingMedia.shortHash,
          imageId,
          url: `/p/${imageId}`,
          originalSize: file.size,
          processedSize: existingMedia.size,
          isDuplicate: true,
          width: existingMedia.width,
          height: existingMedia.height,
        },
        message: "文件已存在（已去重）",
      }) as Response;
    }

    // 上传到 OSS
    const fileName = `${processed.shortHash}.${processed.extension}`;
    const uploadResult = await uploadObject({
      type: storageProvider.type,
      baseUrl: storageProvider.baseUrl,
      pathTemplate: storageProvider.pathTemplate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: storageProvider.config as any,
      file: {
        buffer: processed.buffer,
        filename: fileName,
        contentType: processed.mimeType,
      },
    });

    const lockKey = getMediaHashLockKey(processed.hash);
    const lockedCreateResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const lockedExisting = await tx.media.findFirst({
        where: { hash: processed.hash },
        select: {
          id: true,
          originalName: true,
          shortHash: true,
          storageUrl: true,
          width: true,
          height: true,
          size: true,
        },
      });

      if (lockedExisting) {
        return { existing: lockedExisting, media: null };
      }

      const media = await tx.media.create({
        data: {
          fileName,
          originalName: file.name,
          mimeType: processed.mimeType,
          size: processed.size,
          shortHash: processed.shortHash,
          hash: processed.hash,
          mediaType: "IMAGE",
          width: processed.width,
          height: processed.height,
          blur: processed.blur,
          thumbnails: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          exif: (processed.exif || {}) as any,
          isOptimized: mode !== "original",
          storageUrl: uploadResult.url,
          storageProviderId: storageProvider.id,
          userUid: user.uid,
          folderId: folderId || undefined,
        },
      });

      return { existing: null, media };
    });

    if (lockedCreateResult.existing) {
      await deleteObject({
        type: storageProvider.type,
        baseUrl: storageProvider.baseUrl,
        pathTemplate: storageProvider.pathTemplate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: storageProvider.config as any,
        key: uploadResult.key,
      }).catch((error) => {
        console.error("Delete duplicate uploaded object failed:", error);
      });

      const imageId = generateSignedImageId(
        lockedCreateResult.existing.shortHash,
      );
      return response.ok({
        data: {
          id: lockedCreateResult.existing.id,
          originalName: lockedCreateResult.existing.originalName,
          shortHash: lockedCreateResult.existing.shortHash,
          imageId,
          url: `/p/${imageId}`,
          originalSize: file.size,
          processedSize: lockedCreateResult.existing.size,
          isDuplicate: true,
          width: lockedCreateResult.existing.width,
          height: lockedCreateResult.existing.height,
        },
        message: "文件已存在（已去重）",
      }) as Response;
    }

    const media = lockedCreateResult.media!;

    // 记录审计日志
    await logAuditEvent({
      user: {
        uid: String(user.uid),
        ipAddress: (await getClientIP()) || "Unknown",
        userAgent: (await getClientUserAgent()) || "Unknown",
      },
      details: {
        action: "UPLOAD_MEDIA",
        resourceType: "Media",
        resourceId: String(media.id),
        value: {
          old: null,
          new: {
            fileName: media.fileName,
            originalName: media.originalName,
            mode,
            originalSize: file.size,
            processedSize: processed.size,
          },
        },
        description: `上传图片: ${file.name} (模式: ${mode})`,
      },
    });

    const imageId = generateSignedImageId(processed.shortHash);
    return response.ok({
      data: {
        id: media.id,
        originalName: media.originalName,
        shortHash: media.shortHash,
        imageId,
        url: `/p/${imageId}`,
        originalSize: file.size,
        processedSize: processed.size,
        isDuplicate: false,
        width: media.width,
        height: media.height,
      },
      message: "上传成功",
    }) as Response;
  } catch (error) {
    console.error("Upload route error:", error);
    return response.serverError() as Response;
  }
}
