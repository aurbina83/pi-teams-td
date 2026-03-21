/**
 * CmuxAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CmuxAdapter } from "./cmux-adapter";
import * as terminalAdapter from "../utils/terminal-adapter";

describe("CmuxAdapter", () => {
  let adapter: CmuxAdapter;
  let mockExecCommand: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new CmuxAdapter();
    mockExecCommand = vi.spyOn(terminalAdapter, "execCommand");
    delete process.env.CMUX_SOCKET_PATH;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.TMUX;
    delete process.env.ZELLIJ;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("name", () => {
    it("should have the correct name", () => {
      expect(adapter.name).toBe("cmux");
    });
  });

  describe("detect", () => {
    it("should detect when CMUX_SOCKET_PATH is set", () => {
      process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock";
      expect(adapter.detect()).toBe(true);
    });

    it("should detect when CMUX_WORKSPACE_ID is set", () => {
      process.env.CMUX_WORKSPACE_ID = "workspace-123";
      expect(adapter.detect()).toBe(true);
    });

    it("should not detect when neither env var is set", () => {
      expect(adapter.detect()).toBe(false);
    });

    it("should not detect when TMUX is set (defensive - nested)", () => {
      process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock";
      process.env.TMUX = "/tmp/tmux-1000/default,123,0";
      expect(adapter.detect()).toBe(false);
    });

    it("should not detect when ZELLIJ is set (defensive - nested)", () => {
      process.env.CMUX_WORKSPACE_ID = "workspace-123";
      process.env.ZELLIJ = "1";
      expect(adapter.detect()).toBe(false);
    });
  });

  describe("spawn", () => {
    beforeEach(() => {
      process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock";
    });

    it("should spawn a new pane and send the command to it", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface-42", stderr: "", status: 0 })  // new-split
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });               // send

      const result = adapter.spawn({
        name: "test-agent",
        cwd: "/home/user/project",
        command: "pi --agent test",
        env: { PI_AGENT_ID: "test-123" },
      });

      expect(result).toBe("surface-42");
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "right"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["send", "--surface", "surface-42", "cd '/home/user/project' && env PI_AGENT_ID=test-123 pi --agent test\n"]
      );
    });

    it("should spawn without env prefix when no PI_ vars", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface-99", stderr: "", status: 0 })  // new-split
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });               // send

      const result = adapter.spawn({
        name: "test-agent",
        cwd: "/home/user/project",
        command: "pi",
        env: { OTHER: "ignored" },
      });

      expect(result).toBe("surface-99");
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "right"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["send", "--surface", "surface-99", "cd '/home/user/project' && pi\n"]
      );
    });

    it("should throw on spawn failure", () => {
      mockExecCommand.mockReturnValue({ 
        stdout: "", 
        stderr: "cmux not found", 
        status: 1 
      });

      expect(() => adapter.spawn({
        name: "test-agent",
        cwd: "/home/user/project",
        command: "pi",
        env: {},
      })).toThrow("cmux new-split failed with status 1");
    });

    it("should throw on unexpected output format", () => {
      mockExecCommand.mockReturnValue({
        stdout: "ERROR something went wrong",
        stderr: "",
        status: 0
      });

      expect(() => adapter.spawn({
        name: "test-agent",
        cwd: "/home/user/project",
        command: "pi",
        env: {},
      })).toThrow("cmux new-split returned unexpected output");
    });

    it("should parse only the first token as surface ID from multi-token response", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface:8 workspace:2", stderr: "", status: 0 })  // new-split
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });                           // send

      const result = adapter.spawn({
        name: "test-agent",
        cwd: "/project",
        command: "pi",
        env: {},
      });

      expect(result).toBe("surface:8");
    });

    it("should split right for the first spawn, then keep moving the anchor to the newest pane", () => {
      // First spawn: splits right (anchor is null)
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface:1 workspace:1", stderr: "", status: 0 })  // new-split right
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });                           // send

      adapter.spawn({
        name: "agent-1",
        cwd: "/project",
        command: "pi --agent a1",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "right"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["send", "--surface", "surface:1", "cd '/project' && pi --agent a1\n"]
      );

      // Second spawn: splits down, targeting the first surface
      mockExecCommand
        .mockReturnValueOnce({ stdout: "surface:1\nsurface:2", stderr: "", status: 0 })      // list-pane-surfaces
        .mockReturnValueOnce({ stdout: "OK surface:2 workspace:1", stderr: "", status: 0 })  // new-split down
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });                           // send

      adapter.spawn({
        name: "agent-2",
        cwd: "/project",
        command: "pi --agent a2",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "down", "--surface", "surface:1"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["send", "--surface", "surface:2", "cd '/project' && pi --agent a2\n"]
      );

      // Third spawn: splits down on the newest pane, not the original anchor
      mockExecCommand
        .mockReturnValueOnce({ stdout: "surface:1\nsurface:2\nsurface:3", stderr: "", status: 0 }) // list-pane-surfaces for surface:1
        .mockReturnValueOnce({ stdout: "surface:1\nsurface:2\nsurface:3", stderr: "", status: 0 }) // list-pane-surfaces for surface:2
        .mockReturnValueOnce({ stdout: "OK surface:3 workspace:1", stderr: "", status: 0 })  // new-split down
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });                           // send

      adapter.spawn({
        name: "agent-3",
        cwd: "/project",
        command: "pi --agent a3",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "down", "--surface", "surface:2"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["send", "--surface", "surface:3", "cd '/project' && pi --agent a3\n"]
      );
    });

    it("should reset anchor and split right when anchor surface is dead", () => {
      // First spawn establishes the anchor
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface:1 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      adapter.spawn({
        name: "agent-1",
        cwd: "/project",
        command: "pi --agent a1",
        env: {},
      });

      // Second spawn: anchor is dead, so adapter resets it before attempting a split
      mockExecCommand
        .mockReturnValueOnce({ stdout: "surface:2", stderr: "", status: 0 }) // list-pane-surfaces from isAlive()
        .mockReturnValueOnce({ stdout: "OK surface:2 workspace:1", stderr: "", status: 0 })  // new-split right
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });                          // send

      adapter.spawn({
        name: "agent-2",
        cwd: "/project",
        command: "pi --agent a2",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "right"]
      );
    });
  });

  describe("kill", () => {
    it("should kill a pane by surface ID", () => {
      mockExecCommand.mockReturnValue({ stdout: "", stderr: "", status: 0 });

      adapter.kill("surface-42");

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["close-surface", "--surface", "surface-42"]
      );
    });

    it("should reanchor to another tracked pane when killing the anchor pane", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface:1 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "surface:1\nsurface:2", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "OK surface:2 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      adapter.spawn({
        name: "agent-1",
        cwd: "/project",
        command: "pi --agent a1",
        env: {},
      });

      adapter.spawn({
        name: "agent-2",
        cwd: "/project",
        command: "pi --agent a2",
        env: {},
      });

      mockExecCommand.mockClear();
      mockExecCommand
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "surface:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "surface:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "OK surface:3 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      adapter.kill("surface:2");
      adapter.spawn({
        name: "agent-3",
        cwd: "/project",
        command: "pi --agent a3",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-split", "down", "--surface", "surface:1"]
      );
      expect(mockExecCommand).not.toHaveBeenCalledWith("cmux", ["new-split", "right"]);
    });

    it("should clear the anchor when the killed anchor was the last tracked pane", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK surface:1 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      adapter.spawn({
        name: "agent-1",
        cwd: "/project",
        command: "pi --agent a1",
        env: {},
      });

      mockExecCommand.mockClear();
      mockExecCommand
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "OK surface:2 workspace:1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      adapter.kill("surface:1");
      adapter.spawn({
        name: "agent-2",
        cwd: "/project",
        command: "pi --agent a2",
        env: {},
      });

      expect(mockExecCommand).toHaveBeenCalledWith("cmux", ["new-split", "right"]);
    });

    it("should be idempotent - no error on empty pane ID", () => {
      adapter.kill("");
      adapter.kill(undefined as unknown as string);
      expect(mockExecCommand).not.toHaveBeenCalled();
    });
  });

  describe("isAlive", () => {
    it("should return true if pane exists", () => {
      mockExecCommand.mockReturnValue({ 
        stdout: "surface-1\nsurface-42\nsurface-99", 
        stderr: "", 
        status: 0 
      });

      expect(adapter.isAlive("surface-42")).toBe(true);
    });

    it("should return false if pane does not exist", () => {
      mockExecCommand.mockReturnValue({ 
        stdout: "surface-1\nsurface-99", 
        stderr: "", 
        status: 0 
      });

      expect(adapter.isAlive("surface-42")).toBe(false);
    });

    it("should return false on error", () => {
      mockExecCommand.mockImplementation(() => {
        throw new Error("cmux error");
      });

      expect(adapter.isAlive("surface-42")).toBe(false);
    });

    it("should return false for empty pane ID", () => {
      expect(adapter.isAlive("")).toBe(false);
      expect(adapter.isAlive(undefined as unknown as string)).toBe(false);
    });
  });

  describe("setTitle", () => {
    it("should set the tab title", () => {
      mockExecCommand.mockReturnValue({ stdout: "", stderr: "", status: 0 });

      adapter.setTitle("My Team");

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["rename-tab", "My Team"]
      );
    });

    it("should silently ignore errors", () => {
      mockExecCommand.mockImplementation(() => {
        throw new Error("cmux error");
      });

      // Should not throw
      expect(() => adapter.setTitle("My Team")).not.toThrow();
    });
  });

  describe("supportsWindows", () => {
    it("should return true", () => {
      expect(adapter.supportsWindows()).toBe(true);
    });
  });

  describe("spawnWindow", () => {
    it("should spawn a new window with command", () => {
      mockExecCommand
        .mockReturnValueOnce({ stdout: "OK window-1", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 })
        .mockReturnValueOnce({ stdout: "", stderr: "", status: 0 });

      const result = adapter.spawnWindow({
        name: "test-agent",
        cwd: "/home/user/project",
        command: "pi",
        env: { PI_TEAM: "myteam" },
        teamName: "Team Alpha",
      });

      expect(result).toBe("window-1");
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-window"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["new-workspace", "--window", "window-1", "--command", "env PI_TEAM=myteam pi", "--cwd", "/home/user/project"]
      );
      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["rename-window", "--window", "window-1", "Team Alpha"]
      );
    });

    it("should throw on new-window failure", () => {
      mockExecCommand.mockReturnValue({ 
        stdout: "", 
        stderr: "error", 
        status: 1 
      });

      expect(() => adapter.spawnWindow({
        name: "test",
        cwd: "/home/user",
        command: "pi",
        env: {},
      })).toThrow("cmux new-window failed with status 1");
    });
  });

  describe("window operations", () => {
    it("should set window title", () => {
      mockExecCommand.mockReturnValue({ stdout: "", stderr: "", status: 0 });

      adapter.setWindowTitle("window-1", "New Title");

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["rename-window", "--window", "window-1", "New Title"]
      );
    });

    it("should kill a window", () => {
      mockExecCommand.mockReturnValue({ stdout: "", stderr: "", status: 0 });

      adapter.killWindow("window-1");

      expect(mockExecCommand).toHaveBeenCalledWith(
        "cmux",
        ["close-window", "--window", "window-1"]
      );
    });

    it("should check if window is alive", () => {
      mockExecCommand.mockReturnValue({ 
        stdout: "window-1\nwindow-2", 
        stderr: "", 
        status: 0 
      });

      expect(adapter.isWindowAlive("window-1")).toBe(true);
      expect(adapter.isWindowAlive("window-99")).toBe(false);
    });

    it("should handle empty window IDs gracefully", () => {
      adapter.killWindow("");
      adapter.killWindow(undefined as unknown as string);
      expect(mockExecCommand).not.toHaveBeenCalled();

      expect(adapter.isWindowAlive("")).toBe(false);
      expect(adapter.isWindowAlive(undefined as unknown as string)).toBe(false);
    });
  });
});
