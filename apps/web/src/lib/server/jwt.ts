import "server-only";

import type { KeyObject } from "crypto";
import { createPrivateKey, createPublicKey } from "crypto";
import type { SignOptions, VerifyOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";

interface TokenSignOptions {
  inner: Record<string, unknown>;
  expired?: number | string;
}

export type AccessTokenPayload = {
  type: "access";
  uid: number;
  sessionId: string;
  username: string;
  nickname: string;
  role: string;
  iat: number;
  exp: number;
};

export type RefreshTokenPayload = {
  uid: number;
  tokenId: string;
  iat: number;
  exp: number;
};

export type TotpTokenPayload = {
  uid: number;
  type: "totp_verification";
  purpose: "login" | "reauth";
  sessionId?: string;
  iat: number;
  exp: number;
};

let cachedPrivateKey: KeyObject | null = null;
let cachedPublicKey: KeyObject | null = null;

const PEM_PREFIX = "-----";
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

function normalizeJwtKey(key: string): string {
  const unescaped = key.replace(/\\n/g, "\n").trim();
  if (!unescaped) {
    return "";
  }

  if (unescaped.startsWith(PEM_PREFIX)) {
    return unescaped;
  }

  const compact = unescaped.replace(/\s+/g, "");
  if (!BASE64_KEY_PATTERN.test(compact)) {
    return unescaped;
  }

  const normalizedBase64 = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalizedBase64.padEnd(
    normalizedBase64.length + ((4 - (normalizedBase64.length % 4)) % 4),
    "=",
  );

  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8").trim();
    if (decoded.startsWith(PEM_PREFIX)) {
      return decoded;
    }
  } catch {
    // ignore invalid base64
  }

  return unescaped;
}

function getPrivateKey(): KeyObject {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const key = process.env.JWT_PRIVATE_KEY;
  if (!key) {
    throw new Error("JWT_PRIVATE_KEY environment variable is not set");
  }

  cachedPrivateKey = createPrivateKey({
    key: normalizeJwtKey(key),
    format: "pem",
  });
  return cachedPrivateKey;
}

function getPublicKey(): KeyObject {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  const key = process.env.JWT_PUBLIC_KEY;
  if (!key) {
    throw new Error("JWT_PUBLIC_KEY environment variable is not set");
  }

  cachedPublicKey = createPublicKey({
    key: normalizeJwtKey(key),
    format: "pem",
  });
  return cachedPublicKey;
}

export function jwtTokenSign({ inner, expired = "7d" }: TokenSignOptions) {
  const signOptions: SignOptions = {
    algorithm: "ES256",
    header: {
      typ: "JWT",
      alg: "ES256",
    } as SignOptions["header"],
  };

  if (!("exp" in inner)) {
    signOptions.expiresIn = expired as SignOptions["expiresIn"];
  }

  return jwt.sign(inner, getPrivateKey(), signOptions);
}

export function jwtTokenVerify<T = AccessTokenPayload>(
  tokenText: string,
): T | null {
  if (!tokenText) {
    return null;
  }

  const verifyOptions: VerifyOptions = {
    algorithms: ["ES256"],
  };

  try {
    const decoded = jwt.verify(tokenText, getPublicKey(), verifyOptions);

    // 如果是字符串类型，尝试解析为JSON对象
    if (typeof decoded === "string") {
      try {
        return JSON.parse(decoded) as T;
      } catch {
        return null;
      }
    }

    // 确保返回的是对象而不是其他类型
    if (typeof decoded === "object" && decoded !== null) {
      return decoded as T;
    }

    return null;
  } catch (error) {
    console.error(
      "JWT verification error:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}
