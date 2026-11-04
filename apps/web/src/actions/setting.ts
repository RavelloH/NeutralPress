"use server";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetSettings,
  SettingItem,
  UpdateSettings,
} from "@repo/shared-types/api/setting";
import { UpdateSettingsSchema } from "@repo/shared-types/api/setting";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { syncCloudNow } from "@/actions/cloud";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { expireCacheTag as updateTag } from "@/lib/server/isr-invalidation";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import * as settingsreaddomainService from "@/lib/server/services/settings-read-domain";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/*
  getSettings - 获取所有配置项
*/
export async function getSettings(
  params: GetSettings,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SettingItem[] | null>>>;

export async function getSettings(
  params: GetSettings,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SettingItem[] | null>>;

export async function getSettings(
  { access_token }: GetSettings,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SettingItem[] | null>> {
  return settingsreaddomainService.getSettings({ access_token }, serverConfig);
}

import {
  extractDefaultValue,
  extractOptions,
  extractValidationRules,
  getConfigDefinition,
} from "@/data/default-configs";

/*
  updateSettings - 批量更新配置项
*/
export async function updateSettings(
  params: UpdateSettings,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;
export async function updateSettings(
  params: UpdateSettings,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;
export async function updateSettings(
  { access_token, settings }: UpdateSettings,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateSettings"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      settings,
    },
    UpdateSettingsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  // 校验配置值，并过滤出允许写入的配置项
  const sanitizedSettings: typeof settings = [];
  for (const setting of settings) {
    const configDef = getConfigDefinition(setting.key);
    if (!configDef) {
      return response.badRequest({
        message: `未知的配置项: ${setting.key}`,
        error: {
          code: "INVALID_CONFIG_KEY",
          message: `未知的配置项: ${setting.key}`,
        },
      });
    }

    const options = extractOptions(configDef);
    const validationRules = extractValidationRules(configDef);
    const newValue = extractDefaultValue(setting.value);
    const defaultValue = extractDefaultValue(configDef);

    // 1. Options 校验
    if (options && options.length > 0) {
      const isValid = options.some(
        (opt) => String(opt.value) === String(newValue),
      );
      if (!isValid) {
        return response.badRequest({
          message: `配置项 ${setting.key} 的值无效。允许的值为: ${options.map((o) => o.value).join(", ")}`,
        });
      }
    }

    // 2. 类型推断校验
    if (defaultValue !== undefined && defaultValue !== null) {
      const defaultType = typeof defaultValue;

      if (Array.isArray(defaultValue)) {
        if (!Array.isArray(newValue)) {
          return response.badRequest({
            message: `配置项 ${setting.key} 格式错误。应为数组。`,
          });
        }
        // 简单校验数组元素类型（假设数组元素类型一致且非空数组能推断）
        if (defaultValue.length > 0) {
          const itemType = typeof defaultValue[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const invalidItem = (newValue as any[]).find(
            (item) => typeof item !== itemType,
          );
          if (invalidItem !== undefined) {
            return response.badRequest({
              message: `配置项 ${setting.key} 数组元素类型错误。应为 ${itemType}。`,
            });
          }
        }
      } else if (defaultType === "object") {
        // 普通对象
        if (
          typeof newValue !== "object" ||
          newValue === null ||
          Array.isArray(newValue)
        ) {
          return response.badRequest({
            message: `配置项 ${setting.key} 格式错误。应为对象。`,
          });
        }
      } else {
        // 基本类型：string, number, boolean
        if (typeof newValue !== defaultType) {
          return response.badRequest({
            message: `配置项 ${setting.key} 类型错误。应为 ${defaultType}，实际为 ${typeof newValue}。`,
          });
        }
      }
    }

    if (
      validationRules &&
      (validationRules.integer ||
        validationRules.min !== undefined ||
        validationRules.max !== undefined)
    ) {
      if (typeof newValue !== "number" || !Number.isFinite(newValue)) {
        return response.badRequest({
          message: `配置项 ${setting.key} 必须是有效数字。`,
        });
      }

      if (validationRules.integer && !Number.isInteger(newValue)) {
        return response.badRequest({
          message: `配置项 ${setting.key} 必须是整数。`,
        });
      }

      if (validationRules.min !== undefined && newValue < validationRules.min) {
        return response.badRequest({
          message: `配置项 ${setting.key} 不能小于 ${validationRules.min}。`,
        });
      }

      if (validationRules.max !== undefined && newValue > validationRules.max) {
        return response.badRequest({
          message: `配置项 ${setting.key} 不能大于 ${validationRules.max}。`,
        });
      }
    }

    sanitizedSettings.push(setting);
  }

  try {
    // 查询所有要更新的配置项的旧值
    const keys = sanitizedSettings.map((s) => s.key);
    const oldConfigs = await prisma.config.findMany({
      where: {
        key: {
          in: keys,
        },
      },
    });

    // 构建旧值映射
    const oldValuesMap = new Map(
      oldConfigs.map((config) => [config.key, config.value]),
    );
    const siteUrlSetting = sanitizedSettings.find((s) => s.key === "site.url");
    const shouldSyncCloudAfterUpdate =
      siteUrlSetting !== undefined &&
      extractDefaultValue(oldValuesMap.get("site.url")) !==
        extractDefaultValue(siteUrlSetting.value);

    // 使用事务批量更新配置项
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const setting of sanitizedSettings) {
        const result = await tx.config.upsert({
          where: { key: setting.key },
          update: { value: setting.value as Prisma.InputJsonValue },
          create: {
            key: setting.key,
            value: setting.value as Prisma.InputJsonValue,
          },
        });

        if (result) {
          updated++;
        }
      }
    });

    // 记录审计日志
    if (updated > 0) {
      // 构建旧值和新值记录
      const oldData: Record<string, unknown> = {
        settings: sanitizedSettings.map((s) => ({
          key: s.key,
          oldValue: oldValuesMap.get(s.key) || null,
        })),
      };

      const newData: Record<string, unknown> = {
        settings: sanitizedSettings.map((s) => ({
          key: s.key,
          newValue: s.value,
        })),
      };

      const { after } = await import("next/server");
      after(async () => {
        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "BULK_UPDATE",
            resourceType: "CONFIG",
            resourceId: keys.join(","),
            value: {
              old: oldData,
              new: newData,
            },
            description: `批量更新 ${updated} 个配置项：${keys.join(", ")}`,
          },
        });
      });
    }

    // 刷新缓存标签
    updateTag("config");
    for (const setting of sanitizedSettings) {
      updateTag(`config/${setting.key}`);
    }
    // RootLayout 同时依赖 config 和 menus，配置变更后同步刷新菜单缓存，避免目录短暂丢失
    updateTag("menus");

    if (shouldSyncCloudAfterUpdate && updated > 0) {
      try {
        const syncResult = await syncCloudNow({ access_token });
        if (!syncResult.success || !syncResult.data?.synced) {
          console.warn(
            "[updateSettings] site.url 已更新，但自动同步云端失败:",
            syncResult.message || syncResult.data?.message || "未知错误",
          );
        }
      } catch (syncError) {
        console.error(
          "[updateSettings] site.url 已更新，但自动同步云端异常:",
          syncError,
        );
      }
    }

    return response.ok({
      data: { updated },
    });
  } catch (error) {
    console.error("Update settings error:", error);
    return response.serverError();
  }
}
