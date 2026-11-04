import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetSystemInfo,
  GetSystemInfoSuccessResponse,
} from "@repo/shared-types/api/system";
import { GetSystemInfoSchema } from "@repo/shared-types/api/system";
import { exec } from "child_process";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import os from "os";
import { performance } from "perf_hooks";
import { promisify } from "util";

import { authVerify } from "@/lib/server/auth-verify";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

const execAsync = promisify(exec);

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

// 存储上一次的 CPU 时间，用于计算 CPU 使用率
let lastCpuTimes: {
  user: number;
  nice: number;
  sys: number;
  idle: number;
} | null = null;
let lastCpuTimestamp: number = 0;

// 计算 CPU 使用率
function getCpuUsage(): {
  user: number;
  system: number;
  idle: number;
  total: number;
} | null {
  try {
    const cpus = os.cpus();
    let user = 0;
    let nice = 0;
    let sys = 0;
    let idle = 0;

    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
    }

    const currentTimes = { user, nice, sys, idle };
    const currentTimestamp = Date.now();

    if (lastCpuTimes && currentTimestamp - lastCpuTimestamp < 60000) {
      // 计算增量
      const userDiff = user - lastCpuTimes.user;
      const niceDiff = nice - lastCpuTimes.nice;
      const sysDiff = sys - lastCpuTimes.sys;
      const idleDiff = idle - lastCpuTimes.idle;
      const total = userDiff + niceDiff + sysDiff + idleDiff;

      if (total > 0) {
        lastCpuTimes = currentTimes;
        lastCpuTimestamp = currentTimestamp;

        return {
          user: Math.round(((userDiff + niceDiff) / total) * 100 * 100) / 100,
          system: Math.round((sysDiff / total) * 100 * 100) / 100,
          idle: Math.round((idleDiff / total) * 100 * 100) / 100,
          total:
            Math.round(((userDiff + niceDiff + sysDiff) / total) * 100 * 100) /
            100,
        };
      }
    }

    // 首次调用或间隔太长，更新基准值
    lastCpuTimes = currentTimes;
    lastCpuTimestamp = currentTimestamp;
    return null;
  } catch {
    return null;
  }
}

// 测量事件循环延迟
async function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const end = process.hrtime.bigint();
      const lagNs = Number(end - start);
      const lagMs = lagNs / 1_000_000;
      resolve(Math.round(lagMs * 100) / 100);
    });
  });
}

// 获取事件循环利用率（Node.js 14.10+）
function getEventLoopUtilization(): {
  idle: number;
  active: number;
  utilization: number;
} | null {
  try {
    if (typeof performance.eventLoopUtilization === "function") {
      const elu = performance.eventLoopUtilization();
      return {
        idle: Math.round(elu.idle * 100) / 100,
        active: Math.round(elu.active * 100) / 100,
        utilization: Math.round(elu.utilization * 10000) / 10000, // 保留4位小数
      };
    }
    return null;
  } catch {
    return null;
  }
}

