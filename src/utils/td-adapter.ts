/**
 * TD Task Adapter
 * 
 * Wraps the `td` CLI to provide project-scoped task management.
 * Uses td's SQLite backend for persistent, git-friendly tasks.
 * 
 * Benefits over JSON-file based tasks:
 * - Project-scoped (in .todos/ instead of ~/.pi/tasks/)
 * - SQLite backend (reliable, concurrent-safe)
 * - Rich features: dependencies, epics, boards, reviews
 * - Structured handoffs for agent coordination
 * - File tracking with SHA checksums
 */

import { spawnSync } from "node:child_process";

export interface TdTask {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "in_review" | "closed" | "blocked";
  type: "bug" | "feature" | "task" | "epic" | "chore";
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  labels: string[] | null;
  parentId: string;
  points: number;
  createdAt: string;
  updatedAt: string;
  implementerSession: string;
  reviewerSession: string;
  logs: Array<{
    message: string;
    type: "progress" | "decision" | "blocker";
    session: string;
    timestamp: string;
  }>;
  acceptance: string;
  minor: boolean;
}

export interface TdHandoff {
  done: string;
  remaining: string;
  decision: string;
  uncertain: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Execute a td command and return parsed JSON output.
 */
function execTd(args: string[], cwd: string): ExecResult {
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

/**
 * Execute td and return JSON output.
 */
function execTdJson<T>(args: string[], cwd: string): T | null {
  const result = execTd([...args, "--format", "json"], cwd);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

/**
 * TD Adapter for pi-teams
 * 
 * Provides task management using the `td` CLI.
 * Tasks are scoped to the project directory (where .todos/ lives).
 */
export class TdAdapter {
  readonly name = "td";
  
  private cwd: string;

  constructor(projectCwd?: string) {
    // Use provided cwd or current working directory
    this.cwd = projectCwd || process.cwd();
  }

  /**
   * Check if td is available and initialized in the project.
   */
  detect(): boolean {
    try {
      const result = execTd(["list"], this.cwd);
      // If td is available and .todos/ exists, we're good
      // td returns exit code 0 for empty list, non-zero for errors
      return result.status === 0 || result.stdout.includes("td-");
    } catch {
      return false;
    }
  }

  /**
   * Initialize td in the project if not already done.
   */
  init(): boolean {
    try {
      const result = execTd(["init"], this.cwd);
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the current session ID for this terminal context.
   */
  getSessionId(): string {
    try {
      const result = execTd(["session"], this.cwd);
      // Parse session ID from output like "Session: ses_abc123"
      const match = result.stdout.match(/Session:\s*(\S+)/);
      return match?.[1] || "unknown";
    } catch {
      return "unknown";
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a new task/issue.
   */
  create(
    title: string,
    description: string,
    options?: {
      type?: "bug" | "feature" | "task" | "epic" | "chore";
      priority?: "P0" | "P1" | "P2" | "P3" | "P4";
      labels?: string[];
      parent?: string;
      dependsOn?: string[];
      blocks?: string[];
      acceptance?: string;
    }
  ): TdTask | null {
    const args = ["create", title, "-d", description];
    
    if (options?.type) args.push("-t", options.type);
    if (options?.priority) args.push("-p", options.priority);
    if (options?.labels?.length) args.push("-l", options.labels.join(","));
    if (options?.parent) args.push("--parent", options.parent);
    if (options?.dependsOn?.length) args.push("--depends-on", options.dependsOn.join(","));
    if (options?.blocks?.length) args.push("--blocks", options.blocks.join(","));
    if (options?.acceptance) args.push("--acceptance", options.acceptance);

    const result = execTd(args, this.cwd);
    if (result.status !== 0) return null;

    // Extract ID from output like "CREATED td-abc123"
    const match = result.stdout.match(/CREATED\s+(td-\w+)/);
    if (!match) return null;

    return this.get(match[1]);
  }

  /**
   * Get a task by ID.
   */
  get(id: string): TdTask | null {
    return execTdJson<TdTask>(["show", id], this.cwd);
  }

  /**
   * List all tasks, optionally filtered.
   */
  list(options?: {
    status?: "open" | "in_progress" | "in_review" | "closed" | "blocked";
    type?: "bug" | "feature" | "task" | "epic" | "chore";
    priority?: "P0" | "P1" | "P2" | "P3" | "P4";
    labels?: string[];
    implementer?: string;
    query?: string;
  }): TdTask[] {
    let args = ["list"];
    
    if (options?.query) {
      args.push("--query", options.query);
    } else {
      if (options?.status) {
        args.push("--status", options.status);
      }
      if (options?.type) {
        args.push("--type", options.type);
      }
      if (options?.priority) {
        args.push("--priority", options.priority);
      }
    }

    const result = execTd(args, this.cwd);
    if (result.status !== 0) return [];

    // Parse IDs from output like "td-abc123  [P1]  Title  feature  [open]"
    const ids: string[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^(td-\w+)/);
      if (match) ids.push(match[1]);
    }

    // Fetch full task data for each
    return ids.map(id => this.get(id)).filter((t): t is TdTask => t !== null);
  }

  /**
   * Update a task.
   */
  update(
    id: string,
    updates: Partial<{
      title: string;
      description: string;
      status: "open" | "in_progress" | "in_review" | "closed" | "blocked";
      type: "bug" | "feature" | "task" | "epic" | "chore";
      priority: "P0" | "P1" | "P2" | "P3" | "P4";
      labels: string[];
    }>
  ): TdTask | null {
    const args = ["update", id];
    
    if (updates.title) args.push("--title", updates.title);
    if (updates.description) args.push("-d", updates.description);
    if (updates.status) args.push("--status", updates.status);
    if (updates.type) args.push("-t", updates.type);
    if (updates.priority) args.push("-p", updates.priority);
    if (updates.labels) args.push("-l", updates.labels.join(","));

    const result = execTd(args, this.cwd);
    if (result.status !== 0) return null;

    return this.get(id);
  }

  /**
   * Delete a task (soft delete).
   */
  delete(id: string): boolean {
    const result = execTd(["delete", id], this.cwd);
    return result.status === 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // Workflow Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start work on a task.
   */
  start(id: string): boolean {
    const result = execTd(["start", id], this.cwd);
    return result.status === 0;
  }

  /**
   * Stop work on a task (revert to open).
   */
  stop(id: string): boolean {
    const result = execTd(["unstart", id], this.cwd);
    return result.status === 0;
  }

  /**
   * Log progress on the current task.
   */
  log(message: string, type: "progress" | "decision" | "blocker" = "progress"): boolean {
    const args = ["log", message];
    if (type === "decision") args.push("--decision");
    if (type === "blocker") args.push("--blocker");
    
    const result = execTd(args, this.cwd);
    return result.status === 0;
  }

  /**
   * Submit task for review.
   */
  submitReview(id: string): boolean {
    const result = execTd(["review", id], this.cwd);
    return result.status === 0;
  }

  /**
   * Approve and close a task.
   */
  approve(id: string): boolean {
    const result = execTd(["approve", id], this.cwd);
    return result.status === 0;
  }

  /**
   * Reject and return to open status.
   */
  reject(id: string, reason: string): boolean {
    const result = execTd(["reject", id, "--reason", reason], this.cwd);
    return result.status === 0;
  }

  /**
   * Close a task without review.
   */
  close(id: string): boolean {
    const result = execTd(["close", id], this.cwd);
    return result.status === 0;
  }

  /**
   * Reopen a closed task.
   */
  reopen(id: string): boolean {
    const result = execTd(["reopen", id], this.cwd);
    return result.status === 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // Handoff Operations (Agent Coordination)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a structured handoff for the current task.
   * 
   * Note: td handoff expects items (done, remaining) not full sentences.
   * Items are one per line, not comma-separated.
   */
  handoff(handoff: TdHandoff): boolean {
    // td handoff uses different format - items per line
    // For simplicity, we'll just log the handoff info as a comment
    const commentArgs = [
      "comment",
      "HANDOFF:",
      `Done: ${handoff.done}`,
      `Remaining: ${handoff.remaining}`,
    ];
    if (handoff.decision) commentArgs.push(`Decision: ${handoff.decision}`);
    if (handoff.uncertain) commentArgs.push(`Uncertain: ${handoff.uncertain}`);

    // Try the new format first (stdin-based)
    const yamlContent = `done:
  - ${handoff.done}
remaining:
  - ${handoff.remaining}
${handoff.decision ? `decisions:\n  - ${handoff.decision}\n` : ""}${handoff.uncertain ? `uncertain:\n  - ${handoff.uncertain}\n` : ""}`;

    const result = spawnSync("td", ["handoff"], {
      cwd: this.cwd,
      input: yamlContent,
      encoding: "utf-8",
      timeout: 10000,
    });

    // If stdin approach didn't work, fall back to log messages
    if (result.status !== 0) {
      // Fallback: log as decision
      return this.log(`HANDOFF: done=[${handoff.done}] remaining=[${handoff.remaining}]${handoff.decision ? ` decision=[${handoff.decision}]` : ""}`, "decision");
    }

    return true;
  }

  /**
   * Get current session context (usage summary).
   */
  usage(): string {
    const result = execTd(["usage"], this.cwd);
    return result.stdout;
  }

  /**
   * Get the next highest priority open task.
   */
  next(): TdTask | null {
    const result = execTd(["next", "--format", "json"], this.cwd);
    if (result.status !== 0) return null;
    try {
      return JSON.parse(result.stdout) as TdTask;
    } catch {
      return null;
    }
  }

  /**
   * Get current working task.
   */
  current(): TdTask | null {
    const result = execTd(["current", "--format", "json"], this.cwd);
    if (result.status !== 0) return null;
    try {
      return JSON.parse(result.stdout) as TdTask;
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Dependency Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add a dependency (this task depends on another).
   */
  addDependency(taskId: string, dependsOn: string): boolean {
    const result = execTd(["dep", "add", taskId, dependsOn], this.cwd);
    return result.status === 0;
  }

  /**
   * Remove a dependency.
   */
  removeDependency(taskId: string, dependsOn: string): boolean {
    const result = execTd(["dep", "rm", taskId, dependsOn], this.cwd);
    return result.status === 0;
  }

  /**
   * Get dependencies for a task.
   */
  getDependencies(id: string): { dependsOn: string[]; blockedBy: string[] } {
    const result = execTd(["dep", id], this.cwd);
    const dependsOn: string[] = [];
    const blockedBy: string[] = [];

    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^(td-\w+)/);
      if (match) {
        if (line.includes("depends on")) {
          dependsOn.push(match[1]);
        } else if (line.includes("blocked by")) {
          blockedBy.push(match[1]);
        }
      }
    }

    return { dependsOn, blockedBy };
  }

  // ═══════════════════════════════════════════════════════════════
  // Epic Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create an epic (parent issue).
   */
  createEpic(title: string, options?: { priority?: string; description?: string }): TdTask | null {
    return this.create(title, options?.description || "", {
      type: "epic",
      priority: options?.priority as any,
    });
  }

  /**
   * List all epics.
   */
  listEpics(): TdTask[] {
    return this.list({ type: "epic" });
  }

  // ═══════════════════════════════════════════════════════════════
  // Search & Query
  // ═══════════════════════════════════════════════════════════════

  /**
   * Search across all fields.
   */
  search(query: string, options?: { status?: string; type?: string }): TdTask[] {
    const args = ["search", query];
    if (options?.status) args.push("--status", options.status);
    if (options?.type) args.push("--type", options.type);

    const result = execTd(args, this.cwd);
    if (result.status !== 0) return [];

    // Parse IDs from output
    const ids: string[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/^(td-\w+)/);
      if (match) ids.push(match[1]);
    }

    return ids.map(id => this.get(id)).filter((t): t is TdTask => t !== null);
  }

  /**
   * Query using TDQ language.
   */
  query(tdq: string): TdTask[] {
    const result = execTd(["query", tdq, "--output", "ids"], this.cwd);
    if (result.status !== 0) return [];

    const ids = result.stdout.split("\n").filter(s => s.startsWith("td-"));
    return ids.map(id => this.get(id.trim())).filter((t): t is TdTask => t !== null);
  }
}

/**
 * Create a TD adapter for the current project.
 */
export function createTdAdapter(cwd?: string): TdAdapter {
  return new TdAdapter(cwd);
}
