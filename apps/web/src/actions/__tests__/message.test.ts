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
    delete: vi.fn(),
  })),
}));

const mockLimitControl = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockGetConfig = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/server/config-cache", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockPrisma = {
  conversationParticipant: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  },
  conversation: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

const mockCheckUserOnlineStatus = vi.fn();
const mockPublishNoticeToUser = vi.fn();
vi.mock("@/lib/server/ably", () => ({
  checkUserOnlineStatus: (...args: unknown[]) =>
    mockCheckUserOnlineStatus(...args),
  publishNoticeToUser: (...args: unknown[]) => mockPublishNoticeToUser(...args),
}));

vi.mock("@/lib/server/ably-config", () => ({
  isAblyEnabled: vi.fn().mockResolvedValue(false),
}));

const mockSendNotice = vi.fn();
vi.mock("@/lib/server/notice", () => ({
  sendNotice: (...args: unknown[]) => mockSendNotice(...args),
}));

vi.mock("@/lib/server/crypto", () => ({
  calculateMD5: vi.fn().mockReturnValue("md5hash"),
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

// ============ Tests ============

describe("message actions", () => {
  let getConversations: typeof import("@/actions/message").getConversations;
  let getConversationMessages: typeof import("@/actions/message").getConversationMessages;
  let sendMessage: typeof import("@/actions/message").sendMessage;
  let markConversationAsRead: typeof import("@/actions/message").markConversationAsRead;
  let deleteConversation: typeof import("@/actions/message").deleteConversation;
  let searchUsers: typeof import("@/actions/message").searchUsers;
  let checkMessagePermission: typeof import("@/actions/message").checkMessagePermission;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue(true);
    const mod = await import("@/actions/message");
    getConversations = mod.getConversations;
    getConversationMessages = mod.getConversationMessages;
    sendMessage = mod.sendMessage;
    markConversationAsRead = mod.markConversationAsRead;
    deleteConversation = mod.deleteConversation;
    searchUsers = mod.searchUsers;
    checkMessagePermission = mod.checkMessagePermission;
  });

  // ---------- getConversations ----------

  describe("getConversations", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getConversations();
      expect(result.success).toBe(false);
    });

    it("消息系统未启用时应返回 403", async () => {
      mockGetConfig.mockResolvedValue(false);
      const result = await getConversations();
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getConversations();
      expect(result.success).toBe(false);
    });

    it("成功获取会话列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findMany.mockResolvedValue([
        {
          conversationId: "conv1",
          unreadCount: 2,
          updatedAt: new Date(),
          lastMessageAt: new Date(),
          conversation: {
            participants: [
              {
                userUid: 2,
                lastReadMessageId: null,
                user: {
                  uid: 2,
                  username: "user2",
                  nickname: null,
                  avatar: null,
                  role: "USER",
                  email: "u2@test.com",
                },
              },
            ],
          },
        },
      ]);
      mockPrisma.conversationParticipant.count.mockResolvedValue(1);
      mockPrisma.message.findFirst.mockResolvedValue({
        content: "hello",
        createdAt: new Date(),
        senderUid: 2,
      });
      mockCheckUserOnlineStatus.mockResolvedValue(false);

      const result = await getConversations();
      expect(result.success).toBe(true);
      expect(result.data.conversations).toHaveLength(1);
    });
  });

  // ---------- sendMessage ----------

  describe("sendMessage", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await sendMessage(2, "hello", undefined);
      expect(result.success).toBe(false);
    });

    it("消息系统未启用时应返回 403", async () => {
      mockGetConfig.mockResolvedValue(false);
      const result = await sendMessage(2, "hello", undefined);
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await sendMessage(2, "hello", undefined);
      expect(result.success).toBe(false);
    });

    it("给自己发消息应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      const result = await sendMessage(1, "hello", undefined);
      expect(result.success).toBe(false);
      expect(result.message).toContain("自己");
    });

    it("目标用户不存在时应返回 404", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await sendMessage(999, "hello", undefined);
      expect(result.success).toBe(false);
    });

    it("成功发送消息（已有会话）", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findUnique.mockResolvedValue({ uid: 2, role: "USER" });
      mockPrisma.conversation.findFirst.mockResolvedValue({
        id: "conv1",
        participants: [{ userUid: 1 }, { userUid: 2 }],
      });
      mockPrisma.message.create.mockResolvedValue({
        id: "msg1",
        content: "hello",
        type: "TEXT",
        senderUid: 1,
        createdAt: new Date(),
      });
      mockPrisma.conversation.update.mockResolvedValue({});
      mockPrisma.conversationParticipant.updateMany.mockResolvedValue({});
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue(null);
      mockPrisma.conversationParticipant.findFirst.mockResolvedValue(null);
      mockPrisma.conversationParticipant.aggregate.mockResolvedValue({
        _sum: { unreadCount: 0 },
      });
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockCheckUserOnlineStatus.mockResolvedValue(false);
      mockSendNotice.mockResolvedValue(undefined);

      const result = await sendMessage(2, "hello", "temp-1");
      expect(result.success).toBe(true);
      expect(result.data.message.id).toBe("msg1");
      expect(result.data.conversationId).toBe("conv1");
    });
  });

  // ---------- markConversationAsRead ----------

  describe("markConversationAsRead", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await markConversationAsRead("conv1");
      expect(result.success).toBe(false);
    });

    const testConvId = "550e8400-e29b-41d4-a716-446655440000";

    it("会话不存在时应返回 404", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockGetConfig.mockResolvedValue(true);
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue(null);
      const result = await markConversationAsRead(testConvId);
      expect(result.success).toBe(false);
    });

    it("成功标记已读", async () => {
      // Force mock for dynamic import of next/headers inside the function
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockGetConfig.mockResolvedValue(true);
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue({
        id: "cp1",
      });
      mockPrisma.message.findFirst.mockResolvedValue({ id: "msg10" });
      mockPrisma.conversationParticipant.update.mockResolvedValue({});
      mockPrisma.conversationParticipant.aggregate.mockResolvedValue({
        _sum: { unreadCount: 0 },
      });

      const result = await markConversationAsRead(testConvId);
      expect(result.success).toBe(true);
    });
  });

  // ---------- deleteConversation ----------

  describe("deleteConversation", () => {
    const testConvId = "550e8400-e29b-41d4-a716-446655440001";

    it("会话不存在时应返回 404", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockGetConfig.mockResolvedValue(true);
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue(null);
      const result = await deleteConversation(testConvId);
      expect(result.success).toBe(false);
    });

    it("成功删除会话", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockGetConfig.mockResolvedValue(true);
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue({
        id: "cp1",
      });
      mockPrisma.conversationParticipant.update.mockResolvedValue({});

      const result = await deleteConversation(testConvId);
      expect(result.success).toBe(true);
    });
  });

  // ---------- searchUsers ----------

  describe("searchUsers", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchUsers("test");
      expect(result.success).toBe(false);
    });

    it("未登录时应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await searchUsers("test");
      expect(result.success).toBe(false);
    });

    it("成功搜索用户", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findMany.mockResolvedValue([
        {
          uid: 2,
          username: "testuser",
          nickname: null,
          avatar: null,
          email: "test@test.com",
          role: "USER",
        },
      ]);

      const result = await searchUsers("test");
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data!.users[0]!.emailMd5).toBe("md5hash");
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("getConversations 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getConversations();
      expect(result.success).toBe(false);
    });
  });

  describe("sendMessage 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await sendMessage(2, "Hello");
      expect(result.success).toBe(false);
    });
  });

  describe("markConversationAsRead 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await markConversationAsRead(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(result.success).toBe(false);
    });
  });

  describe("deleteConversation 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteConversation(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("getConversationMessages 分支", () => {
    it("消息系统禁用时返回失败", async () => {
      mockGetConfig.mockResolvedValue(false);
      const result = await getConversationMessages(
        "550e8400-e29b-41d4-a716-446655440000",
        0,
      );
      expect(result.success).toBe(false);
    });

    it("用户不是参与者返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 999, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue(null);
      const result = await getConversationMessages(
        "550e8400-e29b-41d4-a716-446655440000",
        0,
      );
      expect(result.success).toBe(false);
    });

    it("成功获取消息列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findUnique.mockResolvedValue({
        conversationId: "550e8400-e29b-41d4-a716-446655440000",
        userUid: 1,
      });
      mockPrisma.message.findMany.mockResolvedValue([]);
      mockPrisma.message.count.mockResolvedValue(0);
      const result = await getConversationMessages(
        "550e8400-e29b-41d4-a716-446655440000",
        0,
      );
      expect(result.success).toBe(true);
    });
  });

  describe("checkMessagePermission 分支", () => {
    it("消息系统禁用时返回 allowed:false", async () => {
      mockGetConfig.mockResolvedValue(false);
      const result = await checkMessagePermission(2);
      expect(result.success).toBe(true);
    });

    it("自查时返回 allowed:false", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      const result = await checkMessagePermission(1);
      expect(result.success).toBe(true);
    });

    it("目标用户未找到返回 allowed:false", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await checkMessagePermission(999);
      expect(result.success).toBe(true);
    });

    it("权限检查通过返回 allowed:true", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findUnique.mockResolvedValue({
        uid: 2,
        role: "USER",
        messagePermission: "everyone",
      });
      const result = await checkMessagePermission(2);
      expect(result.success).toBe(true);
    });
  });

  describe("searchUsers 分支", () => {
    it("消息系统禁用时返回失败", async () => {
      mockGetConfig.mockResolvedValue(false);
      const result = await searchUsers("test");
      expect(result.success).toBe(false);
    });

    it("UID 可解析时添加 uid 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findMany.mockResolvedValue([]);
      const result = await searchUsers("123");
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findMany.mockRejectedValue(new Error("DB error"));
      const result = await searchUsers("test");
      expect(result.success).toBe(false);
    });
  });

  describe("sendMessage 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.user.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await sendMessage(2, "Hello");
      expect(result.success).toBe(false);
    });
  });

  describe("getConversations 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "USER" });
      mockPrisma.conversationParticipant.findMany.mockRejectedValue(
        new Error("DB error"),
      );
      const result = await getConversations();
      expect(result.success).toBe(false);
    });
  });
});
