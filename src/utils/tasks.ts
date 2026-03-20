// Project: pi-teams
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { TaskFile } from "./models";
import { taskDir, sanitizeName } from "./paths";
import { teamExists } from "./teams";
import { withLock } from "./lock";
import { runHook } from "./hooks";

// Lazy-loaded TD bridge (only import when needed)
let _TdTaskBridge: typeof import("./td-task-bridge").TdTaskBridge | null = null;
let _tdBridge: import("./td-task-bridge").TdTaskBridge | null = null;
let _tdAvailable: boolean | null = null;
let _tdBridgeInitAttempted = false;

/**
 * Load the TdTaskBridge class lazily using require.
 * Returns null if the module can't be loaded.
 */
function loadTdTaskBridge(): typeof import("./td-task-bridge").TdTaskBridge | null {
  if (_tdBridgeInitAttempted) return _TdTaskBridge;
  _tdBridgeInitAttempted = true;
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tdModule = require("./td-task-bridge");
    _TdTaskBridge = tdModule.TdTaskBridge;
    return _TdTaskBridge;
  } catch (e) {
    // Module not available, td integration disabled
    _TdTaskBridge = null;
    return null;
  }
}

/**
 * Check if td CLI is available in PATH.
 */
function isTdAvailable(): boolean {
  if (_tdAvailable !== null) return _tdAvailable;
  
  try {
    const result = spawnSync("td", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    _tdAvailable = result.status === 0;
  } catch {
    _tdAvailable = false;
  }
  
  return _tdAvailable;
}

/**
 * Check if .todos/ directory exists (td is initialized).
 */
function isTdInitialized(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, ".todos"));
}

/**
 * Initialize td in the project with non-interactive response.
 */
function initTd(cwd: string): boolean {
  try {
    // Pipe "n" to skip any interactive prompts (e.g., template creation)
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

/**
 * Get or create the TD task bridge.
 */
function getTdBridge(teamName: string, projectCwd: string): import("./td-task-bridge").TdTaskBridge | null {
  // Check if td is available
  if (!isTdAvailable()) {
    return null;
  }
  
  // Initialize if needed
  if (!isTdInitialized(projectCwd)) {
    if (!initTd(projectCwd)) {
      return null;
    }
  }
  
  // Re-check initialization
  if (!isTdInitialized(projectCwd)) {
    return null;
  }
  
  // Lazy load the bridge class
  const TdTaskBridgeClass = loadTdTaskBridge();
  if (!TdTaskBridgeClass) {
    return null;
  }
  
  if (!_tdBridge) {
    _tdBridge = new TdTaskBridgeClass(teamName, projectCwd);
  }
  
  return _tdBridge;
}

/**
 * Detect if we should use td for this project.
 * Returns the project directory if td is available and initialized.
 */
export function detectTd(): string | null {
  // Check if td is in PATH
  if (!isTdAvailable()) {
    return null;
  }
  
  // Walk up from cwd looking for .todos/
  let dir = process.cwd();
  while (dir !== "/") {
    if (isTdInitialized(dir)) {
      return dir;
    }
    // Also check for .git to find project root
    if (fs.existsSync(path.join(dir, ".git"))) {
      // Found project root, check if we can init td here
      if (!isTdInitialized(dir)) {
        if (initTd(dir)) {
          return dir;
        }
      } else {
        return dir;
      }
      break;
    }
    dir = path.dirname(dir);
  }
  
  return null;
}

/**
 * Check if td is available and initialized for the current project.
 */
export function isTdEnabled(): boolean {
  return detectTd() !== null;
}

export function getTaskId(teamName: string): string {
  const dir = taskDir(teamName);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  const ids = files.map(f => parseInt(path.parse(f).name, 10)).filter(id => !isNaN(id));
  return ids.length > 0 ? (Math.max(...ids) + 1).toString() : "1";
}

/**
 * Convert legacy task format (from TdTaskBridge) to TaskFile format.
 */
function legacyToTaskFile(legacy: import("./td-task-bridge").LegacyTask): TaskFile {
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

function getTaskPath(teamName: string, taskId: string): string {
  const dir = taskDir(teamName);
  const safeTaskId = sanitizeName(taskId);
  return path.join(dir, `${safeTaskId}.json`);
}

export async function createTask(
  teamName: string,
  subject: string,
  description: string,
  activeForm = "",
  metadata?: Record<string, any>
): Promise<TaskFile> {
  if (!subject || !subject.trim()) throw new Error("Task subject must not be empty");
  if (!teamExists(teamName)) throw new Error(`Team ${teamName} does not exist`);

  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const legacyTask = await bridge.create(subject, description, activeForm, metadata);
      return legacyToTaskFile(legacyTask);
    }
  }

  // Fall back to JSON files
  const dir = taskDir(teamName);
  const lockPath = dir;

  return await withLock(lockPath, async () => {
    const id = getTaskId(teamName);
    const task: TaskFile = {
      id,
      subject,
      description,
      activeForm,
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata,
    };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(task, null, 2));
    return task;
  });
}

