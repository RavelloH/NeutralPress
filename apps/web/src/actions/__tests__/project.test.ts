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
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  category: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mediaReference: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  media: {
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/server/config-cache", () => ({
  getConfig: vi.fn(),
}));

vi.mock("@/lib/server/cron-task-runner", () => ({
  runProjectsGithubSync: vi.fn(),
}));

vi.mock("@/lib/server/image-crypto", () => ({
  generateSignature: vi.fn().mockReturnValue("?sig=test"),
}));

vi.mock("@/lib/server/media-reference", () => ({
  findMediaIdByUrl: vi.fn().mockResolvedValue(null),
  getAllFeaturedImageUrls: vi.fn().mockReturnValue([]),
  getFeaturedImageUrl: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/server/slugify", () => ({
  slugify: vi.fn().mockResolvedValue("test-slug"),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("@/types/media", () => ({
  MEDIA_SLOTS: {
    PROJECT_FEATURED_IMAGE: "projectFeaturedImage",
    PROJECT_CONTENT_IMAGE: "projectContentImage",
  },
}));

// ============ Tests ============

describe("project actions", () => {
  let getProjectsList: typeof import("@/actions/project").getProjectsList;
  let getProjectDetail: typeof import("@/actions/project").getProjectDetail;
  let createProject: typeof import("@/actions/project").createProject;
  let updateProject: typeof import("@/actions/project").updateProject;
  let updateProjects: typeof import("@/actions/project").updateProjects;
  let deleteProjects: typeof import("@/actions/project").deleteProjects;
  let getProjectsTrends: typeof import("@/actions/project").getProjectsTrends;
  let syncProjectsGithub: typeof import("@/actions/project").syncProjectsGithub;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    const mod = await import("@/actions/project");
    getProjectsList = mod.getProjectsList;
    getProjectDetail = mod.getProjectDetail;
    createProject = mod.createProject;
    updateProject = mod.updateProject;
    updateProjects = mod.updateProjects;
    deleteProjects = mod.deleteProjects;
    getProjectsTrends = mod.getProjectsTrends;
    syncProjectsGithub = mod.syncProjectsGithub;
  });

  // ---------- getProjectsTrends ----------

  describe("getProjectsTrends", () => {
    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getProjectsTrends({
        access_token: "token",
        days: 30,
        count: 30,
      });
      expect(result.success).toBe(false);
    });

    it("成功获取趋势", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(5);

      const result = await getProjectsTrends({
        access_token: "token",
        days: 7,
        count: 3,
      });
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
    });
  });

  // ---------- getProjectsList ----------

  describe("getProjectsList", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getProjectsList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getProjectsList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("成功获取项目列表", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.count.mockResolvedValue(1);
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 1,
          title: "Test Project",
          slug: "test-project",
          description: "A test project",
          status: "PUBLISHED",
          demoUrl: null,
          repoUrl: null,
          urls: [],
          techStack: ["TypeScript"],
          repoPath: "user/repo",
          stars: 10,
          forks: 2,
          languages: { TypeScript: 100 },
          license: "MIT",
          enableGithubSync: false,
          enableConentSync: false,
          isFeatured: false,
          sortOrder: 0,
          publishedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          startedAt: null,
          completedAt: null,
          author: { uid: 1, username: "admin", nickname: "Admin" },
          categories: [{ name: "Category1" }],
          tags: [{ name: "tag1", slug: "tag1" }],
          mediaRefs: [],
        },
      ]);

      const result = await getProjectsList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.title).toBe("Test Project");
    });
  });

  // ---------- getProjectDetail ----------

  describe("getProjectDetail", () => {
    it("项目不存在时应返回 404", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const result = await getProjectDetail({
        access_token: "token",
        slug: "nonexistent",
      });
      expect(result.success).toBe(false);
    });

    it("AUTHOR 无权访问他人项目时应返回 403", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "AUTHOR" });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 1,
        userUid: 2,
        title: "Other's Project",
      });

      const result = await getProjectDetail({
        access_token: "token",
        slug: "other-project",
      });
      expect(result.success).toBe(false);
    });

    it("成功获取项目详情", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 1,
        title: "Test",
        slug: "test",
        description: "Desc",
        content: "# Hello",
        status: "PUBLISHED",
        demoUrl: null,
        repoUrl: null,
        urls: [],
        techStack: null,
        repoPath: null,
        stars: 0,
        forks: 0,
        languages: null,
        license: null,
        enableGithubSync: false,
        enableConentSync: false,
        isFeatured: false,
        sortOrder: 0,
        metaDescription: null,
        metaKeywords: null,
        robotsIndex: true,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: null,
        completedAt: null,
        userUid: 1,
        author: { uid: 1, username: "admin", nickname: "Admin" },
        categories: [],
        tags: [],
        mediaRefs: [],
      });

      const result = await getProjectDetail({
        access_token: "token",
        slug: "test",
      });
      expect(result.success).toBe(true);
      expect(result.data!.title).toBe("Test");
    });
  });

  // ---------- createProject ----------

  describe("createProject", () => {
    it("slug 已存在时应返回 400", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 99 });

      const result = await createProject({
        access_token: "token",
        title: "New",
        slug: "existing",
      } as any);
      expect(result.success).toBe(false);
    });

    it("成功创建项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.category.findFirst.mockResolvedValue({
        id: 1,
        slug: "uncategorized",
        path: "1",
        depth: 0,
        fullSlug: "uncategorized",
      });
      mockPrisma.project.create.mockResolvedValue({
        id: 1,
        slug: "new-project",
        status: "DRAFT",
        tags: [],
        categories: [],
      });

      const result = await createProject({
        access_token: "token",
        title: "New Project",
        description: "A new project",
      } as any);
      expect(result.success).toBe(true);
      expect(result.data!.id).toBe(1);
    });
  });

  // ---------- deleteProjects ----------

  describe("deleteProjects", () => {
    it("AUTHOR 只能删除自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.updateMany.mockResolvedValue({ count: 0 });

      const result = await deleteProjects({
        access_token: "token",
        ids: [1, 2],
      });
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(0);
    });

    it("成功删除项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 1,
          slug: "test",
          title: "Test",
          status: "PUBLISHED",
          tags: [{ slug: "tag1" }],
          categories: [{ fullSlug: "cat1" }],
        },
      ]);
      mockPrisma.project.updateMany.mockResolvedValue({ count: 1 });

      const result = await deleteProjects({ access_token: "token", ids: [1] });
      expect(result.success).toBe(true);
      expect(result.data!.deleted).toBe(1);
    });

    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteProjects({ access_token: "token", ids: [1] });
      expect(result.success).toBe(false);
    });
  });

  // ---------- 补充测试 ----------

  describe("getProjectsList 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getProjectsList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getProjectsList({
        access_token: "token",
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createProject 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await createProject({
        access_token: "token",
        title: "New Project",
      } as any);
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await createProject({
        access_token: "token",
        title: "New Project",
      } as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getProjectDetail 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getProjectDetail({
        access_token: "token",
        slug: "test",
      });
      expect(result.success).toBe(false);
    });

    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await getProjectDetail({
        access_token: "token",
        slug: "test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getProjectsTrends 补充测试", () => {
    it("速率限制时应返回 429", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getProjectsTrends({
        access_token: "token",
        days: 30,
        count: 30,
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== updateProject 补充测试 ====================

  describe("updateProject", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateProject(
        { access_token: "token", slug: "test", title: "更新" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await updateProject(
        { access_token: "token", slug: "test", title: "更新" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("项目不存在时应返回 404", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue(null);
      const result = await updateProject(
        { access_token: "token", slug: "nonexistent", title: "更新" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("AUTHOR 不能修改他人项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 3, role: "AUTHOR" });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 1,
        userUid: 999,
        slug: "test",
      });
      const result = await updateProject(
        { access_token: "token", slug: "test", title: "更新" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("成功更新项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 1,
        userUid: 1,
        slug: "test",
      });
      mockPrisma.project.update.mockResolvedValue({
        id: 1,
        slug: "test",
        title: "更新后的项目",
      });
      const result = await updateProject(
        { access_token: "token", slug: "test", title: "更新后的项目" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("deleteProjects 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await deleteProjects(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await deleteProjects(
        { access_token: "token", ids: [1] },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("updateProjects 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await updateProjects(
        { access_token: "token", ids: [1], status: "PUBLISHED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑/作者应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await updateProjects(
        { access_token: "token", ids: [1], status: "PUBLISHED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("成功批量更新项目状态", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.updateMany.mockResolvedValue({ count: 2 });
      const result = await updateProjects(
        { access_token: "token", ids: [1, 2], status: "PUBLISHED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.updateMany.mockRejectedValue(new Error("DB error"));
      const result = await updateProjects(
        { access_token: "token", ids: [1], status: "PUBLISHED" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("syncProjectsGithub 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await syncProjectsGithub(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("非管理员/编辑应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const result = await syncProjectsGithub(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });

    it("成功同步 GitHub 项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      const { runProjectsGithubSync } = await import(
        "@/lib/server/cron-task-runner"
      );
      vi.mocked(runProjectsGithubSync).mockResolvedValue({
        synced: 3,
        failed: 0,
        results: [
          { id: 1, slug: "a", success: true },
          { id: 2, slug: "b", success: true },
          { id: 3, slug: "c", success: true },
        ],
      } as any);
      const result = await syncProjectsGithub(
        { access_token: "token" },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("getProjectsList 分支", () => {
    it("AUTHOR 角色过滤到自己的项目", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 5, role: "AUTHOR" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);
      const result = await getProjectsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("带 search 过滤", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);
      const result = await getProjectsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
          search: "test",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(true);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await getProjectsList(
        {
          access_token: "token",
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("createProject 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findMany.mockRejectedValue(new Error("DB error"));
      const result = await createProject(
        {
          access_token: "token",
          title: "Test",
          content: "Content",
          status: "DRAFT",
        } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });

  describe("updateProject 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.project.findUnique.mockRejectedValue(new Error("DB error"));
      const result = await updateProject(
        { access_token: "token", slug: "test", title: "Updated" } as any,
        { environment: "serveraction" },
      );
      expect(result.success).toBe(false);
    });
  });
});
