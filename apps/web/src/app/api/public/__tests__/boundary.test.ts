// @vitest-environment node
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const webSrc = path.resolve(process.cwd(), "src");

function collectRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRoutes(filename);
    return entry.name === "route.ts" || entry.name === "route.tsx"
      ? [filename]
      : [];
  });
}

/**
 * Enforce the migration's architectural boundary:
 * externally reachable API handlers must never import Server Action modules.
 * Actions remain as backward-compatible adapters over server-only services.
 */
describe("public API dependency boundary", () => {
  it("all public Route Handlers call services rather than actions", () => {
    const routes = collectRoutes(path.join(webSrc, "app/api/public"));
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, route).not.toMatch(/["']@\/actions\//);
    }
  });

  it("public API client helpers never depend on Server Actions", () => {
    for (const file of ["public.ts", "search-stats.ts"]) {
      const source = readFileSync(
        path.join(webSrc, "lib/client/api", file),
        "utf8",
      );
      expect(source, file).not.toMatch(/["']@\/actions\//);
    }
  });

  it("server-only services never depend on Server Action modules", () => {
    for (const file of ["search.ts", "notice.ts", "search-stats.ts"]) {
      const source = readFileSync(
        path.join(webSrc, "lib/server/services", file),
        "utf8",
      );
      expect(source, file).toContain('import "server-only"');
      expect(source, file).not.toMatch(/["']@\/actions\//);
    }
  });
});
