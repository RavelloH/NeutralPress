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
vi.mock("@/lib/server/auth-verify", () => ({
  authVerify: (...args: unknown[]) => mockAuthVerify(...args),
}));

const mockPrisma = {
  customDictionary: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  post: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  searchLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  $executeRaw: vi.fn(),
};
vi.mock("@/lib/server/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/server/audit", () => ({
  logAuditEvent: vi.fn(),
}));

const mockAnalyzeText = vi.fn().mockResolvedValue(["token1", "token2"]);
vi.mock("@/lib/server/tokenizer", () => ({
  analyzeText: (...args: unknown[]) => mockAnalyzeText(...args),
}));

vi.mock("@/lib/server/search", () => ({
  generateSmartExcerpt: vi.fn().mockReturnValue("excerpt"),
  getLocalDateString: vi.fn().mockReturnValue("2024-01-01"),
  highlightTitle: vi.fn().mockReturnValue("<b>title</b>"),
  markdownToPlainText: vi.fn().mockResolvedValue("plain text"),
}));

vi.mock("@/lib/server/get-client-info", () => ({
  getClientIP: vi.fn().mockResolvedValue("127.0.0.1"),
  getClientUserAgent: vi.fn().mockResolvedValue("test-agent"),
}));

vi.mock("@/lib/server/ip-utils", () => ({
  resolveIpLocation: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/server/image-crypto", () => ({
  generateSignature: vi.fn().mockReturnValue("?sig=test"),
}));

vi.mock("@/lib/server/category-utils", () => ({
  batchGetCategoryPaths: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/server/isr-invalidation", () => ({ expireCacheTag: vi.fn() }));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock("@/lib/server/cache", () => ({
  generateCacheKey: vi.fn().mockReturnValue("cache:key"),
  getCache: vi.fn().mockResolvedValue(null),
  setCache: vi.fn(),
}));

// ============ Tests ============

