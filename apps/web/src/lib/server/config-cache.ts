import "server-only";

import fs from "fs";
import { unstable_cache } from "next/cache";
import path from "path";

import type {
  CONFIG_DEFINITIONS,
  ConfigKeys,
  ConfigType,
} from "@/data/default-configs";
import { defaultConfigMap } from "@/data/default-configs";

// 配置对象类型定义
export interface ConfigItem {
  key: string;
  value: unknown;
  description?: string | null;
  updatedAt: Date;
}

// 配置值对象类型
interface ConfigValueObject {
  default?: unknown;
  [key: string]: unknown;
}

// 缓存文件路径
const CACHE_FILE_PATH = path.join(
  process.cwd(),
  ".cache",
  ".config-cache.json",
);

/**
 * 获取原始配置项
 * - 如果缓存文件存在，从缓存文件读取（构建阶段）
 * - 否则使用 unstable_cache 从数据库读取（开发/生产环境）
 */
export async function getRawConfig(key: string): Promise<ConfigItem | null> {
  // 检查是否为敏感配置
  if (key.startsWith("secret.")) {
    throw Error("无法获取敏感配置项");
  }

  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async (k: string) => {
        return await getConfigFromDatabase(k);
      },
      [`raw-config-${key}`],
      {
        tags: ["config", `config/${key}`],
        revalidate: false,
      },
    );
    return await getCachedData(key);
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const config = getConfigFromCache(key);
    if (config) {
      return config;
    }
  }

  // 缓存文件不存在或未找到配置，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async (k: string) => {
      return await getConfigFromDatabase(k);
    },
    [`raw-config-${key}`],
    {
      tags: ["config", `config/${key}`],
      revalidate: false,
    },
  );

  return await getCachedData(key);
}

/**
 * 获取配置值的辅助函数
 */
async function getConfigValue(key: string, field?: string): Promise<unknown> {
  const config = await getRawConfig(key);

  // 优先使用数据库或缓存中的值
  let configValue = config?.value;

  // 如果数据库中不存在该配置，则回退到代码定义的默认配置
  if (configValue === undefined || configValue === null) {
    configValue = defaultConfigMap.get(key);
  }

  // 如果最终仍然没有找到值，返回 undefined
  if (configValue === undefined || configValue === null) {
    return undefined;
  }

  // 如果指定了字段名且配置值是对象,尝试获取指定字段
  if (field && typeof configValue === "object" && configValue !== null) {
    return (configValue as ConfigValueObject)[field];
  }

  // 如果没有指定字段,但配置值是对象且有default属性,返回default值
  if (
    !field &&
    typeof configValue === "object" &&
    configValue !== null &&
    "default" in configValue
  ) {
    return (configValue as ConfigValueObject).default;
  }

  // 如果配置值是对象,返回整个对象
  if (typeof configValue === "object" && configValue !== null) {
    return configValue;
  }

  // 返回配置值本身
  return configValue;
}

/**
 * 获取配置项
 * @param key 配置键名
 * @param field 可选的字段名,用于从对象配置中获取特定字段
 * @returns 配置值
 */
export async function getConfig<K extends ConfigKeys>(
  key: K,
): Promise<ConfigType<K>>;
export async function getConfig<
  K extends ConfigKeys,
  F extends keyof Omit<(typeof CONFIG_DEFINITIONS)[K], "description">,
>(key: K, field: F): Promise<(typeof CONFIG_DEFINITIONS)[K][F]>;
export async function getConfig<K extends ConfigKeys>(
  key: K,
  field?: string,
): Promise<
  | ConfigType<K>
  | (typeof CONFIG_DEFINITIONS)[K][keyof (typeof CONFIG_DEFINITIONS)[K]]
  | unknown
> {
  // 执行缓存函数
  const getCachedData = unstable_cache(
    async (k: string, f?: string) => {
      return await getConfigValue(k, f);
    },
    [`config-${key}-${field ?? "default"}`],
    {
      tags: ["config", `config/${key}`],
      revalidate: false,
    },
  );

  return await getCachedData(key, field);
}

/**
 * 批量获取配置项
 * @param keys 配置键名数组
 * @returns 配置值数组（保持元组类型）
 *
 * @example
 * const [title, url] = await getConfigs(["site.title", "site.url"]);
 * // title: string, url: string
 */
export async function getConfigs<T extends ConfigKeys[]>(
  keys: [...T],
): Promise<{ [K in keyof T]: ConfigType<T[K] & ConfigKeys> }> {
  const results = await Promise.all(keys.map((key) => getConfig(key)));
  return results as unknown as {
    [K in keyof T]: ConfigType<T[K] & ConfigKeys>;
  };
}

