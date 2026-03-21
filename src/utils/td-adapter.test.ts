import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

import { TdAdapter } from "./td-adapter";

function tdResult(
  stdout = "",
  status = 0,
  stderr = ""
): { stdout: string; stderr: string; status: number } {
  return { stdout, stderr, status };
}

function taskJson(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    title: `Task ${id}`,
    description: `Description ${id}`,
    status: "open",
    type: "task",
    priority: "P2",
    labels: null,
    parentId: "",
    points: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    implementerSession: "ses_test",
    reviewerSession: "",
    logs: [],
    acceptance: "",
    minor: false,
    ...overrides,
  });
}

describe("TdAdapter", () => {
  let adapter: TdAdapter;

  beforeEach(() => {
    spawnSyncMock.mockReset();
    adapter = new TdAdapter("/tmp/td-adapter-unit");
  });

  it("detects td from a successful list call", () => {
    spawnSyncMock.mockReturnValue(tdResult(""));
    expect(adapter.detect()).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "td",
      ["list"],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit", encoding: "utf-8", timeout: 10000 })
    );
  });

  it("initializes td with init", () => {
    spawnSyncMock.mockReturnValue(tdResult(""));
    expect(adapter.init()).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "td",
      ["init"],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit", encoding: "utf-8", timeout: 10000 })
    );
  });

  it("creates a task and fetches the created record", () => {
    spawnSyncMock
      .mockReturnValueOnce(tdResult("CREATED td-abc123\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-abc123")));

    const task = adapter.create("Implement auth flow", "OAuth2 login", {
      type: "feature",
      priority: "P1",
      labels: ["auth", "backend"],
      acceptance: "Login succeeds",
    });

    expect(task?.id).toBe("td-abc123");
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      "td",
      [
        "create",
        "Implement auth flow",
        "-d",
        "OAuth2 login",
        "-t",
        "feature",
        "-p",
        "P1",
        "-l",
        "auth,backend",
        "--acceptance",
        "Login succeeds",
      ],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit" })
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      "td",
      ["show", "td-abc123", "--format", "json"],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit" })
    );
  });

  it("lists tasks by parsing ids and hydrating each task", () => {
    spawnSyncMock
      .mockReturnValueOnce(tdResult("td-1 [P1] One\ntd-2 [P2] Two\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-1")))
      .mockReturnValueOnce(tdResult(taskJson("td-2", { type: "bug" })));

    const tasks = adapter.list({ type: "task" });

    expect(tasks.map(task => task.id)).toEqual(["td-1", "td-2"]);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      "td",
      ["list", "--type", "task"],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit" })
    );
  });

  it("updates a task and re-reads it", () => {
    spawnSyncMock
      .mockReturnValueOnce(tdResult("UPDATED td-1\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-1", { status: "in_progress" })));

    const task = adapter.update("td-1", {
      title: "Updated title",
      status: "in_progress",
      labels: ["fast"],
    });

    expect(task?.status).toBe("in_progress");
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      "td",
      ["update", "td-1", "--title", "Updated title", "--status", "in_progress", "-l", "fast"],
      expect.objectContaining({ cwd: "/tmp/td-adapter-unit" })
    );
  });

  it("runs workflow commands with the expected arguments", () => {
    spawnSyncMock.mockReturnValue(tdResult(""));

    expect(adapter.start("td-1")).toBe(true);
    expect(adapter.stop("td-1")).toBe(true);
    expect(adapter.log("Progress update")).toBe(true);
    expect(adapter.log("Architecture choice", "decision")).toBe(true);
    expect(adapter.log("Blocked on API", "blocker")).toBe(true);
    expect(adapter.submitReview("td-1")).toBe(true);
    expect(adapter.approve("td-1")).toBe(true);
    expect(adapter.reject("td-1", "Missing tests")).toBe(true);
    expect(adapter.close("td-1")).toBe(true);
    expect(adapter.reopen("td-1")).toBe(true);

    expect(spawnSyncMock.mock.calls.map(call => call[1])).toEqual([
      ["start", "td-1"],
      ["unstart", "td-1"],
      ["log", "Progress update"],
      ["log", "Architecture choice", "--decision"],
      ["log", "Blocked on API", "--blocker"],
      ["review", "td-1"],
      ["approve", "td-1"],
      ["reject", "td-1", "--reason", "Missing tests"],
      ["close", "td-1"],
      ["reopen", "td-1"],
    ]);
  });

  it("records handoff via td handoff stdin and falls back to a decision log", () => {
    spawnSyncMock.mockReturnValueOnce(tdResult("", 0));

    expect(
      adapter.handoff({
        done: "Built login flow",
        remaining: "Add refresh tokens",
        decision: "Use JWT",
        uncertain: "Rotation policy",
      })
    ).toBe(true);

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      "td",
      ["handoff"],
      expect.objectContaining({
        cwd: "/tmp/td-adapter-unit",
        input: expect.stringContaining("done:\n  - Built login flow"),
      })
    );

    spawnSyncMock.mockReset();
    spawnSyncMock
      .mockReturnValueOnce(tdResult("", 1, "handoff failed"))
      .mockReturnValueOnce(tdResult("", 0));

    expect(
      adapter.handoff({
        done: "Built login flow",
        remaining: "Add refresh tokens",
        decision: "Use JWT",
        uncertain: "",
      })
    ).toBe(true);

    expect(spawnSyncMock.mock.calls.map(call => call[1])).toEqual([
      ["handoff"],
      ["log", "HANDOFF: done=[Built login flow] remaining=[Add refresh tokens] decision=[Use JWT]", "--decision"],
    ]);
  });

  it("parses next, current, dependencies, usage, search, and query responses", () => {
    spawnSyncMock
      .mockReturnValueOnce(tdResult('{"id":"td-next","title":"Next task"}'))
      .mockReturnValueOnce(tdResult('{"id":"td-current","title":"Current task"}'))
      .mockReturnValueOnce(tdResult("td-a depends on something\ntd-b blocked by something\n"))
      .mockReturnValueOnce(tdResult("usage summary"))
      .mockReturnValueOnce(tdResult("td-s [P1] Search result\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-s")))
      .mockReturnValueOnce(tdResult("td-q\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-q", { priority: "P0" })));

    expect(adapter.next()?.id).toBe("td-next");
    expect(adapter.current()?.id).toBe("td-current");
    expect(adapter.getDependencies("td-deps")).toEqual({
      dependsOn: ["td-a"],
      blockedBy: ["td-b"],
    });
    expect(adapter.usage()).toBe("usage summary");
    expect(adapter.search("auth").map(task => task.id)).toEqual(["td-s"]);
    expect(adapter.query("priority <= P1").map(task => task.id)).toEqual(["td-q"]);
  });

  it("creates epics and extracts session ids", () => {
    spawnSyncMock
      .mockReturnValueOnce(tdResult("CREATED td-epic1\n"))
      .mockReturnValueOnce(tdResult(taskJson("td-epic1", { type: "epic" })))
      .mockReturnValueOnce(tdResult("Session: ses_abc123\n"));

    const epic = adapter.createEpic("Epic title long enough", {
      priority: "P0",
      description: "Epic description",
    });

    expect(epic?.type).toBe("epic");
    expect(adapter.getSessionId()).toBe("ses_abc123");
  });
});
