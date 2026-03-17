import fs from "node:fs";
import { createRequire } from "node:module";
import { cpus as osCpus, totalmem as osTotalMem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

const webRootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(webRootDir, "..", "..");
const moduleResolver = createRequire(import.meta.url);

function getEnvFiles(nodeEnv) {
  const files = [`.env.${nodeEnv}.local`];
  if (nodeEnv !== "test") {
    files.push(".env.local");
  }
  files.push(`.env.${nodeEnv}`, ".env");
  return files;
}

function loadEnvFromDirectory(dir, envFiles) {
  for (const envFile of envFiles) {
    const envPath = path.join(dir, envFile);
    if (!fs.existsSync(envPath)) {
      continue;
    }
    loadDotenv({
      path: envPath,
      quiet: true,
    });
  }
}

function getOptimalCpus() {
  let memBytes = osTotalMem();

  // 尝试读取 Linux 容器 (cgroup) 的真实内存限制，防止在 EdgeOne/Docker 中读取到宿主机假内存
  try {
    if (fs.existsSync("/sys/fs/cgroup/memory.max")) {
      // Cgroup v2
      const max = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
      if (max !== "max") memBytes = Math.min(memBytes, parseInt(max, 10));
    } else if (fs.existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")) {
      // Cgroup v1
      const limit = fs
        .readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8")
        .trim();
      const limitInt = parseInt(limit, 10);
      // 忽略没有设置限制时的极大值
      if (limitInt > 0 && limitInt < 100 * 1024 * 1024 * 1024) {
        memBytes = Math.min(memBytes, limitInt);
      }
    }
  } catch {
    // 读取失败则静默回退到 osTotalMem
  }

  const totalMemGB = memBytes / (1024 * 1024 * 1024);
  const logicalCores = osCpus().length;

  // 核心算法：为系统基础运行保留 1GB，剩下的内存按每核 1.5GB 分配给 Next.js Worker
  let safeCores = Math.floor((totalMemGB - 1) / 1);

  // 保证至少有 1 个核心工作，且不超过机器的物理/逻辑核心总数
  return Math.max(1, Math.min(safeCores, logicalCores));
}

// 提前计算好安全核心数
const SAFE_CPUS = getOptimalCpus();

function loadMonorepoEnv() {
  const nodeEnv = globalThis.process.env.NODE_ENV ?? "development";
  const envFiles = getEnvFiles(nodeEnv);

  // app 内配置优先，根目录作为兜底
  loadEnvFromDirectory(webRootDir, envFiles);
  loadEnvFromDirectory(repoRootDir, envFiles);
}

loadMonorepoEnv();

function toPosixPath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function resolvePackageJsonPath(packageName) {
  for (const searchRoot of [webRootDir, repoRootDir]) {
    try {
      return moduleResolver.resolve(`${packageName}/package.json`, {
        paths: [searchRoot],
      });
    } catch {
      // noop
    }
  }

  return null;
}

function resolvePackageJsonPathFrom(packageName, basedir) {
  try {
    return moduleResolver.resolve(`${packageName}/package.json`, {
      paths: [basedir],
    });
  } catch {
    return resolvePackageJsonPath(packageName);
  }
}

function collectRuntimePackageIncludes(entryPackageNames) {
  const visitedPackageJsonPaths = new Set();
  const pendingPackageJsonPaths = entryPackageNames
    .map((packageName) => resolvePackageJsonPath(packageName))
    .filter((item) => Boolean(item));
  const includeGlobs = new Set();

  while (pendingPackageJsonPaths.length > 0) {
    const packageJsonPath = pendingPackageJsonPaths.shift();
    if (!packageJsonPath || visitedPackageJsonPaths.has(packageJsonPath)) {
      continue;
    }

    visitedPackageJsonPaths.add(packageJsonPath);

    const packageDir = path.dirname(packageJsonPath);
    const relativeDir = path.relative(repoRootDir, packageDir);
    if (!relativeDir.startsWith("..")) {
      includeGlobs.add(`./${toPosixPath(relativeDir)}/**/*`);
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const dependencyNames = Object.keys({
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.optionalDependencies ?? {}),
      });
      for (const dependencyName of dependencyNames) {
        const dependencyPackageJsonPath = resolvePackageJsonPathFrom(
          dependencyName,
          packageDir,
        );
        if (dependencyPackageJsonPath) {
          pendingPackageJsonPaths.push(dependencyPackageJsonPath);
        }
      }
    } catch {
      // noop
    }
  }

  return [...includeGlobs];
}

