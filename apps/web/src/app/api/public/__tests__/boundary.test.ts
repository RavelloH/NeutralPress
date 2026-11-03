// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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
 * Prevent a regression back to browser-side Server Actions after migration.
 * Every new GET/POST Route Handler must depend on services, not actions.
 */
describe("public API dependency boundary", () => {
  it("all public Route Handlers call services rather than actions", () => {
    const routes = collectRoutes(path.join(webSrc, "app/api/public"));
    expect(routes.length).toBeGreaterThanOrEqual(20);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, route).not.toMatch(/["']@\/actions\//);
    }
  });

  it("all client API helpers stay independent of action modules", () => {
    const directory = path.join(webSrc, "lib/client/api");
    const helpers = readdirSync(directory).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(helpers.length).toBeGreaterThanOrEqual(14);
    for (const file of helpers) {
      const source = readFileSync(path.join(directory, file), "utf8");
      expect(source, file).not.toMatch(/["']@\/actions\//);
    }
  });

  it("all server services stay server-only and independent of action modules", () => {
    const directory = path.join(webSrc, "lib/server/services");
    const services = readdirSync(directory).filter((name) =>
      name.endsWith(".ts"),
    );
    expect(services.length).toBeGreaterThanOrEqual(15);
    for (const file of services) {
      const source = readFileSync(path.join(directory, file), "utf8");
      expect(source, file).toContain('import "server-only"');
      expect(source, file).not.toMatch(/["']@\/actions\//);
    }
    const reauth = readFileSync(
      path.join(webSrc, "lib/server/reauth-verify.ts"),
      "utf8",
    );
    expect(reauth).toContain('import "server-only"');
    expect(reauth).not.toMatch(/["']@\/actions\//);
  });
});
