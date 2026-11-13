import "server-only";

import dns from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import { isPrivateIP } from "@/lib/server/ip-utils";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type LookupSingleCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

type LookupAllCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: ResolvedAddress[],
) => void;

function isReservedIpv4(ip: string): boolean {
  if (isPrivateIP(ip)) return true;

  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;

  // 保留网段与本地链路网段
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24
  if (a === 192 && b === 88 && parts[2] === 99) return true; // 192.88.99.0/24
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 组播与保留

  return false;
}

function parseIpv6Address(ip: string): bigint | null {
  if (net.isIP(ip) !== 6) return null;

  const expandPart = (part: string): string[] => {
    if (!part) return [];
    const groups = part.split(":");
    const last = groups.at(-1);
    if (last?.includes(".")) {
      if (net.isIP(last) !== 4) return [];
      const octets = last.split(".").map(Number);
      const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
      const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
      groups.splice(-1, 1, high.toString(16), low.toString(16));
    }
    return groups;
  };

  const separator = ip.indexOf("::");
  let groups: string[];
  if (separator >= 0) {
    const left = expandPart(ip.slice(0, separator));
    const right = expandPart(ip.slice(separator + 2));
    const zeroCount = 8 - left.length - right.length;
    if (zeroCount < 1) return null;
    groups = [...left, ...Array(zeroCount).fill("0"), ...right];
  } else {
    groups = expandPart(ip);
  }

  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))
  ) {
    return null;
  }

  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

function isReservedIpv6(ip: string): boolean {
  const address = parseIpv6Address(ip);
  if (address === null) return true;

  // IPv4 映射地址按完整 IPv4 规则校验，不受地址文本写法影响。
  if (address >> 32n === 0xffffn) {
    const mapped = Number(address & 0xffffffffn);
    const mappedIpv4 = [
      (mapped >>> 24) & 0xff,
      (mapped >>> 16) & 0xff,
      (mapped >>> 8) & 0xff,
      mapped & 0xff,
    ].join(".");
    return isReservedIpv4(mappedIpv4);
  }

  // 出站请求只需要全球单播地址；同时排除未指定、回环、ULA、完整 fe80::/10 链路本地范围及组播。
  if (address >> 125n !== 0b001n) return true;

  // 排除 2000::/3 内的特殊用途和过渡地址范围。
  if (address >> 112n === 0x2002n) return true; // 2002::/16 (6to4)
  if (address >> 96n === 0x20010db8n) return true; // 2001:db8::/32
  if (address >> 105n === 0x100080n) return true; // 2001::/23 (special purpose)

  return false;
}

function isReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isReservedIpv4(ip);
  if (family === 6) return isReservedIpv6(ip);
  return true;
}

function parseContentLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function toHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

function normalizeResolvedFamily(address: string): 4 | 6 {
  const family = net.isIP(address);
  if (family === 4 || family === 6) {
    return family;
  }
  throw new Error("解析到的地址不是有效 IP");
}

function isLookupAllOptions(options: unknown): options is { all: true } {
  if (typeof options !== "object" || options === null) {
    return false;
  }

  return "all" in options && options.all === true;
}

