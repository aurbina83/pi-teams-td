/**
 * TD Task Bridge
 * 
 * Bridges pi-teams' JSON-based task interface to td's SQLite backend.
 * This allows pi-teams to use td for project-scoped task management
 * while maintaining API compatibility.
 * 
 * Mapping:
 * - pi-teams "task" → td "issue"
 * - pi-teams team_name → td project (via cwd)
 * - pi-teams task_id → td issue ID (e.g., td-abc123)
 * 
 * Status mapping:
 * - pending → open
 * - planning → in_progress (with plan in logs)
 * - in_progress → in_progress  
 * - completed → closed
 * - deleted → deleted (soft delete)
 */

import { TdAdapter, TdTask, TdHandoff } from "./td-adapter";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Legacy task format compatible with pi-teams
 */
export interface LegacyTask {
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

/**
 * Convert td issue to legacy task format
 */
function tdToLegacy(tdTask: TdTask, teamName?: string): LegacyTask {
  // Extract plan from logs if exists
  let plan: string | undefined;
  let activeForm: string = "";
  
  for (const log of tdTask.logs || []) {
    if (log.type === "decision" && log.message.startsWith("PLAN:")) {
      plan = log.message.substring(5).trim();
    }
    if (log.type === "progress" && tdTask.status === "in_progress") {
      activeForm = log.message;
    }
  }

  return {
    id: tdTask.id,
    subject: tdTask.title,
    description: tdTask.description,
    activeForm,
    status: tdToLegacyStatus(tdTask.status),
    plan,
    blocks: [],
    blockedBy: [],
    owner: tdTask.implementerSession || undefined,
    metadata: {
      tdType: tdTask.type,
      tdPriority: tdTask.priority,
      tdLabels: tdTask.labels,
      tdAcceptance: tdTask.acceptance,
      tdPoints: tdTask.points,
      createdAt: tdTask.createdAt,
      updatedAt: tdTask.updatedAt,
    },
  };
}

/**
 * Convert td status to legacy status
 */
function tdToLegacyStatus(tdStatus: TdTask["status"]): LegacyTask["status"] {
  switch (tdStatus) {
    case "open": return "pending";
    case "in_progress": return "in_progress";
    case "in_review": return "in_progress"; // No direct mapping
    case "closed": return "completed";
    case "blocked": return "pending"; // Could be a label
    default: return "pending";
  }
}

/**
 * Convert legacy status to td status
 */
function legacyToTdStatus(legacyStatus: LegacyTask["status"]): TdTask["status"] {
  switch (legacyStatus) {
    case "pending": return "open";
    case "planning": return "in_progress";
    case "in_progress": return "in_progress";
    case "completed": return "closed";
    case "deleted": return "closed"; // Will soft delete
    default: return "open";
  }
}

/**
 * TD Task Bridge
 * 
 * Provides the same interface as pi-teams' tasks.ts module,
 * but backed by td instead of JSON files.
 */
export class TdTaskBridge {
  private adapter: TdAdapter;
  private teamName: string;
  private cwd: string;

  constructor(teamName: string, projectCwd?: string) {
    this.teamName = teamName;
    // Use project directory or detect from git
    this.cwd = projectCwd || this.detectProjectDir();
    this.adapter = new TdAdapter(this.cwd);
    
    // Ensure td is initialized
    this.adapter.init();
  }

