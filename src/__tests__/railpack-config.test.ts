import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// `npm start` stays resident as the parent of next-server and holds about 28 MB of billed RAM (FOO-1181).
describe("railpack.json start command", () => {
  it("starts Next.js with node, without npm", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "railpack.json"), "utf8")) as {
      deploy: { startCommand?: string };
    };

    expect(config.deploy.startCommand).toBe("node node_modules/next/dist/bin/next start");
  });
});
