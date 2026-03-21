import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as messaging from "../src/utils/messaging";
import * as paths from "../src/utils/paths";

let terminalAdapter: any = null;

vi.mock("@mariozechner/pi-coding-agent", () => ({}));
vi.mock("@mariozechner/pi-ai", () => ({
  StringEnum: (values: string[]) => values,
}));
vi.mock("@sinclair/typebox", () => ({
  Type: {
    Object: (shape: unknown) => shape,
    String: (options?: unknown) => options ?? {},
    Optional: (value: unknown) => value,
    Boolean: (options?: unknown) => options ?? {},
    Number: (options?: unknown) => options ?? {},
  },
}));
vi.mock("../src/adapters/terminal-registry", () => ({
  getTerminalAdapter: () => terminalAdapter,
}));
vi.mock("../src/adapters/iterm2-adapter", () => ({
  Iterm2Adapter: class {},
}));

describe("pi-teams lead inbox polling", () => {
  afterEach(() => {
    terminalAdapter = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts polling for lead messages after team_create in the current session", async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const teamName = `lead-poll-${Date.now()}`;
    const teamDir = paths.teamDir(teamName);
    const tasksDir = paths.taskDir(teamName);

    const handlers = new Map<string, Function>();
    const tools = new Map<string, any>();
    const pi = {
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      }),
      registerTool: vi.fn((tool: any) => {
        tools.set(tool.name, tool);
      }),
      sendUserMessage: vi.fn(),
    };
    const ctx = {
      cwd: process.cwd(),
      isIdle: vi.fn(() => true),
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setTitle: vi.fn(),
      },
    };

    try {
      const extension = await import("./index");
      extension.default(pi as any);

      const sessionStart = handlers.get("session_start");
      expect(sessionStart).toBeTypeOf("function");
      await sessionStart?.({}, ctx);

      const teamCreate = tools.get("team_create");
      expect(teamCreate).toBeDefined();
      await teamCreate.execute("tool-1", { team_name: teamName }, undefined, undefined, ctx);

      await messaging.sendPlainMessage(teamName, "worker-1", "team-lead", "done", "done");
      await vi.advanceTimersByTimeAsync(30000);

      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        "I have 1 new message(s) in my inbox. Reading them now..."
      );
    } finally {
      if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true, force: true });
      if (fs.existsSync(teamDir)) fs.rmSync(teamDir, { recursive: true, force: true });
    }
  });

  it("clears a teammate inbox before respawn so old unread work is not replayed", async () => {
    vi.resetModules();

    const teamName = `respawn-${Date.now()}`;
    const teamDir = paths.teamDir(teamName);
    const tasksDir = paths.taskDir(teamName);

    terminalAdapter = {
      name: "tmux",
      supportsWindows: vi.fn(() => false),
      spawn: vi.fn(() => "%worker-1"),
    };

    const handlers = new Map<string, Function>();
    const tools = new Map<string, any>();
    const pi = {
      on: vi.fn((eventName: string, handler: Function) => {
        handlers.set(eventName, handler);
      }),
      registerTool: vi.fn((tool: any) => {
        tools.set(tool.name, tool);
      }),
      sendUserMessage: vi.fn(),
    };
    const ctx = {
      cwd: process.cwd(),
      isIdle: vi.fn(() => true),
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setTitle: vi.fn(),
      },
    };

    try {
      const extension = await import("./index");
      extension.default(pi as any);

      const teamCreate = tools.get("team_create");
      expect(teamCreate).toBeDefined();
      await teamCreate.execute("tool-1", { team_name: teamName }, undefined, undefined, ctx);

      await messaging.sendPlainMessage(teamName, "team-lead", "worker-1", "old task", "old task");

      const spawnTeammate = tools.get("spawn_teammate");
      expect(spawnTeammate).toBeDefined();
      await spawnTeammate.execute(
        "tool-2",
        {
          team_name: teamName,
          name: "worker-1",
          prompt: "new task",
          cwd: process.cwd(),
        },
        undefined,
        undefined,
        ctx
      );

      const inbox = await messaging.readInbox(teamName, "worker-1", false, false);
      expect(inbox).toHaveLength(1);
      expect(inbox[0].text).toBe("new task");
      expect(inbox[0].summary).toBe("Initial prompt");
    } finally {
      if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true, force: true });
      if (fs.existsSync(teamDir)) fs.rmSync(teamDir, { recursive: true, force: true });
    }
  });
});
