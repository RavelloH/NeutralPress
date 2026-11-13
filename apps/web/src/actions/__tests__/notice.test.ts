import { beforeEach, describe, expect, it, vi } from "vitest";

// ============ Mocks ============

const mockHeaders = vi.fn().mockReturnValue(new Headers());
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => mockHeaders(...args),
  cookies: vi.fn(() => ({
    get: vi.fn((name: string) => {
      if (name === "ACCESS_TOKEN") return { value: "test-token" };
      return undefined;
    }),
  })),
}));

const mockLimitControl = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockAuthVerify = vi.fn();
const mockVerifyAccessToken = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

const mockPrisma = {
  notice: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  conversationParticipant: {
    aggregate: vi.fn(),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

const mockPublishNoticeToUser = vi.fn();
vi.mock("@/lib/server/ably", () => ({
  publishNoticeToUser: (...args: unknown[]) => mockPublishNoticeToUser(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

// ============ Tests ============

describe("notice actions", () => {
  let getNotices: typeof import("@/actions/notice").getNotices;
  let getUnreadNoticeCount: typeof import("@/actions/notice").getUnreadNoticeCount;
  let markNoticesAsRead: typeof import("@/actions/notice").markNoticesAsRead;
  let markAllNoticesAsRead: typeof import("@/actions/notice").markAllNoticesAsRead;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    const mod = await import("@/actions/notice");
    getNotices = mod.getNotices;
    getUnreadNoticeCount = mod.getUnreadNoticeCount;
    markNoticesAsRead = mod.markNoticesAsRead;
    markAllNoticesAsRead = mod.markAllNoticesAsRead;
  });

  // ---------- getNotices ----------

  describe("getNotices", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getNotices();
      expect(result.success).toBe(false);
      expect(result.message).toContain("频繁");
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getNotices();
      expect(result.success).toBe(false);
      expect(result.message).toContain("未登录");
    });

    it("成功获取通知列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      const now = new Date();
      mockPrisma.notice.findMany
        .mockResolvedValueOnce([
          { id: "n1", userUid: 1, isRead: false, createdAt: now },
        ])
        .mockResolvedValueOnce([
          { id: "n2", userUid: 1, isRead: true, createdAt: now },
        ]);
      mockPrisma.notice.count.mockResolvedValue(5);

      const result = await getNotices(10);
      expect(result.success).toBe(true);
      expect(result.data.unreadCount).toBe(1);
      expect(result.data.unread).toHaveLength(1);
      expect(result.data.read).toHaveLength(1);
    });

    it("数据库异常时应返回 500", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.notice.findMany.mockRejectedValue(new Error("DB error"));

      const result = await getNotices();
      expect(result.success).toBe(false);
    });
  });

  // ---------- getUnreadNoticeCount ----------

  describe("getUnreadNoticeCount", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getUnreadNoticeCount();
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getUnreadNoticeCount();
      expect(result.success).toBe(false);
    });

    it("成功获取未读数量", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.notice.count.mockResolvedValue(3);
      mockPrisma.conversationParticipant.aggregate.mockResolvedValue({
        _sum: { unreadCount: 2 },
      });

      const result = await getUnreadNoticeCount();
      expect(result.success).toBe(true);
      expect(result.data.count).toBe(3);
      expect(result.data.messageCount).toBe(2);
    });
  });

  // ---------- markNoticesAsRead ----------

  describe("markNoticesAsRead", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await markNoticesAsRead(["n1"]);
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockVerifyAccessToken.mockResolvedValue(null);
      const result = await markNoticesAsRead(["n1"]);
      expect(result.success).toBe(false);
    });

    it("成功标记通知已读", async () => {
      mockVerifyAccessToken.mockResolvedValue({ uid: 1 });
      mockPrisma.notice.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.notice.count.mockResolvedValue(1);
      mockPublishNoticeToUser.mockResolvedValue(true);

      const result = await markNoticesAsRead(["n1", "n2"]);
      expect(result.success).toBe(true);
      expect(result.data.message).toContain("2");
    });
  });

  // ---------- markAllNoticesAsRead ----------

  describe("markAllNoticesAsRead", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await markAllNoticesAsRead();
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockVerifyAccessToken.mockResolvedValue(null);
      const result = await markAllNoticesAsRead();
      expect(result.success).toBe(false);
    });

    it("成功标记全部已读", async () => {
      mockVerifyAccessToken.mockResolvedValue({ uid: 1 });
      mockPrisma.notice.updateMany.mockResolvedValue({ count: 5 });
      mockPublishNoticeToUser.mockResolvedValue(true);

      const result = await markAllNoticesAsRead();
      expect(result.success).toBe(true);
      expect(result.data.message).toContain("5");
    });
  });
});
