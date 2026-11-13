import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";

import { verifyAccessToken } from "@/lib/server/auth-verify";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import { jwtTokenVerify } from "@/lib/server/jwt";

type ReauthTokenPayload = {
  uid: number;
  type: "reauth";
  exp: number;
  ipHash?: string;
  userAgentHash?: string;
};

function hashTokenBindingValue(value: string): string | undefined {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue || normalizedValue === "unknown") {
    return undefined;
  }
  return createHash("sha256")
    .update(normalizedValue)
    .digest("hex")
    .slice(0, 32);
}

export async function getReauthTokenBindings(): Promise<{
  ipHash?: string;
  userAgentHash?: string;
}> {
  const [ip, userAgent] = await Promise.all([
    getClientIP(),
    getClientUserAgent(),
  ]);
  return {
    ipHash: hashTokenBindingValue(ip),
    userAgentHash: hashTokenBindingValue(userAgent),
  };
}

/**
 * 检查是否有有效的 REAUTH_TOKEN，并绑定当前登录用户
 */
export async function checkReauthToken(expectedUid?: number): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const reauthToken = cookieStore.get("REAUTH_TOKEN")?.value;

    if (!reauthToken) {
      return false;
    }

    // 验证 token 是否有效
    const decoded = jwtTokenVerify<ReauthTokenPayload>(reauthToken);
    if (!decoded) {
      return false;
    }

    // 校验 token 类型
    if (decoded.type !== "reauth") {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    // 检查是否过期
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    let verifyUid = expectedUid;

    if (!verifyUid) {
      const accessToken = cookieStore.get("ACCESS_TOKEN")?.value || "";
      const accessDecoded = await verifyAccessToken(accessToken);
      if (!accessDecoded?.uid) {
        return false;
      }
      verifyUid = accessDecoded.uid;
    }

    const isMatched = decoded.uid === verifyUid;
    if (!isMatched) {
      cookieStore.delete("REAUTH_TOKEN");
      return false;
    }

    if (decoded.ipHash || decoded.userAgentHash) {
      const currentBindings = await getReauthTokenBindings();
      if (decoded.ipHash && decoded.ipHash !== currentBindings.ipHash) {
        cookieStore.delete("REAUTH_TOKEN");
        return false;
      }
      if (
        decoded.userAgentHash &&
        decoded.userAgentHash !== currentBindings.userAgentHash
      ) {
        cookieStore.delete("REAUTH_TOKEN");
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Check reauth token error:", error);
    return false;
  }
}
