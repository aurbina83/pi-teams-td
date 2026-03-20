/**
 * TD Task Adapter
 * 
 * Adapter that uses the `td` CLI for project-scoped task management.
 * Stores tasks in .todos/ directory with SQLite backend.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TaskAdapter } from "./task-adapter";
import { TaskFile } from "../models";
import { teamExists } from "../teams";
import { runHook } from "../hooks";

interface LegacyTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: "pending" | "planning" | "in_progress" | "completed" | "deleted";
  plan?: string;
  planFeedback?: string;
  blocks: string[];
  blockedBy: string[];
  owner?: string;
  metadata?: Record<string, any>;
}

function legacyToTaskFile(legacy: LegacyTask): TaskFile {
  return {
    id: legacy.id,
    subject: legacy.subject,
    description: legacy.description,
    activeForm: legacy.activeForm,
    status: legacy.status,
    plan: legacy.plan,
    planFeedback: legacy.planFeedback,
    blocks: legacy.blocks,
    blockedBy: legacy.blockedBy,
    owner: legacy.owner,
    metadata: legacy.metadata,
  };
}

function taskFileToLegacy(task: TaskFile): LegacyTask {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    activeForm: task.activeForm,
    status: task.status as LegacyTask["status"],
    plan: task.plan,
    planFeedback: task.planFeedback,
    blocks: task.blocks,
    blockedBy: task.blockedBy,
    owner: task.owner,
    metadata: task.metadata,
  };
}

export class TdTaskAdapter implements TaskAdapter {
  readonly name = "td";

  private projectDir: string | null = null;

  detect(): boolean {
    return this.findProjectDir() !== null;
  }

  init(): boolean {
    const projectDir = this.findProjectDir();
    if (!projectDir) return false;

    // Initialize td if not already done
    if (!this.isTdInitialized(projectDir)) {
      return this.runTdInit(projectDir);
    }
    return true;
  }

  private findProjectDir(): string | null {
    if (!this.isTdAvailable()) {
      return null;
    }

    // Walk up from cwd looking for .todos/ or .git
    let dir = process.cwd();
    while (dir !== "/") {
      if (this.isTdInitialized(dir)) {
        this.projectDir = dir;
        return dir;
      }
      if (fs.existsSync(path.join(dir, ".git"))) {
        this.projectDir = dir;
        return dir;
      }
      dir = path.dirname(dir);
    }
    return null;
  }

  private isTdAvailable(): boolean {
    try {
      const result = spawnSync("td", ["--version"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private isTdInitialized(cwd: string): boolean {
    return fs.existsSync(path.join(cwd, ".todos"));
  }

  private runTdInit(cwd: string): boolean {
    try {
      const result = spawnSync("td", ["init"], {
        cwd,
        encoding: "utf-8",
        input: "n\n",
        timeout: 10000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private execTd(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("td", args, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? -1,
    };
  }

  private execTdJson<T>(args: string[], cwd: string): T | null {
    const result = this.execTd([...args, "--format", "json"], cwd);
    if (result.status !== 0) return null;
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      return null;
    }
  }

  private getProjectDir(): string {
    if (!this.projectDir) {
      this.findProjectDir();
    }
    return this.projectDir || process.cwd();
  }

  async create(
    teamName: string,
    subject: string,
    description: string,
    activeForm = "",
    metadata?: Record<string, any>
  ): Promise<TaskFile> {
    if (!teamExists(teamName)) throw new Error(`Team ${teamName} does not exist`);
    
    const cwd = this.getProjectDir();
    const args = ["create", subject, "-d", description];

    // Add team label
    args.push("-l", `team:${teamName}`);

    if (metadata?.priority) {
      args.push("-p", metadata.priority);
    }

    const result = this.execTd(args, cwd);
    if (result.status !== 0) throw new Error(`Failed to create task: ${result.stderr}`);

    // Extract ID
    const match = result.stdout.match(/CREATED\s+(td-\w+)/);
    if (!match) throw new Error("Failed to parse task ID from td output");

    const taskId = match[1];

    if (activeForm) {
      this.execTd(["log", activeForm], cwd);
    }

    return this.get(teamName, taskId);
  }

  async get(teamName: string, taskId: string): Promise<TaskFile> {
    const cwd = this.getProjectDir();
    const task = this.execTdJson<any>(["show", taskId], cwd);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Convert td task to TaskFile format
    return {
      id: task.id,
      subject: task.title,
      description: task.description,
      activeForm: this.getActiveForm(task),
      status: this.mapTdStatus(task.status),
      plan: this.getPlan(task),
      blocks: [],
      blockedBy: [],
      owner: task.implementerSession,
      metadata: {
        tdType: task.type,
        tdPriority: task.priority,
        tdLabels: task.labels,
      },
    };
  }

  private getActiveForm(task: any): string {
    for (const log of task.logs || []) {
      if (log.type === "progress") {
        return log.message;
      }
    }
    return "";
  }

  private getPlan(task: any): string | undefined {
    for (const log of task.logs || []) {
      if (log.type === "decision" && log.message.startsWith("PLAN:")) {
        return log.message.substring(5).trim();
      }
    }
    return undefined;
  }

  private mapTdStatus(tdStatus: string): TaskFile["status"] {
    switch (tdStatus) {
      case "open": return "pending";
      case "in_progress": return "in_progress";
      case "in_review": return "in_progress";
      case "closed": return "completed";
      case "blocked": return "pending";
      default: return "pending";
    }
  }

  async list(teamName: string): Promise<TaskFile[]> {
    const cwd = this.getProjectDir();
    const result = this.execTd(["list", "--query", `labels ~ "team:${teamName}"`], cwd);
    
    if (result.status !== 0) return [];

    // Parse IDs
    const ids: string[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^(td-\w+)/);
      if (match) ids.push(match[1]);
    }

    const tasks: TaskFile[] = [];
    for (const id of ids) {
      try {
        const task = await this.get(teamName, id);
        tasks.push(task);
      } catch {
        // Skip failed tasks
      }
    }
    return tasks;
  }

  async update(teamName: string, taskId: string, updates: Partial<TaskFile>): Promise<TaskFile> {
    const cwd = this.getProjectDir();
    const args = ["update", taskId];

    if (updates.subject) args.push("--title", updates.subject);
    if (updates.description) args.push("-d", updates.description);
    if (updates.status) args.push("--status", this.mapStatusToTd(updates.status));
    if (updates.planFeedback) {
      // Log as comment
      this.execTd(["comment", `Feedback: ${updates.planFeedback}`], cwd);
    }

    const result = this.execTd(args, cwd);
    if (result.status !== 0) throw new Error(`Failed to update task: ${result.stderr}`);

    const updated = await this.get(teamName, taskId);

    if (updates.status === "completed") {
      await runHook(teamName, "task_completed", updated);
    }

    return updated;
  }

  private mapStatusToTd(status: TaskFile["status"]): string {
    switch (status) {
      case "pending": return "open";
      case "planning": return "in_progress";
      case "in_progress": return "in_progress";
      case "completed": return "closed";
      case "deleted": return "closed";
      default: return "open";
    }
  }

  async delete(teamName: string, taskId: string): Promise<void> {
    this.execTd(["delete", taskId], this.getProjectDir());
  }

  async submitPlan(teamName: string, taskId: string, plan: string): Promise<TaskFile> {
    const cwd = this.getProjectDir();
    // Log the plan as a decision
    this.execTd(["log", `PLAN: ${plan}`, "--decision"], cwd);
    // Start the task
    this.execTd(["start", taskId], cwd);
    return this.get(teamName, taskId);
  }

  async evaluatePlan(
    teamName: string,
    taskId: string,
    action: "approve" | "reject",
    feedback?: string
  ): Promise<TaskFile> {
    const cwd = this.getProjectDir();
    
    if (action === "approve") {
      this.execTd(["approve", taskId], cwd);
    } else {
      this.execTd(["reject", taskId, "--reason", feedback || "No feedback"], cwd);
    }

    return this.get(teamName, taskId);
  }

  async log(teamName: string, taskId: string, message: string): Promise<void> {
    const cwd = this.getProjectDir();
    this.execTd(["start", taskId], cwd);
    this.execTd(["log", message], cwd);
  }

  async handoff(
    teamName: string,
    taskId: string,
    handoff: { done: string; remaining: string; decision?: string; uncertain?: string }
  ): Promise<void> {
    const cwd = this.getProjectDir();
    
    // Use td handoff with YAML input
    const yamlContent = `done:
  - ${handoff.done}
remaining:
  - ${handoff.remaining}
${handoff.decision ? `decisions:\n  - ${handoff.decision}\n` : ""}${handoff.uncertain ? `uncertain:\n  - ${handoff.uncertain}\n` : ""}`;

    const result = spawnSync("td", ["handoff"], {
      cwd,
      input: yamlContent,
      encoding: "utf-8",
      timeout: 10000,
    });

    // Fallback to log if handoff fails
    if (result.status !== 0) {
      this.execTd(["comment", `HANDOFF: done=[${handoff.done}] remaining=[${handoff.remaining}]`], cwd);
    }
  }
}