async function requestWithPinnedDns(params: {
  url: URL;
  resolvedIp: string;
  signal: AbortSignal;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes: number;
}): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const {
    url,
    resolvedIp,
    signal,
    method = "GET",
    headers,
    timeoutMs = 10000,
    maxBytes,
  } = params;
  const family = normalizeResolvedFamily(resolvedIp);
  const requestImpl = url.protocol === "https:" ? https.request : http.request;
  const requestHostname = url.hostname.replace(/^\[|\]$/g, "");

  if (signal.aborted) {
    throw new Error("请求超时");
  }

  return new Promise((resolve, reject) => {
    const req = requestImpl(
      {
        protocol: url.protocol,
        hostname: requestHostname,
        port: url.port ? Number.parseInt(url.port, 10) : undefined,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        signal,
        servername:
          net.isIP(requestHostname) === 0 ? requestHostname : undefined,
        lookup: (
          _hostname: string,
          options: unknown,
          callback?: LookupSingleCallback | LookupAllCallback,
        ) => {
          if (!callback) return;

          if (isLookupAllOptions(options)) {
            (callback as LookupAllCallback)(null, [
              {
                address: resolvedIp,
                family,
              },
            ]);
            return;
          }

          (callback as LookupSingleCallback)(null, resolvedIp, family);
        },
      },
      (res) => {
        res.on("aborted", () => {
          reject(new Error("响应中断"));
        });
        res.on("error", reject);

        const status = res.statusCode ?? 0;
        const responseHeaders = toHeaders(res.headers);
        const declaredSize = parseContentLength(responseHeaders);
        if (declaredSize !== null && declaredSize > maxBytes) {
          req.destroy(new Error("文件大小超出限制"));
          reject(new Error("文件大小超出限制"));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        res.on("data", (chunk: Buffer | string) => {
          const piece =
            typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
          total += piece.byteLength;
          if (total > maxBytes) {
            req.destroy(new Error("文件大小超出限制"));
            reject(new Error("文件大小超出限制"));
            return;
          }
          chunks.push(piece);
        });

        res.on("end", () => {
          resolve({
            status,
            headers: responseHeaders,
            body: Buffer.concat(chunks, total),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("请求超时"));
    });
    req.on("error", (error) => {
      reject(error);
    });
    req.end();
  });
}

export interface FetchPublicHttpUrlBufferOptions {
  requireHttps?: boolean;
  timeoutMs?: number;
  maxBytes: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  validateUrl?: (url: URL) => void | Promise<void>;
}

export interface FetchPublicHttpUrlBufferResult {
  status: number;
  headers: Headers;
  body: Buffer;
  finalUrl: string;
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  options: { requireHttps?: boolean } = {},
): Promise<{ url: URL; resolvedIp: string }> {
  const url: URL = new URL(rawUrl);
  const protocol = url.protocol.toLowerCase();
  const { requireHttps = false } = options;

  if (requireHttps) {
    if (protocol !== "https:") {
      throw new Error("仅支持 HTTPS 地址");
    }
  } else if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("仅支持 HTTP/HTTPS 地址");
  }

  if (url.username || url.password) {
    throw new Error("URL 不允许包含账号信息");
  }

  const hostname = url.hostname.trim().toLowerCase();
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (!normalizedHostname) {
    throw new Error("URL 缺少主机名");
  }

  if (BLOCKED_HOSTNAMES.has(normalizedHostname)) {
    throw new Error("不允许访问本地地址");
  }

  const ipFamily = net.isIP(normalizedHostname);
  if (ipFamily > 0) {
    if (isReservedIp(normalizedHostname)) {
      throw new Error("不允许访问内网或保留地址");
    }
    return { url, resolvedIp: normalizedHostname };
  }

  const records = await dns.lookup(normalizedHostname, {
    all: true,
    verbatim: true,
  });
  if (!records.length) {
    throw new Error("无法解析目标地址");
  }

  const normalizedRecords = records
    .map((record) => {
      const address = record.address?.trim();
      const family = net.isIP(address);
      if (!address || (family !== 4 && family !== 6)) {
        return null;
      }

      return {
        address,
        family,
      } as ResolvedAddress;
    })
    .filter((record): record is ResolvedAddress => record !== null);

  if (!normalizedRecords.length) {
    throw new Error("无法解析目标地址");
  }

  if (normalizedRecords.some((record) => isReservedIp(record.address))) {
    throw new Error("目标地址解析到内网或保留地址");
  }

  // 返回第一个解析到的 IP 地址，供调用方直接使用以防止 DNS 重绑定
  const firstResolvedRecord = normalizedRecords[0];
  if (!firstResolvedRecord) {
    throw new Error("无法解析目标地址");
  }

  return { url, resolvedIp: firstResolvedRecord.address };
}

export async function fetchPublicHttpUrlBuffer(
  rawUrl: string,
  options: FetchPublicHttpUrlBufferOptions,
): Promise<FetchPublicHttpUrlBufferResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timeoutHandle = setTimeout(() => {
    controller.abort();
    rejectTimeout(new Error("请求超时"));
  }, timeoutMs);

  const fetchPromise = (async (): Promise<FetchPublicHttpUrlBufferResult> => {
    let currentUrl = rawUrl;
    let redirectCount = 0;
    const maxRedirects = options.maxRedirects ?? 0;

    while (true) {
      if (controller.signal.aborted) throw new Error("请求超时");

      const safe = await assertPublicHttpUrl(currentUrl, {
        requireHttps: options.requireHttps,
      });
      if (controller.signal.aborted) throw new Error("请求超时");

      if (options.validateUrl) {
        await options.validateUrl(safe.url);
        if (controller.signal.aborted) throw new Error("请求超时");
      }

      const response = await requestWithPinnedDns({
        url: safe.url,
        resolvedIp: safe.resolvedIp,
        signal: controller.signal,
        method: options.method,
        headers: options.headers,
        timeoutMs,
        maxBytes: options.maxBytes,
      });
      if (controller.signal.aborted) throw new Error("请求超时");

      const location = response.headers.get("location");
      if (location && response.status >= 300 && response.status < 400) {
        if (redirectCount >= maxRedirects) {
          throw new Error("重定向次数过多");
        }
        currentUrl = new URL(location, safe.url).toString();
        redirectCount += 1;
        continue;
      }

      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        finalUrl: safe.url.toString(),
      };
    }
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredSize = Number(contentLengthHeader);
    if (!Number.isNaN(declaredSize) && declaredSize > maxBytes) {
      throw new Error("文件大小超出限制");
    }
  }

  if (!response.body) {
    throw new Error("响应体为空");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error("文件大小超出限制");
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}
