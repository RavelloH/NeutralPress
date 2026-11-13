import "server-only";

import { createHash } from "node:crypto";

import redis, { ensureRedisConnection } from "@/lib/server/redis";

export const DIRECT_UPLOAD_TICKET_TTL_SECONDS = 600;
export const DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export type DirectUploadTicket = {
  version: 1;
  uid: number;
  providerId: string;
  tempKey: string;
  expectedSize: number;
  contentType: string;
  expiresAt: number;
};

type CreateDirectUploadTicketInput = Omit<
  DirectUploadTicket,
  "version" | "expiresAt"
>;

function isGeneratedTempKey(tempKey: string): boolean {
  const parts = tempKey.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "temp" &&
    /^\d{4}$/.test(parts[1] ?? "") &&
    /^(0[1-9]|1[0-2])$/.test(parts[2] ?? "") &&
    Boolean(parts[3]) &&
    // eslint-disable-next-line no-control-regex
    !/[\\\u0000-\u001f]/.test(tempKey) &&
    parts[3] !== "." &&
    parts[3] !== ".."
  );
}

function ticketRedisKey(providerId: string, tempKey: string): string {
  const digest = createHash("sha256")
    .update(providerId)
    .update("\0")
    .update(tempKey)
    .digest("hex");
  return `np:direct-upload:v1:${digest}`;
}

function isDirectUploadTicket(value: unknown): value is DirectUploadTicket {
  if (typeof value !== "object" || value === null) return false;
  const ticket = value as Partial<DirectUploadTicket>;
  return (
    ticket.version === 1 &&
    Number.isSafeInteger(ticket.uid) &&
    typeof ticket.providerId === "string" &&
    typeof ticket.tempKey === "string" &&
    isGeneratedTempKey(ticket.tempKey) &&
    Number.isSafeInteger(ticket.expectedSize) &&
    (ticket.expectedSize ?? 0) > 0 &&
    (ticket.expectedSize ?? 0) <= DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES &&
    typeof ticket.contentType === "string" &&
    ticket.contentType.startsWith("image/") &&
    Number.isSafeInteger(ticket.expiresAt)
  );
}

export async function createDirectUploadTicket(
  input: CreateDirectUploadTicketInput,
): Promise<DirectUploadTicket> {
  if (
    !Number.isSafeInteger(input.uid) ||
    !Number.isSafeInteger(input.expectedSize) ||
    input.expectedSize <= 0 ||
    input.expectedSize > DIRECT_UPLOAD_MAX_FILE_SIZE_BYTES ||
    !input.providerId ||
    !input.contentType.startsWith("image/") ||
    !isGeneratedTempKey(input.tempKey)
  ) {
    throw new Error("直传票据参数无效");
  }

  const ticket: DirectUploadTicket = {
    version: 1,
    ...input,
    expiresAt: Date.now() + DIRECT_UPLOAD_TICKET_TTL_SECONDS * 1000,
  };
  await ensureRedisConnection();
  const result = await redis.set(
    ticketRedisKey(ticket.providerId, ticket.tempKey),
    JSON.stringify(ticket),
    "EX",
    DIRECT_UPLOAD_TICKET_TTL_SECONDS,
    "NX",
  );

  if (result !== "OK") {
    throw new Error("无法创建直传票据");
  }

  return ticket;
}

const CONSUME_TICKET_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end

local ok, ticket = pcall(cjson.decode, raw)
if not ok or type(ticket) ~= "table" then return nil end

if tostring(ticket.uid) ~= ARGV[1] then return nil end
if tostring(ticket.providerId) ~= ARGV[2] then return nil end
if ticket.tempKey ~= ARGV[3] then return nil end

local expiresAt = tonumber(ticket.expiresAt)
if not expiresAt then return nil end
if expiresAt <= tonumber(ARGV[4]) then
  redis.call("DEL", KEYS[1])
  return nil
end

redis.call("DEL", KEYS[1])
return raw
`;

export async function consumeDirectUploadTicket(params: {
  uid: number;
  providerId: string;
  tempKey: string;
}): Promise<DirectUploadTicket | null> {
  if (!isGeneratedTempKey(params.tempKey)) return null;

  await ensureRedisConnection();
  const raw = await redis.eval(
    CONSUME_TICKET_SCRIPT,
    1,
    ticketRedisKey(params.providerId, params.tempKey),
    String(params.uid),
    params.providerId,
    params.tempKey,
    String(Date.now()),
  );

  if (typeof raw !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isDirectUploadTicket(parsed) ||
      parsed.uid !== params.uid ||
      parsed.providerId !== params.providerId ||
      parsed.tempKey !== params.tempKey
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