export async function updateTask(
  teamName: string,
  taskId: string,
  updates: Partial<TaskFile>,
  retries?: number
): Promise<TaskFile> {
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const legacyTask = await bridge.get(taskId);
      const updated = { ...legacyTask, ...updates };
      const result = await bridge.update(taskId, updated);
      
      // Run hook for completed tasks
      if (updates.status === "completed") {
        await runHook(teamName, "task_completed", legacyToTaskFile(result));
      }
      
      return legacyToTaskFile(result);
    }
  }

  // Fall back to JSON files
  const p = getTaskPath(teamName, taskId);

  return await withLock(p, async () => {
    if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
    const task: TaskFile = JSON.parse(fs.readFileSync(p, "utf-8"));
    const updated = { ...task, ...updates };

    if (updates.status === "deleted") {
      fs.unlinkSync(p);
      return updated;
    }

    fs.writeFileSync(p, JSON.stringify(updated, null, 2));

    if (updates.status === "completed") {
      await runHook(teamName, "task_completed", updated);
    }

    return updated;
  }, retries);
}

/**
 * Submits a plan for a task, updating its status to "planning".
 * @param teamName The name of the team
 * @param taskId The ID of the task
 * @param plan The content of the plan
 * @returns The updated task
 */
export async function submitPlan(teamName: string, taskId: string, plan: string): Promise<TaskFile> {
  if (!plan || !plan.trim()) throw new Error("Plan must not be empty");
  
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const result = await bridge.submitPlan(taskId, plan);
      return legacyToTaskFile(result);
    }
  }

  return await updateTask(teamName, taskId, { status: "planning", plan });
}

/**
 * Evaluates a submitted plan for a task.
 * @param teamName The name of the team
 * @param taskId The ID of the task
 * @param action The evaluation action: "approve" or "reject"
 * @param feedback Optional feedback for the evaluation (required for rejection)
 * @param retries Number of times to retry acquiring the lock
 * @returns The updated task
 */
export async function evaluatePlan(
  teamName: string,
  taskId: string,
  action: "approve" | "reject",
  feedback?: string,
  retries?: number
): Promise<TaskFile> {
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const result = await bridge.evaluatePlan(taskId, action, feedback);
      return legacyToTaskFile(result);
    }
  }

  // Fall back to JSON files
  const p = getTaskPath(teamName, taskId);

  return await withLock(p, async () => {
    if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
    const task: TaskFile = JSON.parse(fs.readFileSync(p, "utf-8"));

    // 1. Validate state: Only "planning" tasks can be evaluated
    if (task.status !== "planning") {
      throw new Error(
        `Cannot evaluate plan for task ${taskId} because its status is '${task.status}'. ` +
        `Tasks must be in 'planning' status to be evaluated.`
      );
    }

    // 2. Validate plan presence
    if (!task.plan || !task.plan.trim()) {
      throw new Error(`Cannot evaluate plan for task ${taskId} because no plan has been submitted.`);
    }

    // 3. Require feedback for rejections
    if (action === "reject" && (!feedback || !feedback.trim())) {
      throw new Error("Feedback is required when rejecting a plan.");
    }

    // 4. Perform update
    const updates: Partial<TaskFile> = action === "approve" 
      ? { status: "in_progress", planFeedback: "" }
      : { status: "planning", planFeedback: feedback };

    const updated = { ...task, ...updates };
    fs.writeFileSync(p, JSON.stringify(updated, null, 2));
    return updated;
  }, retries);
}

export async function readTask(teamName: string, taskId: string, retries?: number): Promise<TaskFile> {
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const legacyTask = await bridge.get(taskId);
      return legacyToTaskFile(legacyTask);
    }
  }

  // Fall back to JSON files
  const p = getTaskPath(teamName, taskId);
  if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
  return await withLock(p, async () => {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }, retries);
}

export async function listTasks(teamName: string): Promise<TaskFile[]> {
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      const legacyTasks = await bridge.list();
      return legacyTasks.map(legacyToTaskFile);
    }
  }

  // Fall back to JSON files
  const dir = taskDir(teamName);
  return await withLock(dir, async () => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    const tasks: TaskFile[] = files
      .map(f => {
        const id = parseInt(path.parse(f).name, 10);
        if (isNaN(id)) return null;
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      })
      .filter(t => t !== null);
    return tasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
  });
}

export async function resetOwnerTasks(teamName: string, agentName: string) {
  // Try to use td if available
  const tdProjectDir = detectTd();
  if (tdProjectDir) {
    const bridge = getTdBridge(teamName, tdProjectDir);
    if (bridge) {
      // Get all tasks and reset owner on matching ones
      const tasks = await bridge.list();
      for (const task of tasks) {
        if (task.owner === agentName) {
          await bridge.update(task.id, {
            status: task.status === "completed" ? "completed" : "pending",
          });
        }
      }
      return;
    }
  }

  // Fall back to JSON files
  const dir = taskDir(teamName);
  const lockPath = dir;

  await withLock(lockPath, async () => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      const p = path.join(dir, f);
      const task: TaskFile = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (task.owner === agentName) {
        task.owner = undefined;
        if (task.status !== "completed") {
          task.status = "pending";
        }
        fs.writeFileSync(p, JSON.stringify(task, null, 2));
      }
    }
  });
}
