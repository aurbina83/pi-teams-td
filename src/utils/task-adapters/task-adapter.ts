/**
 * Task Adapter Interface
 * 
 * Abstracts task storage backends (JSON files, td, etc.)
 * to provide a unified API for task management.
 */

import { TaskFile } from "./models";

export interface TaskAdapter {
  /** Unique name identifier for this backend */
  readonly name: string;

  /**
   * Check if this adapter is available/initialized.
   * @returns true if this adapter should be used
   */
  detect(): boolean;

  /**
   * Initialize the adapter if needed.
   * @returns true if initialization succeeded
   */
  init(): boolean;

  /**
   * Create a new task.
   */
  create(teamName: string, subject: string, description: string, activeForm?: string, metadata?: Record<string, any>): Promise<TaskFile>;

  /**
   * Get a task by ID.
   */
  get(teamName: string, taskId: string): Promise<TaskFile>;

  /**
   * List all tasks for a team.
   */
  list(teamName: string): Promise<TaskFile[]>;

  /**
   * Update a task.
   */
  update(teamName: string, taskId: string, updates: Partial<TaskFile>): Promise<TaskFile>;

  /**
   * Delete a task.
   */
  delete(teamName: string, taskId: string): Promise<void>;

  /**
   * Submit a plan for a task.
   */
  submitPlan(teamName: string, taskId: string, plan: string): Promise<TaskFile>;

  /**
   * Evaluate a submitted plan.
   */
  evaluatePlan(teamName: string, taskId: string, action: "approve" | "reject", feedback?: string): Promise<TaskFile>;

  /**
   * Log progress on a task.
   */
  log(teamName: string, taskId: string, message: string): Promise<void>;

  /**
   * Record a structured handoff.
   */
  handoff(teamName: string, taskId: string, handoff: { done: string; remaining: string; decision?: string; uncertain?: string }): Promise<void>;
}
