import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock 外部依赖
vi.mock("server-only", () => ({}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn(
      (body: unknown, init?: { status?: number; headers?: HeadersInit }) => ({
        body,
        status: init?.status ?? 200,
        headers: new Headers(init?.headers),
      }),
    ),
  },
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

// Mock rate-limit
const mockLimitControl = vi.fn();
vi.mock("@/lib/server/rate-limit", () => ({
  default: (...args: unknown[]) => mockLimitControl(...args),
}));

// Mock auth-verify
const mockAuthVerify = vi.fn();
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

// Mock prisma
const mockPrismaMenu = {
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
};
vi.mock("@/lib/server/prisma", () => ({
  default: {
    menu: mockPrismaMenu,
  },
}));

// Mock audit
vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("menu actions", () => {
  const adminAuthResult = {
    uid: 1,
    username: "admin",
    nickname: "Admin",
    role: "ADMIN",
    iat: 1,
    exp: 9999999999,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimitControl.mockResolvedValue(true);
    mockAuthVerify.mockResolvedValue(adminAuthResult);
  });

  // =========================================================================
  // getMenusStats
  // =========================================================================
  describe("getMenusStats", () => {
    const baseParams = { access_token: "admin-token", force: false };

    it("成功获取菜单统计", async () => {
      mockPrismaMenu.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // active
        .mockResolvedValueOnce(2) // suspended
        .mockResolvedValueOnce(3) // main
        .mockResolvedValueOnce(5) // common
        .mockResolvedValueOnce(2); // outsite

      const { getMenusStats } = await import("@/actions/menu");
      const result = await getMenusStats(baseParams);

      expect(result.success).toBe(true);
      expect(result.data!.total).toEqual({
        total: 10,
        active: 8,
        suspended: 2,
        main: 3,
        common: 5,
        outsite: 2,
      });
      expect(mockPrismaMenu.count).toHaveBeenCalledTimes(6);
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { getMenusStats } = await import("@/actions/menu");
      const result = await getMenusStats(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getMenusStats } = await import("@/actions/menu");
      const result = await getMenusStats(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库查询异常返回 500", async () => {
      mockPrismaMenu.count.mockRejectedValue(new Error("数据库连接失败"));

      const { getMenusStats } = await import("@/actions/menu");
      const result = await getMenusStats(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("获取菜单统计失败");
    });
  });

  // =========================================================================
  // getMenusList
  // =========================================================================
  describe("getMenusList", () => {
    const baseParams = {
      access_token: "admin-token",
      page: 1,
      pageSize: 10,
      sortBy: "order" as const,
      sortOrder: "asc" as const,
    };

    function createMockMenu(overrides: Record<string, unknown> = {}) {
      return {
        id: "menu-1",
        name: "首页",
        icon: "home",
        link: "/",
        slug: "home",
        status: "ACTIVE",
        order: 0,
        category: "MAIN",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
        page: { id: "page-1", slug: "home", title: "首页" },
        ...overrides,
      };
    }

    it("成功获取菜单列表", async () => {
      const mockMenus = [
        createMockMenu(),
        createMockMenu({ id: "menu-2", name: "关于", slug: "about" }),
      ];
      mockPrismaMenu.findMany.mockResolvedValue(mockMenus);

      const { getMenusList } = await import("@/actions/menu");
      const result = await getMenusList(baseParams);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]!.id).toBe("menu-1");
      expect(result.data![0]!.name).toBe("首页");
      expect(result.data![0]!.createdAt).toBe("2025-01-01T00:00:00.000Z");
    });

    it("带搜索条件时构建正确的查询", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);

      const { getMenusList } = await import("@/actions/menu");
      await getMenusList({ ...baseParams, search: "test" });

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: "test", mode: "insensitive" } },
              { slug: { contains: "test", mode: "insensitive" } },
            ],
          }),
        }),
      );
    });

    it("带状态筛选时构建正确的查询", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);

      const { getMenusList } = await import("@/actions/menu");
      await getMenusList({ ...baseParams, status: ["ACTIVE"] });

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ["ACTIVE"] },
          }),
        }),
      );
    });

    it("带分类筛选时构建正确的查询", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);

      const { getMenusList } = await import("@/actions/menu");
      await getMenusList({ ...baseParams, category: ["MAIN", "COMMON"] });

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { in: ["MAIN", "COMMON"] },
          }),
        }),
      );
    });

    it("带时间筛选时构建正确的查询", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);

      const { getMenusList } = await import("@/actions/menu");
      await getMenusList({
        ...baseParams,
        createdAtStart: "2025-01-01",
        createdAtEnd: "2025-12-31",
      });

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date("2025-01-01"),
              lte: new Date("2025-12-31"),
            },
          }),
        }),
      );
    });

    it("分页参数正确传递", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);

      const { getMenusList } = await import("@/actions/menu");
      await getMenusList({ ...baseParams, page: 2, pageSize: 5 });

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        }),
      );
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { getMenusList } = await import("@/actions/menu");
      const result = await getMenusList(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getMenusList } = await import("@/actions/menu");
      const result = await getMenusList(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库查询异常返回 500", async () => {
      mockPrismaMenu.findMany.mockRejectedValue(new Error("DB error"));

      const { getMenusList } = await import("@/actions/menu");
      const result = await getMenusList(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("获取菜单列表失败");
    });
  });

  // =========================================================================
  // getMenuDetail
  // =========================================================================
  describe("getMenuDetail", () => {
    const baseParams = { access_token: "admin-token", id: "menu-1" };

    function createMockMenuDetail() {
      return {
        id: "menu-1",
        name: "首页",
        icon: "home",
        link: "/",
        slug: "home",
        status: "ACTIVE",
        order: 0,
        category: "MAIN",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
        page: { id: "page-1", slug: "home", title: "首页" },
      };
    }

    it("成功获取菜单详情", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(createMockMenuDetail());

      const { getMenuDetail } = await import("@/actions/menu");
      const result = await getMenuDetail(baseParams);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("menu-1");
      expect(result.data!.name).toBe("首页");
      expect(result.data!.page).toEqual({
        id: "page-1",
        slug: "home",
        title: "首页",
      });
    });

    it("菜单不存在时返回 404", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(null);

      const { getMenuDetail } = await import("@/actions/menu");
      const result = await getMenuDetail(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("菜单不存在");
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { getMenuDetail } = await import("@/actions/menu");
      const result = await getMenuDetail(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { getMenuDetail } = await import("@/actions/menu");
      const result = await getMenuDetail(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库查询异常返回 500", async () => {
      mockPrismaMenu.findUnique.mockRejectedValue(new Error("DB error"));

      const { getMenuDetail } = await import("@/actions/menu");
      const result = await getMenuDetail(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("获取菜单详情失败");
    });
  });

  // =========================================================================
  // createMenu
  // =========================================================================
  describe("createMenu", () => {
    const baseParams = {
      access_token: "admin-token",
      name: "新菜单",
      slug: "new-menu",
      link: "/new-menu",
    };

    it("成功创建菜单", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(null); // slug 不冲突
      mockPrismaMenu.create.mockResolvedValue({
        id: "new-id",
        ...baseParams,
        icon: null,
        status: "ACTIVE",
        order: 0,
        category: "COMMON",
        pageId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu(baseParams as any);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("new-id");
      expect(mockPrismaMenu.create).toHaveBeenCalled();
    });

    it("slug 已存在时返回 409", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue({
        id: "existing-id",
        slug: "new-menu",
      });

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu(baseParams as any);

      expect(result.success).toBe(false);
      expect(result.message).toBe("该路径已被使用");
    });

    it("slug 和 link 都未提供时返回 400", async () => {
      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu({
        access_token: "admin-token",
        name: "无路径菜单",
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).toBe("slug 和 link 至少需要提供一个");
    });

    it("不提供 slug 时跳过 slug 唯一性检查", async () => {
      mockPrismaMenu.create.mockResolvedValue({
        id: "new-id",
        name: "仅链接菜单",
        link: "/only-link",
        slug: null,
      });

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu({
        access_token: "admin-token",
        name: "仅链接菜单",
        link: "/only-link",
      } as any);

      expect(result.success).toBe(true);
      // 不应调用 findUnique 检查 slug
      expect(mockPrismaMenu.findUnique).not.toHaveBeenCalled();
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu(baseParams as any);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu(baseParams as any);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库创建异常返回 500", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(null);
      mockPrismaMenu.create.mockRejectedValue(new Error("DB error"));

      const { createMenu } = await import("@/actions/menu");
      const result = await createMenu(baseParams as any);

      expect(result.success).toBe(false);
      expect(result.message).toBe("创建菜单失败");
    });

    it("使用默认值创建菜单", async () => {
      mockPrismaMenu.create.mockResolvedValue({
        id: "new-id",
        name: "默认菜单",
        slug: null,
        link: "/default",
      });

      const { createMenu } = await import("@/actions/menu");
      await createMenu({
        access_token: "admin-token",
        name: "默认菜单",
        link: "/default",
      } as any);

      expect(mockPrismaMenu.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "ACTIVE",
          order: 0,
          category: "COMMON",
          icon: null,
          slug: null,
          pageId: null,
        }),
      });
    });
  });

  // =========================================================================
  // updateMenu
  // =========================================================================
  describe("updateMenu", () => {
    const existingMenu = {
      id: "menu-1",
      name: "旧名称",
      icon: "old-icon",
      link: "/old",
      slug: "old",
      status: "ACTIVE",
      order: 0,
      category: "COMMON",
      pageId: null,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };

    const baseParams = {
      access_token: "admin-token",
      id: "menu-1",
      name: "新名称",
    };

    it("成功更新菜单", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(existingMenu);
      mockPrismaMenu.update.mockResolvedValue({
        ...existingMenu,
        name: "新名称",
      });

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu(baseParams);

      expect(result.success).toBe(true);
      expect(result.data!.id).toBe("menu-1");
      expect(mockPrismaMenu.update).toHaveBeenCalled();
    });

    it("菜单不存在时返回 404", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(null);

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("菜单不存在");
    });

    it("slug 冲突时返回 409", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(existingMenu);
      mockPrismaMenu.findFirst.mockResolvedValue({
        id: "other-menu",
        slug: "conflict-slug",
      });

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu({
        ...baseParams,
        slug: "conflict-slug",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("该路径已被其他菜单使用");
    });

    it("仅更新部分字段", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(existingMenu);
      mockPrismaMenu.update.mockResolvedValue({
        ...existingMenu,
        order: 5,
      });

      const { updateMenu } = await import("@/actions/menu");
      await updateMenu({
        access_token: "admin-token",
        id: "menu-1",
        order: 5,
      });

      expect(mockPrismaMenu.update).toHaveBeenCalledWith({
        where: { id: "menu-1" },
        data: { order: 5 },
      });
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库更新异常返回 500", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(existingMenu);
      mockPrismaMenu.update.mockRejectedValue(new Error("DB error"));

      const { updateMenu } = await import("@/actions/menu");
      const result = await updateMenu(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("更新菜单失败");
    });

    it("slug 为 null 时不触发 slug 冲突检查", async () => {
      mockPrismaMenu.findUnique.mockResolvedValue(existingMenu);
      mockPrismaMenu.update.mockResolvedValue({
        ...existingMenu,
        slug: null,
      });

      const { updateMenu } = await import("@/actions/menu");
      await updateMenu({
        access_token: "admin-token",
        id: "menu-1",
        slug: null,
      });

      expect(mockPrismaMenu.findFirst).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateMenus (批量更新)
  // =========================================================================
  describe("updateMenus", () => {
    const baseParams = {
      access_token: "admin-token",
      ids: ["menu-1", "menu-2"],
      status: "ACTIVE" as const,
    };

    it("成功批量更新菜单", async () => {
      mockPrismaMenu.updateMany.mockResolvedValue({ count: 2 });

      const { updateMenus } = await import("@/actions/menu");
      const result = await updateMenus(baseParams);

      expect(result.success).toBe(true);
      expect(result.data!.updated).toBe(2);
      expect(mockPrismaMenu.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["menu-1", "menu-2"] } },
        data: { status: "ACTIVE" },
      });
    });

    it("更新多个字段", async () => {
      mockPrismaMenu.updateMany.mockResolvedValue({ count: 2 });

      const { updateMenus } = await import("@/actions/menu");
      await updateMenus({
        access_token: "admin-token",
        ids: ["menu-1"],
        status: "SUSPENDED",
        category: "OUTSITE",
        order: 99,
      });

      expect(mockPrismaMenu.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["menu-1"] } },
        data: { status: "SUSPENDED", category: "OUTSITE", order: 99 },
      });
    });

    it("ids 为空数组时验证失败", async () => {
      const { updateMenus } = await import("@/actions/menu");
      const result = await updateMenus({
        access_token: "admin-token",
        ids: [],
      });

      expect(result.success).toBe(false);
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { updateMenus } = await import("@/actions/menu");
      const result = await updateMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { updateMenus } = await import("@/actions/menu");
      const result = await updateMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库更新异常返回 500", async () => {
      mockPrismaMenu.updateMany.mockRejectedValue(new Error("DB error"));

      const { updateMenus } = await import("@/actions/menu");
      const result = await updateMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("批量更新菜单失败");
    });
  });

  // =========================================================================
  // deleteMenus
  // =========================================================================
  describe("deleteMenus", () => {
    const baseParams = {
      access_token: "admin-token",
      ids: ["menu-1", "menu-2"],
    };

    it("成功批量删除菜单", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([
        { id: "menu-1", name: "菜单1" },
        { id: "menu-2", name: "菜单2" },
      ]);
      mockPrismaMenu.deleteMany.mockResolvedValue({ count: 2 });

      const { deleteMenus } = await import("@/actions/menu");
      const result = await deleteMenus(baseParams);

      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(2);
      expect(mockPrismaMenu.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["menu-1", "menu-2"] } },
      });
    });

    it("先查询待删除菜单信息（用于审计日志）", async () => {
      const menusToDelete = [
        { id: "menu-1", name: "菜单1" },
        { id: "menu-2", name: "菜单2" },
      ];
      mockPrismaMenu.findMany.mockResolvedValue(menusToDelete);
      mockPrismaMenu.deleteMany.mockResolvedValue({ count: 2 });

      const { deleteMenus } = await import("@/actions/menu");
      await deleteMenus(baseParams);

      expect(mockPrismaMenu.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["menu-1", "menu-2"] } },
      });
    });

    it("ids 为空数组时验证失败", async () => {
      const { deleteMenus } = await import("@/actions/menu");
      const result = await deleteMenus({
        access_token: "admin-token",
        ids: [],
      });

      expect(result.success).toBe(false);
    });

    it("速率限制触发时返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);

      const { deleteMenus } = await import("@/actions/menu");
      const result = await deleteMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOO_MANY_REQUESTS");
    });

    it("非管理员用户返回 401", async () => {
      mockAuthVerify.mockResolvedValue(null);

      const { deleteMenus } = await import("@/actions/menu");
      const result = await deleteMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("需要管理员权限");
    });

    it("数据库删除异常返回 500", async () => {
      mockPrismaMenu.findMany.mockResolvedValue([]);
      mockPrismaMenu.deleteMany.mockRejectedValue(new Error("DB error"));

      const { deleteMenus } = await import("@/actions/menu");
      const result = await deleteMenus(baseParams);

      expect(result.success).toBe(false);
      expect(result.message).toBe("批量删除菜单失败");
    });
  });
});
