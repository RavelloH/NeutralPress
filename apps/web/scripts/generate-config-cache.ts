/**
 * 配置缓存生成脚本
 * 在生产构建前运行,将数据库中的配置缓存到文件系统中
 */

import fs from "fs";
import path from "path";
import RLog from "rlog-js";

import {
  closePrismaScriptRuntime,
  createPrismaScriptRuntime,
} from "@/../scripts/load-prisma-client";
import { isSensitiveConfigKey } from "@/data/default-configs";

const rlog = new RLog();

// 配置对象类型定义
interface ConfigItem {
  key: string;
  value: unknown;
  description?: string | null;
  updatedAt: Date;
}

async function generateConfigCache(options?: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any;
}) {
  const CACHE_FILE_PATH = path.join(
    process.cwd(),
    ".cache",
    ".config-cache.json",
  );

  try {
    rlog.log("> Generating configuration cache file...");

    // 确保 .next 目录存在
    const cacheDir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prisma: any = options?.prisma;
    const shouldManagePrismaLifecycle = !prisma;
    let runtime: Awaited<ReturnType<typeof createPrismaScriptRuntime>> | null =
      null;

    if (!prisma) {
      try {
        runtime = await createPrismaScriptRuntime();
        prisma = runtime.prisma;
      } catch (error) {
        rlog.warning(
          "Prisma client not initialized, creating empty cache file",
        );
        rlog.warning("Error details:", error);
        const result: Record<string, ConfigItem> = {};
        fs.writeFileSync(
          CACHE_FILE_PATH,
          JSON.stringify(result, null, 2),
          "utf-8",
        );
        rlog.log(`  Configuration cache generated: ${CACHE_FILE_PATH}`);
        rlog.success(`✓ Cached 0 configuration items (Prisma not ready)`);
        return;
      }
    }

    try {
      // 从数据库获取所有配置
      const configs = await prisma.config.findMany({
        orderBy: { key: "asc" },
      });

      const result: Record<string, ConfigItem> = {};

      // Credentials stored in Config (e.g. CDN tokens) are runtime-only.
      // Never copy secret.* rows into build snapshots or deployment artifacts.
      configs
        .filter((config: { key: string }) => !isSensitiveConfigKey(config.key))
        .forEach(
          (config: {
            key: string;
            value: unknown;
            description: string | null;
            updatedAt: Date;
          }) => {
            result[config.key] = {
              key: config.key,
              value: config.value,
              description: config.description,
              updatedAt: config.updatedAt,
            };
          },
        );

      // 写入缓存文件
      fs.writeFileSync(
        CACHE_FILE_PATH,
        JSON.stringify(result, null, 2),
        "utf-8",
      );

      rlog.log(`  Configuration cache generated: ${CACHE_FILE_PATH}`);
      rlog.success(
        `✓ Cached ${Object.keys(result).length} configuration items`,
      );
    } finally {
      if (shouldManagePrismaLifecycle) {
        await closePrismaScriptRuntime(runtime);
      }
    }
  } catch (error) {
    console.error("Configuration cache generation failed:", error);
    throw error;
  }
}

async function main() {
  rlog.log("Starting configuration cache generation...");

  try {
    await generateConfigCache();
    rlog.log("Configuration cache generation completed");
    process.exit(0);
  } catch (error) {
    console.error("Configuration cache generation failed:", error);
    process.exit(1);
  }
}

// 导出函数供其他脚本使用
export { generateConfigCache };

// 只有在直接运行此脚本时才执行
if (
  process.argv[1] &&
  (process.argv[1].endsWith("generate-config-cache.ts") ||
    process.argv[1].endsWith("generate-config-cache.js"))
) {
  main();
}
