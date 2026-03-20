/**
 * TD Adapter Demo
 * 
 * Shows how to use the td adapter for project-scoped task management
 * in pi-teams.
 * 
 * Run: npx ts-node examples/td-demo.ts
 */

import { TdAdapter } from "../src/utils/td-adapter";
import { TdTaskBridge } from "../src/utils/td-task-bridge";

async function demo() {
  console.log("🧪 TD Adapter Demo\n");
  console.log("=" .repeat(50));

  // Initialize adapter for current project
  const adapter = new TdAdapter();
  
  if (!adapter.detect()) {
    console.log("❌ td not detected. Initializing...");
    adapter.init();
  }

  console.log(`✅ Connected to td (session: ${adapter.getSessionId()})\n`);

  // ═══════════════════════════════════════════════════════════════
  // Basic CRUD
  // ═══════════════════════════════════════════════════════════════
  console.log("📝 Creating tasks...");

  const authEpic = adapter.createEpic("User Authentication System", {
    priority: "P0",
    description: "Complete auth overhaul including OAuth, MFA, and session management",
  });
  console.log(`   Created epic: ${authEpic!.id}`);

  const task1 = adapter.create("Implement OAuth2 flow", "Add Google and GitHub OAuth", {
    type: "feature",
    priority: "P1",
    labels: ["auth", "backend"],
  });
  console.log(`   Created: ${task1!.id} - ${task1!.title}`);

  const task2 = adapter.create("Add JWT token generation", "Generate and validate JWTs", {
    type: "feature",
    priority: "P1",
    labels: ["auth", "security"],
    dependsOn: [task1!.id],
  });
  console.log(`   Created: ${task2!.id} - ${task2!.title}`);

  const task3 = adapter.create("Fix token expiry bug", "Tokens expire too quickly", {
    type: "bug",
    priority: "P0",
    labels: ["auth", "urgent"],
  });
  console.log(`   Created: ${task3!.id} - ${task3!.title}`);

  // ═══════════════════════════════════════════════════════════════
  // Workflow
  // ═══════════════════════════════════════════════════════════════
  console.log("\n🚀 Starting work on task...");
  adapter.start(task1!.id);
  
  console.log("\n📝 Logging progress...");
  adapter.log("Set up OAuth2 client credentials");
  adapter.log("Implemented callback handler");
  adapter.log("Added user profile fetching", "decision");
  
  console.log("\n🔒 Logging a blocker...");
  adapter.log("Waiting on backend API spec from team", "blocker");

  // Get updated task
  const updated = adapter.get(task1!.id);
  console.log(`\n📋 Task status: ${updated!.status}`);
  console.log(`   Logs: ${updated!.logs.length} entries`);

  // ═══════════════════════════════════════════════════════════════
  // Structured Handoff
  // ═══════════════════════════════════════════════════════════════
  console.log("\n👋 Recording handoff...");
  adapter.handoff({
    done: "OAuth2 flow implemented with Google and GitHub",
    remaining: "Token refresh logic, error handling, tests",
    decision: "Using JWT RS256 for token signing",
    uncertain: "Should we support refresh token rotation?",
  });
  console.log("   Handoff recorded!");

  // ═══════════════════════════════════════════════════════════════
  // Query & Search
  // ═══════════════════════════════════════════════════════════════
  console.log("\n🔍 Searching...");
  
  const authTasks = adapter.search("auth");
  console.log(`   Found ${authTasks.length} auth-related tasks`);
  
  const critical = adapter.query("priority <= P1 AND type = bug");
  console.log(`   Found ${critical.length} critical bugs`);

  console.log("\n📊 All tasks:");
  const allTasks = adapter.list();
  for (const t of allTasks) {
    const deps = adapter.getDependencies(t.id);
    const depsStr = deps.dependsOn.length ? ` (depends on: ${deps.dependsOn.join(", ")})` : "";
    console.log(`   ${t.id} [${t.priority}] ${t.status}: ${t.title}${depsStr}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Review Workflow
  // ═══════════════════════════════════════════════════════════════
  console.log("\n📤 Submitting for review...");
  adapter.submitReview(task1!.id);
  console.log(`   Status: ${adapter.get(task1!.id)!.status}`);

  console.log("\n✅ Approving...");
  adapter.approve(task1!.id);
  console.log(`   Status: ${adapter.get(task1!.id)!.status}`);

  // ═══════════════════════════════════════════════════════════════
  // Usage Summary
  // ═══════════════════════════════════════════════════════════════
  console.log("\n📊 Current Session Usage:");
  console.log(adapter.usage());

  console.log("\n" + "=".repeat(50));
  console.log("✨ Demo complete!");
  console.log("\nNext steps:");
  console.log("  td list              - List all tasks");
  console.log("  td show <id>         - View task details");
  console.log("  td usage             - See session summary");
  console.log("  td tree <epic-id>    - View epic hierarchy");
}

// Also show the bridge usage
async function bridgeDemo() {
  console.log("\n\n🌉 TD Task Bridge Demo");
  console.log("=".repeat(50));
  console.log("Using td as backend for pi-teams tasks...\n");

  // Create a bridge for a team in the current project
  const bridge = new TdTaskBridge("demo-team");
  
  // Create a task (maps to td issue)
  const task = await bridge.create(
    "Build user profile page",
    "Create a profile page with avatar, bio, and settings",
    "Implementing profile component"
  );
  console.log(`Created task: ${task.id}`);
  console.log(`  Subject: ${task.subject}`);
  console.log(`  Status: ${task.status}`);

  // Log progress
  await bridge.log(task.id, "Created basic layout");
  await bridge.log(task.id, "Added avatar upload");
  
  // Structured handoff
  await bridge.handoff(task.id, {
    done: "Profile page UI complete",
    remaining: "API integration, state management",
    decision: "Using React Query for data fetching",
  });
  console.log("\n📝 Handoff recorded!");

  // List team tasks
  const tasks = await bridge.list();
  console.log(`\n📋 Team has ${tasks.length} tasks`);
}

demo()
  .then(() => bridgeDemo())
  .catch(console.error);
