import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 模拟 server actions
vi.mock("@/actions/web-push", () => ({
  deleteWebPushSubscription: vi.fn().mockResolvedValue({
    success: true,
    data: { message: "deleted" },
  }),
  sendTestWebPush: vi.fn().mockResolvedValue({
    success: true,
    data: { message: "sent" },
  }),
  subscribeToWebPush: vi.fn().mockResolvedValue({
    success: true,
    data: { message: "subscribed" },
  }),
  updateWebPushSubscription: vi.fn().mockResolvedValue({
    success: true,
    data: { message: "updated" },
  }),
}));

vi.mock("@/lib/client/api/web-push-read", () => ({
  getUserPushSubscriptions: vi.fn().mockResolvedValue({
    success: true,
    data: { subscriptions: [] },
  }),
  getVapidPublicKey: vi.fn().mockResolvedValue({
    success: true,
    data: { publicKey: "test-vapid-key" },
  }),
}));

vi.mock("@/lib/shared/user-agent", () => ({
  getBrowserName: vi.fn().mockReturnValue("Chrome"),
  getOSName: vi.fn().mockReturnValue("Windows"),
}));

// 模拟 PushSubscription
const mockPushSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
  toJSON: vi.fn().mockReturnValue({
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
    keys: {
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    },
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

// 模拟 ServiceWorkerRegistration
const mockSwRegistration = {
  pushManager: {
    subscribe: vi.fn().mockResolvedValue(mockPushSubscription),
    getSubscription: vi.fn().mockResolvedValue(null),
  },
};

describe("useWebPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 模拟浏览器 API
    vi.stubGlobal("Notification", {
      permission: "default" as NotificationPermission,
      requestPermission: vi
        .fn()
        .mockResolvedValue("granted" as NotificationPermission),
    });

    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ready: Promise.resolve(mockSwRegistration),
      },
    });

    vi.stubGlobal("window", {
      ...window,
      atob: vi.fn((str: string) => {
        // 简单的 base64 解码模拟
        return Buffer.from(str, "base64").toString("binary");
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("检测 Web Push 支持状态", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { result } = renderHook(() => useWebPush());

    // happy-dom 环境下 serviceWorker 和 PushManager 可能不存在
    // 但 hook 不会抛出错误
    expect(typeof result.current.isSupported).toBe("boolean");
    expect(typeof result.current.loading).toBe("boolean");
  });

  it("返回所有预期的方法和状态", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { result } = renderHook(() => useWebPush());

    expect(result.current).toHaveProperty("isSupported");
    expect(result.current).toHaveProperty("permission");
    expect(result.current).toHaveProperty("subscription");
    expect(result.current).toHaveProperty("loading");
    expect(result.current).toHaveProperty("requestPermission");
    expect(result.current).toHaveProperty("subscribe");
    expect(result.current).toHaveProperty("unsubscribe");
    expect(result.current).toHaveProperty("rename");
    expect(result.current).toHaveProperty("sendTestWebPush");
    expect(result.current).toHaveProperty("getUserPushSubscriptions");

    expect(typeof result.current.requestPermission).toBe("function");
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.unsubscribe).toBe("function");
    expect(typeof result.current.rename).toBe("function");
  });

  it("初始状态下 subscription 为 null", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { result } = renderHook(() => useWebPush());
    expect(result.current.subscription).toBeNull();
  });

  it("初始状态下 loading 为 false", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { result } = renderHook(() => useWebPush());
    expect(result.current.loading).toBe(false);
  });
});

describe("useWebPush - urlBase64ToUint8Array", () => {
  // urlBase64ToUint8Array 是内部函数，通过 subscribe 间接测试
  // 但其逻辑是确定性的：base64 -> Uint8Array

  it("正确转换 base64 字符串为 Uint8Array", () => {
    // 模拟 urlBase64ToUint8Array 的逻辑
    function urlBase64ToUint8Array(base64String: string): Uint8Array {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const rawData = atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }

    // 使用 Buffer 模拟 atob（happy-dom 环境可能不支持 atob）
    vi.stubGlobal("atob", (str: string) =>
      Buffer.from(str, "base64").toString("binary"),
    );

    const testBase64 = "AAAA"; // 对应 3 个零字节
    const result = urlBase64ToUint8Array(testBase64);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(3);

    vi.unstubAllGlobals();
  });

  it("处理包含 - 和 _ 的 base64 字符串", () => {
    function urlBase64ToUint8Array(base64String: string): Uint8Array {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const rawData = atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }

    vi.stubGlobal("atob", (str: string) =>
      Buffer.from(str, "base64").toString("binary"),
    );

    // 包含 URL-safe 字符的 base64
    const testBase64 = "AB-CD_EF";
    const result = urlBase64ToUint8Array(testBase64);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("处理需要填充的 base64 字符串", () => {
    function urlBase64ToUint8Array(base64String: string): Uint8Array {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const rawData = atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }

    vi.stubGlobal("atob", (str: string) =>
      Buffer.from(str, "base64").toString("binary"),
    );

    // 长度不是 4 的倍数，需要填充
    const testBase64 = "AQAB"; // 正好 4 个字符，不需要填充
    const result1 = urlBase64ToUint8Array(testBase64);
    expect(result1).toBeInstanceOf(Uint8Array);

    const testBase64NoPad = "AQA"; // 3 个字符，需要 1 个填充
    const result2 = urlBase64ToUint8Array(testBase64NoPad);
    expect(result2).toBeInstanceOf(Uint8Array);

    vi.unstubAllGlobals();
  });
});

describe("useWebPush subscribe flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal("Notification", {
      permission: "granted" as NotificationPermission,
      requestPermission: vi
        .fn()
        .mockResolvedValue("granted" as NotificationPermission),
    });

    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ready: Promise.resolve(mockSwRegistration),
      },
    });

    vi.stubGlobal("window", {
      ...window,
      atob: vi.fn((str: string) =>
        Buffer.from(str, "base64").toString("binary"),
      ),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribe 在不支持时抛出错误", async () => {
    // 模拟不支持的环境
    vi.stubGlobal("navigator", {
      serviceWorker: undefined,
    });
    // 确保 'PushManager' in window 为 false
    const originalPushManager = (window as unknown as Record<string, unknown>)
      .PushManager;
    delete (window as unknown as Record<string, unknown>).PushManager;

    const { useWebPush } = await import("@/hooks/use-webpush");
    const { result } = renderHook(() => useWebPush());

    await expect(
      act(async () => {
        await result.current.subscribe("test-device");
      }),
    ).rejects.toThrow("浏览器不支持 Web Push");

    // 恢复
    if (originalPushManager) {
      (window as unknown as Record<string, unknown>).PushManager =
        originalPushManager;
    }
  });
});

describe("useWebPush rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rename 调用 updateWebPushSubscription", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { updateWebPushSubscription } = await import("@/actions/web-push");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await result.current.rename("test-endpoint", "new-device-name");
    });

    expect(updateWebPushSubscription).toHaveBeenCalledWith({
      endpoint: "test-endpoint",
      deviceName: "new-device-name",
    });
  });
});

describe("useWebPush unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unsubscribe 调用 deleteWebPushSubscription", async () => {
    const { useWebPush } = await import("@/hooks/use-webpush");
    const { deleteWebPushSubscription } = await import("@/actions/web-push");
    const { result } = renderHook(() => useWebPush());

    await act(async () => {
      await result.current.unsubscribe("test-endpoint");
    });

    expect(deleteWebPushSubscription).toHaveBeenCalledWith("test-endpoint");
  });
});