/** @type {import('next').NextConfig} */
const nextConfig = () => {
  const isStandaloneBuild = ["1", "true"].includes(
    String(globalThis.process.env.BUILD_STANDALONE ?? "").toLowerCase(),
  );
  const shouldUseAggressivePrismaTracing = isStandaloneBuild;

  const prismaRequiredPackages = [
    "prisma",
    "@prisma/client",
    "@prisma/adapter-pg",
  ];

  const baseTracingIncludes = [
    "./apps/web/node_modules/.prisma/client/**/*",
    "./node_modules/.prisma/client/**/*",
    "./src/lib/server/lua-scripts/**/*.lua",
    "./node_modules/node-ip2region/data/ip2region.db",
  ];

  const standalonePrismaTracingIncludes = shouldUseAggressivePrismaTracing
    ? Array.from(
        new Set([
          "./apps/web/node_modules/prisma/**/*",
          "./apps/web/node_modules/@prisma/**/*",
          "./node_modules/prisma/**/*",
          "./node_modules/@prisma/**/*",
          "./node_modules/.pnpm/prisma@*/node_modules/**/*",
          "./node_modules/.pnpm/@prisma+*@*/node_modules/**/*",
          ...collectRuntimePackageIncludes(prismaRequiredPackages),
        ]),
      )
    : [];

  const tracingIncludes = Array.from(
    new Set([...baseTracingIncludes, ...standalonePrismaTracingIncludes]),
  );

  const serverExternalPackages = [
    "ably",
    "akismet-api",
    "@node-rs/jieba",
    ...(isStandaloneBuild ? prismaRequiredPackages : []),
  ];

  const tracingExcludes = [
    "**/@esbuild/linux-x64/**",
    "**/@esbuild/linux-arm64/**",
    "node_modules/typescript/**/*",
    "node_modules/eslint/**/*",
    "node_modules/@types/**/*",
    "node_modules/webpack/**/*",
    "node_modules/terser/**/*",
    "node_modules/esbuild/**/*",
    "node_modules/@esbuild/**/*",
    "node_modules/postcss/**/*",
    "**/*.map",
    "**/*.d.ts",
    "./.cache/**/*",
  ];

  return {
    images: {
      localPatterns: [
        {
          pathname: "/p/**",
          search: "",
        },
      ],
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2560],
      imageSizes: [32, 48, 64, 96, 128, 256, 384],
      qualities: [75],
      formats: ["image/avif", "image/webp"],
      minimumCacheTTL: 2678400,
      dangerouslyAllowSVG: true,
      contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    },
    typescript: {
      ignoreBuildErrors: true,
    },

    output: globalThis.process.env.BUILD_STANDALONE ? "standalone" : undefined,
    outputFileTracingRoot: repoRootDir,
    serverExternalPackages,
    cacheComponents: true,
    reactCompiler: true,
    outputFileTracingIncludes: {
      "/api/**/*": tracingIncludes,
      "/internal/runtime/init": tracingIncludes,
      "/internal/cache/bootstrap": tracingIncludes,
      "/(build-in)/internal/runtime/init/route": tracingIncludes,
      "/(build-in)/internal/cache/bootstrap/route": tracingIncludes,
      "/**/*": tracingIncludes,
    },
    experimental: {
      cpus: SAFE_CPUS,
      serverActions: {
        bodySizeLimit: "4mb",
      },
    },
    allowedDevOrigins: ["198.18.0.1"],
    outputFileTracingExcludes: {
      "*": tracingExcludes,
    },
    async rewrites() {
      return [
        {
          source: "/favicon.ico",
          destination: "/icon/48x",
        },
      ];
    },
    async redirects() {
      return [
        {
          source: "/.well-known/change-password",
          destination: "/settings#security",
          permanent: false,
        },
      ];
    },
    // 配置缓存头
    async headers() {
      const securityHeaders = [
        {
          key: "X-Frame-Options",
          value: "SAMEORIGIN",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ];

      return [
        {
          // 对所有页面应用安全头
          source: "/:path*",
          headers: securityHeaders,
        },
        {
          source: "/favicon.ico",
          headers: [
            {
              key: "Content-Type",
              value: "image/x-icon",
            },
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
        {
          // 为图标设置强缓存
          source: "/icon/:size*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
        {
          // 社交分享图
          source: "/social-image/:path*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, s-maxage=31536000, immutable",
            },
          ],
        },
      ];
    },
  };
};

export default nextConfig;
