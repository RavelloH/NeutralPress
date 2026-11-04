"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/web-push-domain";

type WebPushActionEnvironment = "serverless" | "serveraction";

type WebPushActionConfig = { environment?: WebPushActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | ApiResponse<T>
  | NextResponse<ApiResponse<T>>;

export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function subscribeToWebPush(
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    deviceName: string;
    userAgent?: string;
    browser?: string;
    os?: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  return service.subscribeToWebPush(data, serverConfig);
}

export async function getVapidPublicKey(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<{ publicKey: string } | null>>>;
export async function getVapidPublicKey(
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ publicKey: string } | null>>;
export async function getVapidPublicKey(
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ publicKey: string } | null>> {
  return service.getVapidPublicKey(serverConfig);
}

export async function getUserPushSubscriptions(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<
    ApiResponse<{
      subscriptions: Array<{
        id: string;
        deviceName: string;
        browser: string | null;
        os: string | null;
        isActive: boolean;
        createdAt: Date;
        lastUsedAt: Date;
        endpoint: string;
      }>;
    } | null>
  >
>;
export async function getUserPushSubscriptions(
  serverConfig?: WebPushActionConfig,
): Promise<
  ApiResponse<{
    subscriptions: Array<{
      id: string;
      deviceName: string;
      browser: string | null;
      os: string | null;
      isActive: boolean;
      createdAt: Date;
      lastUsedAt: Date;
      endpoint: string;
    }>;
  } | null>
>;
export async function getUserPushSubscriptions(
  serverConfig?: WebPushActionConfig,
): Promise<
  ActionResult<{
    subscriptions: Array<{
      id: string;
      deviceName: string;
      browser: string | null;
      os: string | null;
      isActive: boolean;
      createdAt: Date;
      lastUsedAt: Date;
      endpoint: string;
    }>;
  } | null>
> {
  return service.getUserPushSubscriptions(serverConfig);
}

export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function deleteWebPushSubscription(
  endpoint: string,
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  return service.deleteWebPushSubscription(endpoint, serverConfig);
}

export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function updateWebPushSubscription(
  data: {
    endpoint: string;
    deviceName: string;
  },
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  return service.updateWebPushSubscription(data, serverConfig);
}

export async function sendTestWebPush(serverConfig: {
  environment: "serverless";
}): Promise<NextResponse<ApiResponse<{ message: string } | null>>>;
export async function sendTestWebPush(
  serverConfig?: WebPushActionConfig,
): Promise<ApiResponse<{ message: string } | null>>;
export async function sendTestWebPush(
  serverConfig?: WebPushActionConfig,
): Promise<ActionResult<{ message: string } | null>> {
  return service.sendTestWebPush(serverConfig);
}