describe("search actions", () => {
  let testTokenize: typeof import("@/actions/search").testTokenize;
  let addCustomWord: typeof import("@/actions/search").addCustomWord;
  let getCustomWords: typeof import("@/actions/search").getCustomWords;
  let deleteCustomWord: typeof import("@/actions/search").deleteCustomWord;
  let indexPosts: typeof import("@/actions/search").indexPosts;
  let searchPosts: typeof import("@/actions/search").searchPosts;
  let searchSite: typeof import("@/actions/search").searchSite;
  let getSearchLogStats: typeof import("@/actions/search").getSearchLogStats;
  let getSearchLogs: typeof import("@/actions/search").getSearchLogs;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLimitControl.mockResolvedValue(true);
    mockAuthVerify.mockResolvedValue(null);
    mockAnalyzeText.mockResolvedValue(["token1", "token2"]);

    const mod = await import("@/actions/search");
    testTokenize = mod.testTokenize;
    addCustomWord = mod.addCustomWord;
    getCustomWords = mod.getCustomWords;
    deleteCustomWord = mod.deleteCustomWord;
    indexPosts = mod.indexPosts;
    searchPosts = mod.searchPosts;
    searchSite = mod.searchSite;
    getSearchLogStats = mod.getSearchLogStats;
    getSearchLogs = mod.getSearchLogs;
  });

  // ==================== testTokenize ====================

  describe("testTokenize", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await testTokenize({ text: "测试文本" });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("未登录时应返回未授权", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn(() => undefined),
          })),
        }));
        const result = await testTokenize({ text: "测试文本" });
        expect(result.success).toBe(false);
      });

      it("非管理员/编辑应返回未授权", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue(null);
        const result = await testTokenize({ text: "测试文本" });
        expect(result.success).toBe(false);
      });

      it("管理员可以使用", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockAnalyzeText.mockResolvedValue(["测试", "文本"]);
        const result = await testTokenize({ text: "测试文本" });
        expect(result.success).toBe(true);
        expect(result.data!.tokens).toEqual(["测试", "文本"]);
      });

      it("编辑可以使用", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 2, role: "EDITOR" });
        mockAnalyzeText.mockResolvedValue(["hello"]);
        const result = await testTokenize({ text: "hello" });
        expect(result.success).toBe(true);
      });
    });

    describe("返回数据", () => {
      it("应返回 tokens 数组和数量", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockAnalyzeText.mockResolvedValue(["中", "文", "分词"]);
        const result = await testTokenize({ text: "中文分词" });
        expect(result.success).toBe(true);
        expect(result.data!.tokens).toEqual(["中", "文", "分词"]);
        expect(result.data!.count).toBe(3);
        expect(result.data!.text).toBe("中文分词");
      });

      it("应返回执行时间", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        const result = await testTokenize({ text: "test" });
        expect(result.success).toBe(true);
        expect(typeof result.data!.duration).toBe("number");
      });
    });

    describe("错误处理", () => {
      it("分词失败时应返回服务器错误", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockAnalyzeText.mockRejectedValue(new Error("分词器不可用"));
        const result = await testTokenize({ text: "test" });
        expect(result.success).toBe(false);
      });
    });
  });

  // ==================== addCustomWord ====================

  describe("addCustomWord", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await addCustomWord({ word: "test" });
        expect(result.success).toBe(false);
      });
    });

    describe("输入验证", () => {
      it("包含空格时应返回失败", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        const result = await addCustomWord({ word: "has space" });
        expect(result.success).toBe(false);
      });

      it("空字符串应返回失败", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        const result = await addCustomWord({ word: "" });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue(null);
        const result = await addCustomWord({ word: "test" });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("已存在的词应返回冲突", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findUnique.mockResolvedValue({
          id: 1,
          word: "test",
        });
        const result = await addCustomWord({ word: "test" });
        expect(result.success).toBe(false);
      });

      it("成功添加新词", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findUnique.mockResolvedValue(null);
        mockPrisma.customDictionary.create.mockResolvedValue({
          id: 1,
          word: "newword",
        });
        mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
        const result = await addCustomWord({ word: "newword" });
        expect(result.success).toBe(true);
        expect(result.data!.word).toBe("newword");
        expect(result.data!.added).toBe(true);
      });
    });
  });

  // ==================== getCustomWords ====================

  describe("getCustomWords", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await getCustomWords({});
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await getCustomWords({});
        expect(result.success).toBe(false);
      });
    });

    describe("返回数据", () => {
      it("成功获取词典列表", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findMany.mockResolvedValue([
          { id: 1, word: "word1", createdAt: new Date("2024-01-01") },
          { id: 2, word: "word2", createdAt: new Date("2024-01-02") },
        ]);
        const result = await getCustomWords({});
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it("空列表应正常返回", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findMany.mockResolvedValue([]);
        const result = await getCustomWords({});
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });
  });

  // ==================== deleteCustomWord ====================

  describe("deleteCustomWord", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await deleteCustomWord({ id: 1 });
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        mockAuthVerify.mockResolvedValue(null);
        const result = await deleteCustomWord({ id: 1 });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("词汇不存在时应返回 404", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findUnique.mockResolvedValue(null);
        const result = await deleteCustomWord({ id: 999 });
        expect(result.success).toBe(false);
      });

      it("成功删除词汇", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.customDictionary.findUnique.mockResolvedValue({
          id: 1,
          word: "test",
        });
        mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
        mockPrisma.customDictionary.delete.mockResolvedValue({});
        const result = await deleteCustomWord({ id: 1 });
        expect(result.success).toBe(true);
        expect(result.data!.deleted).toBe(true);
      });
    });
  });

  // ==================== indexPosts ====================

  describe("indexPosts", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await indexPosts({});
        expect(result.success).toBe(false);
      });
    });

    describe("认证", () => {
      it("非管理员应返回未授权", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue(null);
        const result = await indexPosts({});
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("无文章时应返回 404", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.post.findMany.mockResolvedValue([]);
        const result = await indexPosts({});
        expect(result.success).toBe(false);
      });

      it("成功索引文章", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.post.findMany.mockResolvedValue([
          {
            id: 1,
            slug: "test-post",
            title: "测试文章",
            content: "内容",
            postMode: "MARKDOWN",
          },
        ]);
        mockPrisma.$executeRaw.mockResolvedValue(undefined);
        const result = await indexPosts({});
        expect(result.success).toBe(true);
        expect(result.data!.indexed).toBe(1);
      });

      it("指定 slugs 应只索引指定文章", async () => {
        vi.doMock("next/headers", () => ({
          headers: vi.fn().mockReturnValue(new Headers()),
          cookies: vi.fn(() => ({
            get: vi.fn((name: string) => {
              if (name === "ACCESS_TOKEN") return { value: "test-token" };
              return undefined;
            }),
          })),
        }));
        mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
        mockPrisma.post.findMany.mockResolvedValue([
          {
            id: 1,
            slug: "post-1",
            title: "文章1",
            content: "内容1",
            postMode: "MARKDOWN",
          },
        ]);
        mockPrisma.$executeRaw.mockResolvedValue(undefined);
        const result = await indexPosts({ slugs: ["post-1"] });
        expect(result.success).toBe(true);
        expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { slug: { in: ["post-1"] } },
          }),
        );
      });
    });
  });

  // ==================== searchPosts ====================

  describe("searchPosts", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await searchPosts({
          query: "test",
          page: 1,
          pageSize: 10,
          searchIn: "both",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("业务逻辑", () => {
      it("无分词结果时返回空", async () => {
        mockAnalyzeText.mockResolvedValueOnce([]);
        const result = await searchPosts({
          query: "  ",
          page: 1,
          pageSize: 10,
          searchIn: "both",
        });
        expect(result.success).toBe(true);
        expect(result.data!.posts).toHaveLength(0);
      });

      it("搜索无结果时返回空列表", async () => {
        mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
          { count: BigInt(0) },
        ]);
        const result = await searchPosts({
          query: "nonexistent",
          page: 1,
          pageSize: 10,
          searchIn: "both",
        });
        expect(result.success).toBe(true);
        expect(result.data!.posts).toHaveLength(0);
      });

      it("应返回正确的结果结构", async () => {
        mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
          { count: BigInt(0) },
        ]);
        const result = await searchPosts({
          query: "test",
          page: 1,
          pageSize: 10,
          searchIn: "both",
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("posts");
      });
    });
  });

  // ==================== searchSite ====================

  describe("searchSite", () => {
    describe("速率限制", () => {
      it("速率限制时应返回失败", async () => {
        mockLimitControl.mockResolvedValue(false);
        const result = await searchSite({ query: "test" });
        expect(result.success).toBe(false);
      });
    });

    describe("输入验证", () => {
      it("空查询应返回失败", async () => {
        const result = await searchSite({ query: "   " });
        expect(result.success).toBe(false);
      });
    });
  });

  // ==================== 补充分支覆盖测试 ====================

  describe("deleteIndex", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.deleteIndex({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getIndexStatus", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.getIndexStatus({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchIndexStats", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchIndexStats({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogStats", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchLogStats({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogs", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchLogs({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getPostTokenDetails", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const mod = await import("@/actions/search");
      const result = await mod.getPostTokenDetails({ slug: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteIndex 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.deleteIndex({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getIndexStatus 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.getIndexStatus({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchIndexStats 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchIndexStats({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogStats 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchLogStats({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogs 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.getSearchLogs({} as any);
      expect(result.success).toBe(false);
    });
  });

  describe("getPostTokenDetails 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      mockAuthVerify.mockResolvedValue(null);
      const mod = await import("@/actions/search");
      const result = await mod.getPostTokenDetails({ slug: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("testTokenize 补充测试", () => {
    it("未登录时应返回未授权", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn(() => undefined),
        })),
      }));
      const result = await testTokenize({ text: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("addCustomWord 补充测试", () => {
    it("已存在的词应返回冲突", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.customDictionary.findUnique.mockResolvedValue({
        id: 1,
        word: "test",
      });

      const result = await addCustomWord({ word: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteCustomWord 补充测试 2", () => {
    it("未认证时应返回未授权", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockAuthVerify.mockResolvedValue(null);
      const result = await deleteCustomWord({ id: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("searchSite 补充测试", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchSite({ query: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("getCustomWords 补充测试", () => {
    it("非管理员应返回未授权", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockAuthVerify.mockResolvedValue(null);
      const result = await getCustomWords({});
      expect(result.success).toBe(false);
    });
  });

  describe("searchPosts 补充测试", () => {
    it("数据库错误时返回失败", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error("DB error"));
      const result = await searchPosts({
        query: "test",
        page: 1,
        pageSize: 10,
        searchIn: "both",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("searchSite 补充测试 2", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.post.findMany.mockRejectedValue(new Error("DB error"));
      const result = await searchSite({ query: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("testTokenize 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn(() => undefined),
        })),
      }));
      const result = await testTokenize({ text: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("addCustomWord 补充测试 2", () => {
    it("非管理员应返回未授权", async () => {
      vi.doMock("next/headers", () => ({
        headers: vi.fn().mockReturnValue(new Headers()),
        cookies: vi.fn(() => ({
          get: vi.fn((name: string) => {
            if (name === "ACCESS_TOKEN") return { value: "test-token" };
            return undefined;
          }),
        })),
      }));
      mockAuthVerify.mockResolvedValue(null);
      const result = await addCustomWord({ word: "test" });
      expect(result.success).toBe(false);
    });
  });

  // ===== 分支覆盖补充测试 =====

  describe("searchPosts 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchPosts({
        query: "test",
        page: 1,
        pageSize: 10,
        searchIn: "both",
      });
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("DB error"));
      const result = await searchPosts({
        query: "test",
        page: 1,
        pageSize: 10,
        searchIn: "both",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("searchSite 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await searchSite({ query: "test" });
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("DB error"));
      const result = await searchSite({ query: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogs 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getSearchLogs({
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.searchLog.findMany.mockRejectedValue(new Error("DB error"));
      const result = await getSearchLogs({
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getSearchLogStats 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getSearchLogStats({ days: 30 });
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.searchLog.count.mockRejectedValue(new Error("DB error"));
      const result = await getSearchLogStats({ days: 30 });
      expect(result.success).toBe(false);
    });
  });

  describe("getCustomWords 分支", () => {
    it("速率限制时应返回失败", async () => {
      mockLimitControl.mockResolvedValue(false);
      const result = await getCustomWords({
        page: 1,
        pageSize: 20,
      });
      expect(result.success).toBe(false);
    });

    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.customDictionary.findMany.mockRejectedValue(
        new Error("DB error"),
      );
      const result = await getCustomWords({
        page: 1,
        pageSize: 20,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteCustomWord 分支", () => {
    it("数据库错误时返回失败", async () => {
      mockAuthVerify.mockResolvedValue({ uid: 1, role: "ADMIN" });
      mockPrisma.customDictionary.delete.mockRejectedValue(
        new Error("DB error"),
      );
      const result = await deleteCustomWord({
        id: 1,
      });
      expect(result.success).toBe(false);
    });
  });
});
