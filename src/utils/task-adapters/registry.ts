/**
 * Task Adapter Registry
 *
 * Manages task adapters and provides automatic selection based on
 * the current environment.
 */

import { TaskAdapter } from "./task-adapter";
import { JsonTaskAdapter } from "./json-adapter";
import { TdTaskAdapter } from "./td-adapter";

// Re-export for testing
export { JsonTaskAdapter, TdTaskAdapter };

/**
 * Available task adapters, ordered by priority (first match wins)
 *
 * Detection order:
 * 1. td - if `td` CLI is in PATH and project has .todos/ or .git
 * 2. json - always available as fallback
 */
const adapters: TaskAdapter[] = [
  new TdTaskAdapter(),
  new JsonTaskAdapter(),
];

/**
 * Cached detected adapter
 */
let cachedAdapter: TaskAdapter | null = null;

/**
 * Detect and return the appropriate task adapter for the current environment.
 *
 * @returns The detected task adapter
 */
export function getTaskAdapter(): TaskAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  for (const adapter of adapters) {
    if (adapter.detect()) {
      cachedAdapter = adapter;
      console.log(`[pi-teams] Using task adapter: ${adapter.name}`);
      return adapter;
    }
  }

  // Should never happen - JsonTaskAdapter always returns true
  const fallback = new JsonTaskAdapter();
  cachedAdapter = fallback;
  return fallback;
}

/**
 * Get a specific adapter by name.
 *
 * @param name - The adapter name (e.g., "td", "json")
 * @returns The adapter instance, or undefined if not found
 */
export function getAdapterByName(name: string): TaskAdapter | undefined {
  return adapters.find(a => a.name === name);
}

/**
 * Get all available adapters.
 *
 * @returns Array of all registered adapters
 */
export function getAllAdapters(): TaskAdapter[] {
  return [...adapters];
}

/**
 * Clear the cached adapter (useful for testing or environment changes)
 */
export function clearAdapterCache(): void {
  cachedAdapter = null;
}

/**
 * Set a specific adapter (useful for testing or forced selection)
 */
export function setAdapter(adapter: TaskAdapter): void {
  cachedAdapter = adapter;
}

/**
 * Check if td is the active adapter.
 *
 * @returns true if td is currently being used
 */
export function isTdActive(): boolean {
  return getTaskAdapter().name === "td";
}

/**
 * Check if td is available (regardless of current selection).
 *
 * @returns true if td could be used
 */
export function isTdAvailable(): boolean {
  const tdAdapter = adapters.find(a => a.name === "td");
  return tdAdapter?.detect() ?? false;
}
