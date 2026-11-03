import { getUnreadNoticeCount } from "@/lib/server/services/notice";

/**
 * Client-facing but authenticated API. The server action's existing
 * session/role verification and rate limit remain authoritative.
 *
 * Never cache notification counts at shared proxies or in the browser.
 */
export const runtime = "nodejs";

export async function GET() {
  const response = await getUnreadNoticeCount({ environment: "serverless" });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