/**
 * 从数据库获取配置
 */
async function getConfigFromDatabase(key: string): Promise<ConfigItem | null> {
  try {
    const { default: prisma } = await import("./prisma");
    const config = await prisma.config.findUnique({
      where: { key },
    });

    if (!config) {
      return null;
    }

    return {
      key: config.key,
      value: config.value,
      description: undefined, // 移除描述字段
      updatedAt: config.updatedAt,
    };
  } catch (error) {
    console.error("从数据库获取配置失败:", error);
    return null;
  }
}

/**
 * 从缓存文件获取配置
 */
function getConfigFromCache(key: string): ConfigItem | null {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return null;
    }

    const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
    const configs: Record<string, ConfigItem> = JSON.parse(cacheData);

    const config = configs[key];
    if (!config) {
      return null;
    }

    // 确保 updatedAt 是 Date 对象并移除描述字段
    return {
      ...config,
      description: undefined, // 移除描述字段
      updatedAt: new Date(config.updatedAt),
    };
  } catch (error) {
    console.error("从缓存文件读取配置失败:", error);
    return null;
  }
}

/**
 * 获取所有配置项（主要用于客户端）
 * 过滤掉 secret 开头的敏感配置项和 description 字段
 */
export async function getAllConfigs(): Promise<Record<string, ConfigItem>> {
  // 开发环境：跳过文件缓存，直接从数据库读取
  if (process.env.NODE_ENV !== "production") {
    const getCachedData = unstable_cache(
      async () => {
        const allConfigs = await getAllConfigsFromDatabase();
        return filterSensitiveConfigs(allConfigs);
      },
      ["all-configs"],
      {
        tags: ["config"],
        revalidate: false,
      },
    );
    return await getCachedData();
  }

  // 生产环境：如果缓存文件存在，从缓存读取（构建阶段）
  if (
    process.env.NEUTRALPRESS_BUILD_CACHE_SNAPSHOT === "1" &&
    fs.existsSync(CACHE_FILE_PATH)
  ) {
    const allConfigs = getAllConfigsFromCache();
    if (Object.keys(allConfigs).length > 0) {
      return filterSensitiveConfigs(allConfigs);
    }
  }

  // 缓存文件不存在或为空，使用 unstable_cache 从数据库读取
  const getCachedData = unstable_cache(
    async () => {
      const allConfigs = await getAllConfigsFromDatabase();
      return filterSensitiveConfigs(allConfigs);
    },
    ["all-configs"],
    {
      tags: ["config"],
      revalidate: false,
    },
  );

  return await getCachedData();
}

/**
 * 过滤敏感配置项
 * 移除 secret 开头的配置项和所有配置的 description 字段
 */
function filterSensitiveConfigs(
  configs: Record<string, ConfigItem>,
): Record<string, ConfigItem> {
  const filteredConfigs: Record<string, ConfigItem> = {};

  Object.entries(configs).forEach(([key, config]) => {
    // 跳过 secret 开头的敏感配置
    if (key.startsWith("secret.")) {
      return;
    }

    // 移除 description 字段
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { description, ...safeConfig } = config;

    filteredConfigs[key] = {
      ...safeConfig,
      description: undefined,
    };
  });

  return filteredConfigs;
}

/**
 * 从数据库获取所有配置
 */
async function getAllConfigsFromDatabase(): Promise<
  Record<string, ConfigItem>
> {
  try {
    const { default: prisma } = await import("./prisma");
    const configs = await prisma.config.findMany({
      orderBy: { key: "asc" },
    });

    const result: Record<string, ConfigItem> = {};

    configs.forEach(
      (config: { key: string; value: unknown; updatedAt: Date }) => {
        result[config.key] = {
          key: config.key,
          value: config.value,
          updatedAt: config.updatedAt,
        };
      },
    );

    return result;
  } catch (error) {
    console.error("从数据库获取所有配置失败:", error);
    return {};
  }
}

/**
 * 从缓存文件获取所有配置
 */
function getAllConfigsFromCache(): Record<string, ConfigItem> {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return {};
    }

    const cacheData = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
    const configs: Record<string, ConfigItem> = JSON.parse(cacheData);

    // 确保所有 updatedAt 都是 Date 对象
    const result: Record<string, ConfigItem> = {};

    Object.entries(configs).forEach(([key, config]) => {
      result[key] = {
        ...config,
        updatedAt: new Date(config.updatedAt),
      };
    });

    return result;
  } catch (error) {
    console.error("从缓存文件读取所有配置失败:", error);
    return {};
  }
}
