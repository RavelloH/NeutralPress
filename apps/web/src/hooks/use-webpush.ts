"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@repo/shared-types/api/common";

import {
  deleteWebPushSubscription,
  sendTestWebPush,
  subscribeToWebPush,
  updateWebPushSubscription,
} from "@/actions/web-push";
import {
  getUserPushSubscriptions,
  getVapidPublicKey,
} from "@/lib/client/api/web-push-read";
import { getBrowserName, getOSName } from "@/lib/shared/user-agent";

/**
 * Web Push Hook
 *
 * 提供 Web Push 订阅管理功能
 */
export function useWebPush() {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  /**
   * 请求通知权限
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      throw new Error("浏览器不支持 Web Push");
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [isSupported]);

  /**
   * 订阅推送
   *
   * @param deviceName - 设备名称
   */
  const subscribe = useCallback(
    async (deviceName: string) => {
      if (!isSupported) {
        throw new Error("浏览器不支持 Web Push");
      }

      if (permission !== "granted") {
        const perm = await requestPermission();
        if (perm !== "granted") {
          throw new Error("用户拒绝通知权限");
        }
      }

      setLoading(true);

      try {
        // 获取 Service Worker 注册
        const swReg = await navigator.serviceWorker.ready;

        // 获取 VAPID 公钥
        const keyResult = (await getVapidPublicKey()) as ApiResponse<{
          publicKey: string;
        } | null>;
        if (!keyResult.success || !keyResult.data) {
          throw new Error(keyResult.message || "无法获取 VAPID 公钥");
        }

        const publicKey = keyResult.data.publicKey;

        // 订阅推送
        const pushSubscription = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            publicKey,
          ) as BufferSource,
        });

        // 提取订阅信息
        const subscriptionJSON = pushSubscription.toJSON();
        const endpoint = subscriptionJSON.endpoint!;
        const p256dh = subscriptionJSON.keys!.p256dh!;
        const auth = subscriptionJSON.keys!.auth!;

        // 获取设备信息
        const ua = navigator.userAgent;
        const browser = getBrowserName(ua);
        const os = getOSName(ua);

        // 发送到服务器
        const result = (await subscribeToWebPush({
          endpoint,
          p256dh,
          auth,
          deviceName,
          userAgent: ua,
          browser,
          os,
        })) as ApiResponse<{ message: string } | null>;

        if (result.success) {
          setSubscription(pushSubscription);
        }

        return result;
      } finally {
        setLoading(false);
      }
    },
    [isSupported, permission, requestPermission],
  );

  /**
   * 取消订阅
   *
   * @param endpoint - 订阅端点
   */
  const unsubscribe = useCallback(
    async (endpoint: string) => {
      setLoading(true);

      try {
        // 从服务器删除
        const result = (await deleteWebPushSubscription(
          endpoint,
        )) as ApiResponse<{ message: string } | null>;

        // 从浏览器取消订阅
        if (subscription && subscription.endpoint === endpoint) {
          await subscription.unsubscribe();
          setSubscription(null);
        }

        return result;
      } finally {
        setLoading(false);
      }
    },
    [subscription],
  );

  /**
   * 更新订阅（重命名）
   *
   * @param endpoint - 订阅端点
   * @param deviceName - 新设备名称
   */
  const rename = useCallback(async (endpoint: string, deviceName: string) => {
    setLoading(true);

    try {
      const result = (await updateWebPushSubscription({
        endpoint,
        deviceName,
      })) as ApiResponse<{ message: string } | null>;
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    subscription,
    loading,
    requestPermission,
    subscribe,
    unsubscribe,
    rename,
    sendTestWebPush,
    getUserPushSubscriptions,
  };
}

/**
 * 将 base64 字符串转换为 Uint8Array
 *
 * @param base64String - base64 编码的字符串
 * @returns Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
