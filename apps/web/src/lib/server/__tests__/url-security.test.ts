import http from "node:http";
import type { AddressInfo } from "node:net";

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted 用于在 vi.mock 工厂之前声明变量
const { mockLookup, mockIsPrivateIP, defaultIsPrivateIP } = vi.hoisted(() => {
  const defaultIsPrivateIP = (ip: string) => {
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
      return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("172.")) {
      const second = parseInt(ip.split(".")[1] ?? "0", 10);
      if (second >= 16 && second <= 31) return true;
    }
    if (ip.startsWith("169.254.")) return true;
    if (ip === "0.0.0.0") return true;
    return false;
  };

  return {
    mockLookup: vi.fn(),
    mockIsPrivateIP: vi.fn(defaultIsPrivateIP),
    defaultIsPrivateIP,
  };
});

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock ip-utils - 使用真实逻辑的精简版本
vi.mock("@/lib/server/ip-utils", () => ({
  isPrivateIP: mockIsPrivateIP,
}));

// Mock dns
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: mockLookup,
  },
}));

import {
  assertPublicHttpUrl,
  fetchPublicHttpUrlBuffer,
  readResponseBufferWithLimit,
} from "@/lib/server/url-security";

async function listenOnLoopback(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return address.port;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

// ============================================================================
// assertPublicHttpUrl
// ============================================================================
describe("assertPublicHttpUrl", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  describe("协议校验", () => {
    it("接受 http URL", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("http://example.com");
      expect(result.url.protocol).toBe("http:");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });

    it("接受 https URL", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("https://example.com");
      expect(result.url.protocol).toBe("https:");
    });

    it("拒绝 ftp 协议", async () => {
      await expect(
        assertPublicHttpUrl("ftp://example.com/file"),
      ).rejects.toThrow("仅支持 HTTP/HTTPS 地址");
    });

    it("拒绝 file 协议", async () => {
      await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(
        "仅支持 HTTP/HTTPS 地址",
      );
    });

    it("拒绝 javascript 协议", async () => {
      await expect(
        assertPublicHttpUrl("javascript:alert(1)"),
      ).rejects.toThrow();
    });

    it("requireHttps 时拒绝 http", async () => {
      await expect(
        assertPublicHttpUrl("http://example.com", { requireHttps: true }),
      ).rejects.toThrow("仅支持 HTTPS 地址");
    });

    it("requireHttps 时接受 https", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("https://example.com", {
        requireHttps: true,
      });
      expect(result.url.protocol).toBe("https:");
    });
  });

  describe("凭据校验", () => {
    it("拒绝包含用户名的 URL", async () => {
      await expect(
        assertPublicHttpUrl("http://user@example.com"),
      ).rejects.toThrow("URL 不允许包含账号信息");
    });

    it("拒绝包含用户名和密码的 URL", async () => {
      await expect(
        assertPublicHttpUrl("http://user:pass@example.com"),
      ).rejects.toThrow("URL 不允许包含账号信息");
    });
  });

  describe("主机名校验", () => {
    it("拒绝 localhost", async () => {
      await expect(assertPublicHttpUrl("http://localhost")).rejects.toThrow(
        "不允许访问本地地址",
      );
    });

    it("拒绝 localhost.localdomain", async () => {
      await expect(
        assertPublicHttpUrl("http://localhost.localdomain"),
      ).rejects.toThrow("不允许访问本地地址");
    });
  });

  describe("直接 IP 地址校验 - IPv4 私有地址", () => {
    it("拒绝 127.0.0.1", async () => {
      await expect(assertPublicHttpUrl("http://127.0.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 10.x.x.x（A 类私有）", async () => {
      await expect(assertPublicHttpUrl("http://10.0.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 192.168.x.x（C 类私有）", async () => {
      await expect(assertPublicHttpUrl("http://192.168.1.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 172.16.x.x（B 类私有下界）", async () => {
      await expect(assertPublicHttpUrl("http://172.16.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 172.31.x.x（B 类私有上界）", async () => {
      await expect(
        assertPublicHttpUrl("http://172.31.255.255"),
      ).rejects.toThrow("不允许访问内网或保留地址");
    });

    it("拒绝 0.0.0.0", async () => {
      await expect(assertPublicHttpUrl("http://0.0.0.0")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 169.254.x.x（链路本地）", async () => {
      await expect(assertPublicHttpUrl("http://169.254.1.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("接受公网 IPv4 地址", async () => {
      const result = await assertPublicHttpUrl("http://93.184.216.34");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });
  });

  describe("直接 IP 地址校验 - IPv4 保留网段", () => {
    it("拒绝 100.64.x.x（运营商级 NAT 下界）", async () => {
      await expect(assertPublicHttpUrl("http://100.64.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 100.127.x.x（运营商级 NAT 上界）", async () => {
      await expect(
        assertPublicHttpUrl("http://100.127.255.255"),
      ).rejects.toThrow("不允许访问内网或保留地址");
    });

    it("接受 100.63.x.x（运营商级 NAT 之外）", async () => {
      // 100.63 不在 100.64.0.0/10 范围内
      const result = await assertPublicHttpUrl("http://100.63.0.1");
      expect(result.resolvedIp).toBe("100.63.0.1");
    });

    it("拒绝 198.18.x.x（基准测试）", async () => {
      await expect(assertPublicHttpUrl("http://198.18.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 198.19.x.x（基准测试）", async () => {
      await expect(
        assertPublicHttpUrl("http://198.19.255.255"),
      ).rejects.toThrow("不允许访问内网或保留地址");
    });

    it("拒绝 224.0.0.1（组播）", async () => {
      await expect(assertPublicHttpUrl("http://224.0.0.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 255.255.255.255（保留）", async () => {
      await expect(
        assertPublicHttpUrl("http://255.255.255.255"),
      ).rejects.toThrow("不允许访问内网或保留地址");
    });

    it("拒绝 IPv4 文档网段", async () => {
      await expect(assertPublicHttpUrl("http://192.0.2.1")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });
  });

  describe("直接 IP 地址校验 - IPv6 保留地址", () => {
    // 注意：happy-dom 的 URL 实现对 IPv6 方括号格式解析存在差异，
    // 因此 IPv6 地址测试仅验证会抛出错误，不检查具体错误消息
    it("拒绝 ::1（loopback）", async () => {
      await expect(assertPublicHttpUrl("http://[::1]")).rejects.toThrow();
    });

    it("拒绝 ::（未指定地址）", async () => {
      await expect(assertPublicHttpUrl("http://[::]")).rejects.toThrow();
    });

    it("拒绝 fc00::1（ULA）", async () => {
      await expect(assertPublicHttpUrl("http://[fc00::1]")).rejects.toThrow();
    });

    it("拒绝 fd00::1（ULA）", async () => {
      await expect(assertPublicHttpUrl("http://[fd00::1]")).rejects.toThrow();
    });

    it("拒绝 fe80::1（链路本地）", async () => {
      await expect(assertPublicHttpUrl("http://[fe80::1]")).rejects.toThrow();
    });

    it("拒绝 ff02::1（组播）", async () => {
      await expect(assertPublicHttpUrl("http://[ff02::1]")).rejects.toThrow();
    });

    it("拒绝 2001:db8::1（文档用途）", async () => {
      await expect(
        assertPublicHttpUrl("http://[2001:db8::1]"),
      ).rejects.toThrow();
    });

    it("拒绝 ::ffff:127.0.0.1（IPv4 映射 loopback）", async () => {
      await expect(
        assertPublicHttpUrl("http://[::ffff:127.0.0.1]"),
      ).rejects.toThrow();
    });

    it("拒绝 ::ffff:10.0.0.1（IPv4 映射私有地址）", async () => {
      await expect(
        assertPublicHttpUrl("http://[::ffff:10.0.0.1]"),
      ).rejects.toThrow();
    });

    it.each(["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:127.0.0.1"])(
      "拒绝 IPv4 映射 loopback 的写法 %s",
      async (address) => {
        await expect(
          assertPublicHttpUrl(`http://[${address}]`),
        ).rejects.toThrow();
      },
    );

    it.each(["fe90::1", "febf::1"])(
      "拒绝完整链路本地范围内的 %s",
      async (address) => {
        mockLookup.mockResolvedValue([{ address, family: 6 }]);
        await expect(
          assertPublicHttpUrl("http://link-local.example"),
        ).rejects.toThrow("目标地址解析到内网或保留地址");
      },
    );

    it.each([
      ["NAT64", "64:ff9b::a9fe:a9fe"],
      ["6to4", "2002:a9fe:a9fe::"],
      ["Teredo", "2001:0000:4136:e378::"],
    ])("拒绝 %s IPv6 过渡地址", async (_name, address) => {
      mockLookup.mockResolvedValue([{ address, family: 6 }]);

      await expect(
        assertPublicHttpUrl(`http://[${address}]`),
      ).rejects.toThrow();
    });
  });

  describe("DNS 解析校验", () => {
    it("拒绝解析到内网 IP 的域名", async () => {
      mockLookup.mockResolvedValue([{ address: "192.168.1.1", family: 4 }]);
      await expect(
        assertPublicHttpUrl("http://internal.example.com"),
      ).rejects.toThrow("目标地址解析到内网或保留地址");
    });

    it("接受解析到公网 IPv4 的域名", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("http://example.com");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });

    it("DNS 解析无结果时抛出错误", async () => {
      mockLookup.mockResolvedValue([]);
      await expect(
        assertPublicHttpUrl("http://nonexistent.example.com"),
      ).rejects.toThrow("无法解析目标地址");
    });

    it("DNS 解析失败时抛出错误", async () => {
      mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(
        assertPublicHttpUrl("http://bad.example.com"),
      ).rejects.toThrow();
    });

    it("多个解析结果中只要有一个内网就拒绝", async () => {
      mockLookup.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ]);
      await expect(
        assertPublicHttpUrl("http://mixed.example.com"),
      ).rejects.toThrow("目标地址解析到内网或保留地址");
    });

    it("多个公网 IP 时返回第一个", async () => {
      mockLookup.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.35", family: 4 },
      ]);
      const result = await assertPublicHttpUrl("http://example.com");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });

    it("IPv6 公网地址解析成功", async () => {
      mockLookup.mockResolvedValue([{ address: "2606:4700::1", family: 6 }]);
      const result = await assertPublicHttpUrl("http://example.com");
      expect(result.resolvedIp).toBe("2606:4700::1");
    });

    it("解析结果中包含无效地址时过滤", async () => {
      mockLookup.mockResolvedValue([
        { address: "", family: 0 },
        { address: "93.184.216.34", family: 4 },
      ]);
      const result = await assertPublicHttpUrl("http://example.com");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });

    it("所有解析结果都无效时抛出错误", async () => {
      mockLookup.mockResolvedValue([
        { address: "", family: 0 },
        { address: "invalid", family: 0 },
      ]);
      await expect(assertPublicHttpUrl("http://example.com")).rejects.toThrow(
        "无法解析目标地址",
      );
    });
  });

  describe("边界情况", () => {
    it("URL 带端口号", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("http://example.com:8080");
      expect(result.url.port).toBe("8080");
    });

    it("URL 带路径和查询参数", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl(
        "http://example.com/path?key=value&foo=bar",
      );
      expect(result.url.pathname).toBe("/path");
      expect(result.url.searchParams.get("key")).toBe("value");
      expect(result.url.searchParams.get("foo")).toBe("bar");
    });

    it("URL 大小写协议规范化", async () => {
      mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const result = await assertPublicHttpUrl("HTTP://example.com");
      expect(result.url.protocol).toBe("http:");
    });
  });
});

// ============================================================================
// readResponseBufferWithLimit
// ============================================================================
describe("readResponseBufferWithLimit", () => {
  function createMockResponse(
    chunks: Uint8Array[],
    contentLength?: string,
  ): Response {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const headers = new Headers();
    if (contentLength !== undefined) {
      headers.set("content-length", contentLength);
    }

    return new Response(stream, { headers });
  }

  it("读取正常大小的响应", async () => {
    const data = new TextEncoder().encode("hello world");
    const response = createMockResponse([data]);
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.toString()).toBe("hello world");
  });

  it("多个 chunk 拼接正确", async () => {
    const chunk1 = new TextEncoder().encode("hello ");
    const chunk2 = new TextEncoder().encode("world");
    const response = createMockResponse([chunk1, chunk2]);
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.toString()).toBe("hello world");
  });

  it("content-length 超限时立即抛出错误", async () => {
    const data = new TextEncoder().encode("too large");
    const response = createMockResponse([data], "99999");
    await expect(readResponseBufferWithLimit(response, 100)).rejects.toThrow(
      "文件大小超出限制",
    );
  });

  it("实际数据超限时抛出错误", async () => {
    const data = new TextEncoder().encode("a".repeat(200));
    const response = createMockResponse([data]);
    await expect(readResponseBufferWithLimit(response, 100)).rejects.toThrow(
      "文件大小超出限制",
    );
  });

  it("空响应体抛出错误", async () => {
    const response = new Response(null);
    await expect(readResponseBufferWithLimit(response, 1024)).rejects.toThrow(
      "响应体为空",
    );
  });

  it("content-length 为负数时不触发预检（NaN）", async () => {
    const data = new TextEncoder().encode("small");
    const response = createMockResponse([data], "-1");
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.toString()).toBe("small");
  });

  it("content-length 为非数字时不触发预检", async () => {
    const data = new TextEncoder().encode("test");
    const response = createMockResponse([data], "not-a-number");
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.toString()).toBe("test");
  });

  it("边界值：数据恰好等于 maxBytes 时成功", async () => {
    const data = new TextEncoder().encode("a".repeat(100));
    const response = createMockResponse([data]);
    const buffer = await readResponseBufferWithLimit(response, 100);
    expect(buffer.length).toBe(100);
  });

  it("边界值：数据超过 maxBytes 一个字节时失败", async () => {
    const data = new TextEncoder().encode("a".repeat(101));
    const response = createMockResponse([data]);
    await expect(readResponseBufferWithLimit(response, 100)).rejects.toThrow(
      "文件大小超出限制",
    );
  });

  it("处理二进制数据", async () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const response = createMockResponse([binary]);
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer.length).toBe(6);
  });

  it("多个小 chunk 累积超限时抛出错误", async () => {
    const chunks = Array.from({ length: 10 }, () =>
      new TextEncoder().encode("a".repeat(15)),
    );
    const response = createMockResponse(chunks);
    // 每个 chunk 15 bytes，共 150 bytes，limit 100
    await expect(readResponseBufferWithLimit(response, 100)).rejects.toThrow(
      "文件大小超出限制",
    );
  });

  it("空数组 chunks 返回空 Buffer", async () => {
    const response = createMockResponse([]);
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.length).toBe(0);
  });

  it("无 content-length 头时正常读取", async () => {
    const data = new TextEncoder().encode("no content length header");
    const response = createMockResponse([data]);
    const buffer = await readResponseBufferWithLimit(response, 1024);
    expect(buffer.toString()).toBe("no content length header");
  });
});

// ============================================================================
// assertPublicHttpUrl - 补充测试
// ============================================================================
describe("assertPublicHttpUrl - 补充测试", () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockIsPrivateIP.mockImplementation(defaultIsPrivateIP);
  });

  describe("空主机名", () => {
    it("拒绝空主机名的 URL", async () => {
      // http:// 会被解析为无效 URL
      await expect(assertPublicHttpUrl("http://")).rejects.toThrow();
    });
  });

  describe("IPv4 保留网段补充", () => {
    it("拒绝 100.64.0.0（运营商级 NAT 下界精确值）", async () => {
      await expect(assertPublicHttpUrl("http://100.64.0.0")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("拒绝 100.127.0.0（运营商级 NAT 上界精确值）", async () => {
      await expect(assertPublicHttpUrl("http://100.127.0.0")).rejects.toThrow(
        "不允许访问内网或保留地址",
      );
    });

    it("接受 100.128.0.1（运营商级 NAT 之外）", async () => {
      const result = await assertPublicHttpUrl("http://100.128.0.1");
      expect(result.resolvedIp).toBe("100.128.0.1");
    });
  });

  describe("DNS 解析补充", () => {
    it("解析结果包含 IPv6 内网地址时拒绝", async () => {
      mockLookup.mockResolvedValue([{ address: "fc00::1", family: 6 }]);
      await expect(
        assertPublicHttpUrl("http://internal-v6.example.com"),
      ).rejects.toThrow("目标地址解析到内网或保留地址");
    });

    it("IPv4 和 IPv6 混合结果", async () => {
      mockLookup.mockResolvedValue([
        { address: "2606:4700::1", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ]);
      const result = await assertPublicHttpUrl("http://dual-stack.example.com");
      expect(result.resolvedIp).toBe("2606:4700::1");
    });
  });

  describe("协议补充", () => {
    it("拒绝 data 协议", async () => {
      await expect(
        assertPublicHttpUrl("data:text/html,<h1>test</h1>"),
      ).rejects.toThrow();
    });
  });
});

describe("fetchPublicHttpUrlBuffer 总体超时", () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockIsPrivateIP.mockImplementation(defaultIsPrivateIP);
  });

  it("重定向后的 DNS 等待仍受同一 deadline 限制，迟到解析不会发起请求", async () => {
    let port = 0;
    const paths: string[] = [];
    const server = http.createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(302, {
        Location: `http://slow.test:${port}/target`,
      });
      response.end();
    });
    port = await listenOnLoopback(server);

    let finishSlowLookup:
      | ((records: Array<{ address: string; family: number }>) => void)
      | undefined;
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === "start.test") {
        return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
      }
      return new Promise((resolve) => {
        finishSlowLookup = resolve;
      });
    });
    mockIsPrivateIP.mockImplementation(
      (ip: string) => ip !== "127.0.0.1" && defaultIsPrivateIP(ip),
    );

    try {
      await expect(
        fetchPublicHttpUrlBuffer(`http://start.test:${port}/redirect`, {
          timeoutMs: 100,
          maxBytes: 1024,
          maxRedirects: 1,
        }),
      ).rejects.toThrow("请求超时");

      finishSlowLookup?.([{ address: "127.0.0.1", family: 4 }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paths).toEqual(["/redirect"]);
    } finally {
      finishSlowLookup?.([{ address: "127.0.0.1", family: 4 }]);
      await closeServer(server);
    }
  });

  it("持续慢滴响应不能重置总体超时", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      const interval = setInterval(() => response.write("x"), 20);
      response.on("close", () => clearInterval(interval));
    });
    const port = await listenOnLoopback(server);
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    mockIsPrivateIP.mockImplementation(
      (ip: string) => ip !== "127.0.0.1" && defaultIsPrivateIP(ip),
    );

    const startedAt = Date.now();
    try {
      await expect(
        fetchPublicHttpUrlBuffer(`http://slow.test:${port}/`, {
          timeoutMs: 120,
          maxBytes: 1024,
        }),
      ).rejects.toThrow("请求超时");
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      await closeServer(server);
    }
  });
});