// 获取资源使用情况
function getResourceUsage(): {
  userCPUTime: number;
  systemCPUTime: number;
  maxRSS: number;
  fsRead: number;
  fsWrite: number;
  voluntaryContextSwitches: number;
  involuntaryContextSwitches: number;
} | null {
  try {
    // process.resourceUsage() 在 Node.js 12.6.0+ 可用
    if (typeof process.resourceUsage === "function") {
      const usage = process.resourceUsage();
      return {
        userCPUTime: usage.userCPUTime,
        systemCPUTime: usage.systemCPUTime,
        maxRSS: usage.maxRSS,
        fsRead: usage.fsRead,
        fsWrite: usage.fsWrite,
        voluntaryContextSwitches: usage.voluntaryContextSwitches,
        involuntaryContextSwitches: usage.involuntaryContextSwitches,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// 获取磁盘信息
async function getDiskInfo(): Promise<{
  total: number;
  free: number;
  used: number;
  usagePercent: number;
} | null> {
  try {
    const platform = os.platform();

    if (platform === "win32") {
      // Windows 使用 wmic 命令
      const { stdout } = await execAsync(
        "wmic logicaldisk where drivetype=3 get size,freespace /format:csv",
      );
      const lines = stdout.trim().split("\n").filter(Boolean);
      // 跳过标题行
      let totalSize = 0;
      let totalFree = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i]?.trim().split(",");
        if (parts && parts.length >= 3) {
          const free = parseInt(parts[1] || "0", 10);
          const size = parseInt(parts[2] || "0", 10);
          if (!isNaN(free) && !isNaN(size)) {
            totalFree += free;
            totalSize += size;
          }
        }
      }

      if (totalSize > 0) {
        const used = totalSize - totalFree;
        return {
          total: totalSize,
          free: totalFree,
          used,
          usagePercent: Math.round((used / totalSize) * 100 * 100) / 100,
        };
      }
    } else {
      // Unix/Linux/macOS 使用 df 命令
      const { stdout } = await execAsync("df -k / | tail -1");
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        const total = parseInt(parts[1] || "0", 10) * 1024;
        const used = parseInt(parts[2] || "0", 10) * 1024;
        const free = parseInt(parts[3] || "0", 10) * 1024;

        return {
          total,
          free,
          used,
          usagePercent: Math.round((used / total) * 100 * 100) / 100,
        };
      }
    }

    return null;
  } catch {
    // 磁盘信息获取失败时返回 null
    return null;
  }
}

// 获取网络接口信息
function getNetworkInfo(): Array<{
  name: string;
  address: string;
  netmask: string;
  family: string;
  mac: string;
}> {
  const interfaces = os.networkInterfaces();
  const result: Array<{
    name: string;
    address: string;
    netmask: string;
    family: string;
    mac: string;
  }> = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    if (nets) {
      for (const net of nets) {
        // 跳过内部回环地址
        if (!net.internal) {
          result.push({
            name,
            address: net.address,
            netmask: net.netmask,
            family: net.family,
            mac: net.mac,
          });
        }
      }
    }
  }

  return result;
}

export async function getSystemInfo(
  params: GetSystemInfo,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetSystemInfoSuccessResponse["data"]>>>;
export async function getSystemInfo(
  params: GetSystemInfo,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetSystemInfoSuccessResponse["data"]>>;
export async function getSystemInfo(
  { access_token }: GetSystemInfo,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetSystemInfoSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getSystemInfo"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData({ access_token }, GetSystemInfoSchema);

  if (validationError) return response.badRequest(validationError);

  // 身份验证 - 仅 ADMIN 可用
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const now = new Date();

    // 并行获取各项系统信息
    const [
      diskInfo,
      cpus,
      loadAvg,
      totalMem,
      freeMem,
      memoryUsage,
      eventLoopLag,
    ] = await Promise.all([
      getDiskInfo(),
      Promise.resolve(os.cpus()),
      Promise.resolve(os.loadavg()),
      Promise.resolve(os.totalmem()),
      Promise.resolve(os.freemem()),
      Promise.resolve(process.memoryUsage()),
      measureEventLoopLag(),
    ]);

    const usedMem = totalMem - freeMem;
    const cpuInfo = cpus[0];

    // 获取 CPU 使用率
    const cpuUsage = getCpuUsage();

    // 获取进程 CPU 使用情况
    const processCpuUsage = process.cpuUsage();

    // 获取资源使用情况
    const resourceUsage = getResourceUsage();

    // 获取事件循环利用率
    const eventLoopUtilization = getEventLoopUtilization();

    // 获取活跃句柄数
    // @ts-expect-error - _getActiveHandles 是内部 API
    const activeHandles = process._getActiveHandles?.()?.length ?? 0;

    const systemInfo = {
      os: {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: Math.round((usedMem / totalMem) * 100 * 100) / 100,
      },
      cpu: {
        model: cpuInfo?.model || "Unknown",
        cores: cpus.length,
        speed: cpuInfo?.speed || 0,
        loadAvg,
        usage: cpuUsage || undefined,
      },
      process: {
        nodeVersion: process.version,
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers,
        },
        cpuUsage: {
          user: processCpuUsage.user,
          system: processCpuUsage.system,
        },
        resourceUsage: resourceUsage || undefined,
        eventLoopLag,
        eventLoopUtilization: eventLoopUtilization || undefined,
        activeHandles,
      },
      disk: diskInfo || undefined,
      network: getNetworkInfo(),
      env: {
        nodeEnv: process.env.NODE_ENV,
      },
      time: {
        serverTime: now.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: now.getTimezoneOffset(),
      },
      collectedAt: now.toISOString(),
    };

    return response.ok({ data: systemInfo });
  } catch (error) {
    console.error("获取系统信息失败:", error);
    return response.serverError({ message: "获取系统信息失败" });
  }
}
