import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/server/cache-bootstrap-targets", () => ({
  collectBootstrapTags: vi.fn(async () => ["config", "menus"]),
  getCriticalRevalidatePathTargets: vi.fn(() => [
    { path: "/", type: "layout" as const },
  ]),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

// ── Imports ──────────────────────────────────────────────────────────────────

import { authVerify } from "@/lib/server/auth-verify";
import limitControl from "@/lib/server/rate-limit";

const mockLimitControl = vi.mocked(limitControl);
const mockAuthVerify = vi.mocked(authVerify);

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupSuccessMocks() {
  mockLimitControl.mockResolvedValue(true as never);
  mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" } as never);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cache-bootstrap actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // refreshBootstrapCaches
  // ==========================================================================
  describe("refreshBootstrapCaches", () => {
    it("刷新缓存 - 成功路径", async () => {
      setupSuccessMocks();

      const { refreshBootstrapCaches } = await import(
        "@/actions/cache-bootstrap"
      );
      const result = await refreshBootstrapCaches();

      expect(result).toEqual({
        refreshedTagCount: 2,
        revalidatedPathCount: 1,
      });
    });

    it("速率限制触发时抛出异常", async () => {
      mockLimitControl.mockResolvedValue(false as never);

      const { refreshBootstrapCaches } = await import(
        "@/actions/cache-bootstrap"
      );
      await expect(refreshBootstrapCaches()).rejects.toThrow("请求过于频繁");
    });

    it("未授权时抛出异常", async () => {
      mockLimitControl.mockResolvedValue(true as never);
      mockAuthVerify.mockResolvedValue(null as never);

      const { refreshBootstrapCaches } = await import(
        "@/actions/cache-bootstrap"
      );
      await expect(refreshBootstrapCaches()).rejects.toThrow("未授权");
    });

    it("管理员可以成功调用", async () => {
      setupSuccessMocks();

      const { refreshBootstrapCaches } = await import(
        "@/actions/cache-bootstrap"
      );
      const result = await refreshBootstrapCaches();

      expect(result.refreshedTagCount).toBeGreaterThanOrEqual(0);
      expect(result.revalidatedPathCount).toBeGreaterThanOrEqual(0);
    });
  });
});
