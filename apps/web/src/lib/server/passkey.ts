import "server-only";

import { getConfig } from "@/lib/server/config-cache";
import prisma from "@/lib/server/prisma";

/** Check whether Passkey is enabled and enforce the per-user credential limit when a UID is supplied. */
export async function assertPasskeyEnabledAndLimit(
  uid?: number,
): Promise<void> {
  const enabled = await getConfig("user.passkey.enabled");
  if (!enabled) throw new Error("PASSKEY_DISABLED");
  if (uid) {
    const maxPerUser = await getConfig("user.passkey.maxPerUser");
    const count = await prisma.passkey.count({ where: { userUid: uid } });
    if (count >= maxPerUser) throw new Error("PASSKEY_LIMIT_EXCEEDED");
  }
}