  /**
   * Detect project directory from git or cwd.
   */
  private detectProjectDir(): string {
    let dir = process.cwd();
    
    // Walk up looking for .git
    while (dir !== "/") {
      if (fs.existsSync(path.join(dir, ".git"))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    
    return process.cwd();
  }

  /**
   * Get the team-scoped label prefix for td.
   */
  private getTeamLabel(): string {
    return `team:${this.teamName}`;
  }

  /**
   * Create a new task.
   */
  async create(
    subject: string,
    description: string,
    activeForm = "",
    metadata?: Record<string, any>
  ): Promise<LegacyTask> {
    const options: any = {
      type: "task",
      priority: "P2",
      labels: [this.getTeamLabel()],
    };

    // Extract from metadata if provided
    if (metadata?.type) options.type = metadata.type;
    if (metadata?.priority) options.priority = metadata.priority;
    if (metadata?.dependsOn) options.dependsOn = metadata.dependsOn;
    if (metadata?.blocks) options.blocks = metadata.blocks;

    const tdTask = this.adapter.create(subject, description, options);
    if (!tdTask) {
      throw new Error(`Failed to create task: ${subject}`);
    }

    if (activeForm) {
      this.adapter.log(activeForm);
    }

    return tdToLegacy(tdTask);
  }

  /**
   * Get a task by ID.
   */
  async get(taskId: string): Promise<LegacyTask> {
    const tdTask = this.adapter.get(taskId);
    if (!tdTask) {
      throw new Error(`Task ${taskId} not found`);
    }
    return tdToLegacy(tdTask);
  }

  /**
   * List all tasks for this team.
   */
  async list(): Promise<LegacyTask[]> {
    // Query for tasks with this team's label
    const tasks = this.adapter.query(`labels ~ "${this.getTeamLabel()}"`);
    return tasks.map(t => tdToLegacy(t));
  }

  /**
   * Update a task.
   */
  async update(
    taskId: string,
    updates: Partial<LegacyTask>
  ): Promise<LegacyTask> {
    const tdUpdates: any = {};

    if (updates.subject) tdUpdates.title = updates.subject;
    if (updates.description) tdUpdates.description = updates.description;
    if (updates.status) tdUpdates.status = legacyToTdStatus(updates.status);
    if (updates.owner) {
      // Owner is tracked via implementer_session in td
      // This is session-based, not name-based
    }

    const tdTask = this.adapter.update(taskId, tdUpdates);
    if (!tdTask) {
      throw new Error(`Failed to update task ${taskId}`);
    }

    return tdToLegacy(tdTask);
  }

  /**
   * Submit a plan for approval.
   */
  async submitPlan(taskId: string, plan: string): Promise<LegacyTask> {
    // Log the plan as a decision
    this.adapter.log(`PLAN: ${plan}`, "decision");
    
    const tdTask = this.adapter.start(taskId);
    if (!tdTask) {
      throw new Error(`Failed to start task ${taskId}`);
    }

    return tdToLegacy(tdTask);
  }

  /**
   * Evaluate a submitted plan.
   */
  async evaluatePlan(
    taskId: string,
    action: "approve" | "reject",
    feedback?: string
  ): Promise<LegacyTask> {
    if (action === "approve") {
      this.adapter.approve(taskId);
    } else {
      this.adapter.reject(taskId, feedback || "No feedback provided");
    }

    const tdTask = this.adapter.get(taskId);
    if (!tdTask) {
      throw new Error(`Task ${taskId} not found`);
    }

    return tdToLegacy(tdTask);
  }

  /**
   * Log progress on a task.
   */
  async log(taskId: string, message: string): Promise<void> {
    // Set as current task and log
    const td = new TdAdapter(this.cwd);
    td.start(taskId);
    td.log(message);
  }

  /**
   * Record a structured handoff.
   */
  async handoff(
    taskId: string,
    handoff: TdHandoff
  ): Promise<void> {
    const td = new TdAdapter(this.cwd);
    td.start(taskId);
    td.handoff(handoff);
  }

  /**
   * Delete a task (soft delete).
   */
  async delete(taskId: string): Promise<void> {
    this.adapter.delete(taskId);
  }

  /**
   * Get the next task for this team.
   */
  async next(): Promise<LegacyTask | null> {
    const tdTask = this.adapter.query(
      `labels ~ "${this.getTeamLabel()}" AND status = open AND priority <= P2`
    )[0];
    
    return tdTask ? tdToLegacy(tdTask) : null;
  }

  /**
   * Get current working task.
   */
  async current(): Promise<LegacyTask | null> {
    const tdTask = this.adapter.current();
    return tdTask ? tdToLegacy(tdTask) : null;
  }

  /**
   * Get usage summary for the team.
   */
  usage(): string {
    return this.adapter.usage();
  }

  /**
   * Add a dependency.
   */
  addDependency(taskId: string, dependsOn: string): void {
    this.adapter.addDependency(taskId, dependsOn);
  }

  /**
   * Create an epic for grouping.
   */
  async createEpic(
    title: string,
    description: string,
    priority = "P1"
  ): Promise<LegacyTask> {
    const tdTask = this.adapter.createEpic(title, {
      description,
      priority,
    });
    
    if (!tdTask) {
      throw new Error(`Failed to create epic: ${title}`);
    }

    return tdToLegacy(tdTask);
  }
}

/**
 * Create a TD task bridge for a team.
 */
export function createTdBridge(teamName: string, projectCwd?: string): TdTaskBridge {
  return new TdTaskBridge(teamName, projectCwd);
}
