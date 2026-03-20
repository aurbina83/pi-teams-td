// Project: pi-teams
/**
 * Task utilities - delegates to the configured TaskAdapter
 * 
 * The adapter is auto-detected on first use:
 * 1. td - if `td` CLI is available and project has .todos/ or .git
 * 2. json - always available as fallback
 */

import { TaskFile } from "./models";
import { teamExists } from "./teams";
import { getTaskAdapter, isTdActive, isTdAvailable, clearAdapterCache, setAdapter, JsonTaskAdapter } from "./task-adapters/registry";

// Re-export for convenience and testing
export { isTdActive, isTdAvailable, clearAdapterCache, setAdapter, JsonTaskAdapter };

/**
 * Get the current task adapter name.
 */
export function getAdapterName(): string {
  return getTaskAdapter().name;
}

// ═══════════════════════════════════════════════════════════════
// Task Operations - delegate to the active adapter
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new task.
 */
export async function createTask(
  teamName: string,
  subject: string,
  description: string,
  activeForm = "",
  metadata?: Record<string, any>
): Promise<TaskFile> {
  if (!subject || !subject.trim()) throw new Error("Task subject must not be empty");
  if (!teamExists(teamName)) throw new Error(`Team ${teamName} does not exist`);
  return getTaskAdapter().create(teamName, subject, description, activeForm, metadata);
}

/**
 * Get a task by ID.
 */
export async function readTask(teamName: string, taskId: string): Promise<TaskFile> {
  return getTaskAdapter().get(teamName, taskId);
}

/**
 * List all tasks for a team.
 */
export async function listTasks(teamName: string): Promise<TaskFile[]> {
  return getTaskAdapter().list(teamName);
}

/**
 * Update a task.
 */
export async function updateTask(
  teamName: string,
  taskId: string,
  updates: Partial<TaskFile>
): Promise<TaskFile> {
  return getTaskAdapter().update(teamName, taskId, updates);
}

/**
 * Submit a plan for a task.
 */
export async function submitPlan(teamName: string, taskId: string, plan: string): Promise<TaskFile> {
  if (!plan || !plan.trim()) throw new Error("Plan must not be empty");
  return getTaskAdapter().submitPlan(teamName, taskId, plan);
}

/**
 * Evaluate a submitted plan.
 */
export async function evaluatePlan(
  teamName: string,
  taskId: string,
  action: "approve" | "reject",
  feedback?: string
): Promise<TaskFile> {
  return getTaskAdapter().evaluatePlan(teamName, taskId, action, feedback);
}

/**
 * Reset ownership of tasks when an agent leaves.
 */
export async function resetOwnerTasks(teamName: string, agentName: string): Promise<void> {
  const adapter = getTaskAdapter();
  const tasks = await adapter.list(teamName);
  
  for (const task of tasks) {
    if (task.owner === agentName) {
      await adapter.update(teamName, task.id, {
        status: task.status === "completed" ? "completed" : "pending",
      });
    }
  }
}

/**
 * Log progress on a task (td adapter only).
 */
export async function logTaskProgress(teamName: string, taskId: string, message: string): Promise<void> {
  return getTaskAdapter().log(teamName, taskId, message);
}

/**
 * Record a structured handoff (td adapter only).
 */
export async function recordHandoff(
  teamName: string,
  taskId: string,
  handoff: { done: string; remaining: string; decision?: string; uncertain?: string }
): Promise<void> {
  return getTaskAdapter().handoff(teamName, taskId, handoff);
}
