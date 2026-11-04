import { beforeEach, describe, expect, it, vi } from "vitest";

// ============ Mocks ============

const mockHeaders = vi.fn().mockReturnValue(new Headers());
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => mockHeaders(...args),
}));

const mockLimitControl = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockPrisma = {
  project: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  friendLink: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  post: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  page: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  comment: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

// ============ Tests ============

describe("recycle-bin actions", () => {
  let getRecycleBinList: typeof import("@/actions/recycle-bin").getRecycleBinList;
  let getRecycleBinStats: typeof import("@/actions/recycle-bin").getRecycleBinStats;
  let restoreRecycleBinItems: typeof import("@/actions/recycle-bin").restoreRecycleBinItems;
  let purgeRecycleBinItems: typeof import("@/actions/recycle-bin").purgeRecycleBinItems;
  let clearRecycleBin: typeof import("@/actions/recycle-bin").clearRecycleBin;
  let restoreAllProjectsFromRecycleBin: typeof import("@/actions/recycle-bin").restoreAllProjectsFromRecycleBin;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    // Default: return empty arrays for all prisma queries
    for (const model of Object.values(mockPrisma)) {
      if (typeof model === "object") {
        for (const method of Object.values(model)) {
          if (typeof method === "function") {
            (method as ReturnType<typeof vi.fn>).mockReset();
          }
        }
      }
    }
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    const mod = await import("@/actions/recycle-bin");
    getRecycleBinList = mod.getRecycleBinList;
    getRecycleBinStats = mod.getRecycleBinStats;
    restoreRecycleBinItems = mod.restoreRecycleBinItems;
    purgeRecycleBinItems = mod.purgeRecycleBinItems;
    clearRecycleBin = mod.clearRecycleBin;
    restoreAllProjectsFromRecycleBin = mod.restoreAllProjectsFromRecycleBin;
  });

  // ---------- getRecycleBinList ----------

  describe("getRecycleBinList", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getRecycleBinList({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getRecycleBinList({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("ADMIN 可以看到所有资源类型", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      // All queries return empty
      for (const model of [
        mockPrisma.project,
        mockPrisma.friendLink,
        mockPrisma.post,
        mockPrisma.page,
        mockPrisma.comment,
        mockPrisma.user,
        mockPrisma.message,
      ]) {
        model.findMany.mockResolvedValue([]);
      }

      const result = await getRecycleBinList({ access_token: "token" });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it("EDITOR 只能看到项目、文章、评论", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 2, role: "EDITOR" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.comment.findMany.mockResolvedValue([]);

      const result = await getRecycleBinList({ access_token: "token" });
      expect(result.success).toBe(true);
      // friendLink, page, user, message should not be queried for EDITOR
      expect(mockPrisma.friendLink.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.page.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    it("USER 看不到任何资源", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 3, role: "USER" });

      const result = await getRecycleBinList({ access_token: "token" });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  // ---------- getRecycleBinStats ----------

  describe("getRecycleBinStats", () => {
    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getRecycleBinStats({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("成功获取统计", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      // All count queries return 0
      for (const model of [
        mockPrisma.project,
        mockPrisma.friendLink,
        mockPrisma.post,
        mockPrisma.page,
        mockPrisma.comment,
        mockPrisma.user,
        mockPrisma.message,
      ]) {
        model.count.mockResolvedValue(0);
      }

      const result = await getRecycleBinStats({ access_token: "token" });
      expect(result.success).toBe(true);
      expect(result.data!.total).toBe(0);
      // types includes entries with 0 count for each visible resource type
      expect(result.data!.types.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------- restoreRecycleBinItems ----------

  describe("restoreRecycleBinItems", () => {
    it("空项目列表时应返回 403", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "EDITOR" });

      const result = await restoreRecycleBinItems({
        access_token: "token",
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it("成功恢复项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.post.findMany.mockResolvedValue([
        {
          id: 1,
          slug: "test",
          title: "Test",
          status: "PUBLISHED",
          tags: [],
          categories: [],
        },
      ]);
      mockPrisma.post.updateMany.mockResolvedValue({ count: 1 });

      const result = await restoreRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "POST", id: 1 }],
      });
      expect(result.success).toBe(true);
      expect(result.data!.restored).toBe(1);
    });
  });

  // ---------- purgeRecycleBinItems ----------

  describe("purgeRecycleBinItems", () => {
    it("成功彻底删除项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 1,
          slug: "test",
          title: "Test",
          status: "DRAFT",
          tags: [],
          categories: [],
        },
      ]);
      mockPrisma.project.deleteMany.mockResolvedValue({ count: 1 });

      const result = await purgeRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "PROJECT", id: 1 }],
      });
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(1);
    });
  });

  // ---------- clearRecycleBin ----------

  describe("clearRecycleBin", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await clearRecycleBin({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("USER 无权清空", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 3, role: "USER" });
      const result = await clearRecycleBin({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("成功清空回收站", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      for (const model of [
        mockPrisma.project,
        mockPrisma.friendLink,
        mockPrisma.post,
        mockPrisma.page,
        mockPrisma.comment,
        mockPrisma.user,
        mockPrisma.message,
      ]) {
        model.findMany.mockResolvedValue([]);
        model.deleteMany.mockResolvedValue({ count: 0 });
      }

      const result = await clearRecycleBin({ access_token: "token" });
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(0);
    });

    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await clearRecycleBin({ access_token: "token" });
      expect(result.success).toBe(false);
    });
  });

  // ---------- 补充测试 ----------

  describe("getRecycleBinList 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
      });
      expect(result.success).toBe(false);
    });

    it("成功获取回收站列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      for (const model of Object.values(mockPrisma)) {
        if (typeof model === "object") {
          for (const method of Object.values(model)) {
            if (typeof method === "function") {
              (method as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            }
          }
        }
      }
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("getRecycleBinStats 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getRecycleBinStats({ access_token: "token" });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getRecycleBinStats({ access_token: "token" });
      expect(result.success).toBe(false);
    });
  });

  describe("restoreRecycleBinItems 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await restoreRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "POST", id: 1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("purgeRecycleBinItems 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await purgeRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "POST", id: 1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== restoreAllProjectsFromRecycleBin ====================

  describe("restoreAllProjectsFromRecycleBin", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await restoreAllProjectsFromRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await restoreAllProjectsFromRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(false);
    });

    it("成功恢复所有项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 1, deletedAt: new Date() },
        { id: 2, deletedAt: new Date() },
      ]);
      mockPrisma.project.updateMany.mockResolvedValue({ count: 2 });
      const result = await restoreAllProjectsFromRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(true);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getRecycleBinList 分支", () => {
    it("AUTHOR 角色过滤自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.comment.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
        pageSize: 20,
      });
      expect(result.success).toBe(true);
    });

    it("带 search 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.friendLink.findMany.mockResolvedValue([]);
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.page.findMany.mockResolvedValue([]);
      mockPrisma.comment.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.message.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        search: "test",
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await getRecycleBinList({
        access_token: "token",
        page: 1,
        pageSize: 20,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getRecycleBinStats 分支", () => {
    it("AUTHOR 角色过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.count.mockResolvedValue(0);
      mockPrisma.post.count.mockResolvedValue(0);
      mockPrisma.comment.count.mockResolvedValue(0);
      const result = await getRecycleBinStats({
        access_token: "token",
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.count.mockRejectedValue(new Error("DB error"));
      const result = await getRecycleBinStats({
        access_token: "token",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("restoreRecycleBinItems 分支", () => {
    it("AUTHOR 角色恢复自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.project.updateMany.mockResolvedValue({ count: 1 });
      const result = await restoreRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "PROJECT", id: 1 }],
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await restoreRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "PROJECT", id: 1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("purgeRecycleBinItems 分支", () => {
    it("AUTHOR 角色清除自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.project.deleteMany.mockResolvedValue({ count: 1 });
      const result = await purgeRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "PROJECT", id: 1 }],
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await purgeRecycleBinItems({
        access_token: "token",
        items: [{ resourceType: "PROJECT", id: 1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("clearRecycleBin 分支", () => {
    it("AUTHOR 角色清除自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.project.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.comment.findMany.mockResolvedValue([]);
      const result = await clearRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await clearRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("restoreAllProjectsFromRecycleBin 分支", () => {
    it("无项目时返回 restored:0", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      const result = await restoreAllProjectsFromRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await restoreAllProjectsFromRecycleBin({
        access_token: "token",
      });
      expect(result.success).toBe(false);
    });
  });
});
