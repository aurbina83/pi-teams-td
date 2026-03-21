import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { TdAdapter } from "./td-adapter";

const hasTd = spawnSync("td", ["--version"], {
  encoding: "utf-8",
  timeout: 5000,
}).status === 0;

const integration = hasTd ? describe : describe.skip;

integration("TdAdapter integration", () => {
  const testDir = path.join("/tmp", `td-adapter-integration-${Date.now()}`);
  let adapter: TdAdapter;

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    execSync("git init", { cwd: testDir, stdio: "ignore" });
    adapter = new TdAdapter(testDir);
    expect(adapter.init()).toBe(true);
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("creates and reads a task through the real td CLI", () => {
    const task = adapter.create(
      "Integration task title",
      "Created through the real td CLI",
      { type: "feature", priority: "P1" }
    );

    expect(task).not.toBeNull();
    const fetched = adapter.get(task!.id);
    expect(fetched?.id).toBe(task?.id);
    expect(fetched?.description).toBe("Created through the real td CLI");
  });

  it("runs a basic workflow through the real td CLI", () => {
    const task = adapter.create("Workflow task title", "Exercise td workflow");
    expect(task).not.toBeNull();

    expect(adapter.start(task!.id)).toBe(true);
    expect(adapter.log("Progress from integration test")).toBe(true);
    expect(adapter.submitReview(task!.id)).toBe(true);
    expect(adapter.reject(task!.id, "Return to open for further work")).toBe(true);

    const updated = adapter.get(task!.id);
    expect(updated?.status).toBe("open");
    expect(updated?.logs.some(log => log.message.includes("Progress from integration test"))).toBe(true);
  });
});
