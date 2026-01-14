/**
 * Integration tests for repo-setup state handler using real AgentFS sandboxes.
 *
 * These tests require AgentFS to be installed and accessible in PATH.
 * They create real git repositories and run real git commands in sandboxes.
 *
 * Run with: npm test -- repo-setup.integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRepoSetup } from "../states/repo-setup.js";
import type { WorkflowContext } from "../types.js";
import type { PanicFix } from "../../database.js";
import type { SandboxManager } from "../../sandbox.js";
import { runInSession, deleteSession } from "../../sandbox.js";

// Check if agentfs is available synchronously at module load time
function checkAgentFsAvailable(): boolean {
  try {
    execSync("agentfs --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const agentfsAvailable = checkAgentFsAvailable();

// Create mock dependencies that don't need real implementations
function createMockLogger() {
  return {
    debug: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDb() {
  return {
    connect: vi.fn(),
    close: vi.fn(),
    initSchema: vi.fn(),
    createPanicFix: vi.fn(),
    getPanicFix: vi.fn(),
    getPendingPanics: vi.fn(),
    updatePanicStatus: vi.fn(),
    incrementRetryCount: vi.fn(),
    resetRetryCount: vi.fn(),
    markNeedsHumanReview: vi.fn(),
    insertLog: vi.fn(),
    getLogs: vi.fn(),
    getLogsByPanicLocation: vi.fn(),
  };
}

function createMockIpcServer() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getApp: vi.fn(),
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    getElapsedMs: vi.fn().mockReturnValue(0),
    isPaused: vi.fn().mockReturnValue(false),
    hasTimedOut: vi.fn().mockReturnValue(false),
    getPort: vi.fn().mockReturnValue(9100),
  };
}

function createMockConfig() {
  return {
    tursoUrl: ":memory:",
    tursoAuthToken: "",
    baseRepoPath: "/tmp",
    maxParallelPanics: 2,
    reproducerTimeoutMs: 60 * 60 * 1000,
    fixerTimeoutMs: 60 * 60 * 1000,
    githubToken: "test-token",
    githubRepo: "test/repo",
    prReviewer: "@test",
    prLabels: [],
    ipcPort: 9100,
    dryRun: false,
  };
}

describe.skipIf(!agentfsAvailable)("repo-setup integration", () => {
  // Generate unique session names
  const testSessionPrefix = `test-repo-setup-${Date.now()}`;
  let sessionCounter = 0;
  const getUniqueSessionName = () => `${testSessionPrefix}-${sessionCounter++}`;

  // Track sessions and temp dirs for cleanup
  const createdSessions: string[] = [];
  let tempDir: string;
  let sandbox: SandboxManager;

  beforeEach(async () => {
    // Create a temp directory for the test git repo
    tempDir = await mkdtemp(join(tmpdir(), "repo-setup-test-"));

    // Initialize a git repo in the temp directory
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test User"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create initial commit on main
    execSync("touch README.md", { cwd: tempDir, stdio: "ignore" });
    execSync("git add README.md", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create test directory for TCL tests
    execSync("mkdir -p test", { cwd: tempDir, stdio: "ignore" });

    // Create sandbox manager bound to the temp dir
    sandbox = {
      runInSession: (sessionName, command) =>
        runInSession(sessionName, command, { cwd: tempDir }),
      deleteSession: (sessionName) => deleteSession(sessionName, tempDir),
      sessionExists: async () => true,
    };
  });

  afterEach(async () => {
    // Clean up all sessions created during tests
    for (const session of createdSessions) {
      try {
        await deleteSession(session, tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessions.length = 0;

    // Clean up temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("should create branch, TCL test, and panic_context.md", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    const panic: PanicFix = {
      panic_location: "src/vdbe.c:1234",
      status: "pending",
      panic_message: "assertion failed: pCur->isValid",
      sql_statements: "SELECT * FROM t1;\nINSERT INTO t1 VALUES(1);",
      branch_name: null,
      pr_url: null,
      retry_count: 0,
      workflow_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const ctx: WorkflowContext = {
      panic,
      sessionName,
      branchName: "fix/panic-src-vdbe.c-1234",
      config: createMockConfig(),
      db: createMockDb() as any,
      logger: createMockLogger() as any,
      ipcServer: createMockIpcServer() as any,
      sandbox,
    };

    const result = await handleRepoSetup(ctx);

    expect(result.nextStatus).toBe("reproducing");
    expect(result.error).toBeUndefined();

    // Verify branch was created
    const branchResult = await sandbox.runInSession(
      sessionName,
      "git branch --show-current"
    );
    expect(branchResult.stdout.trim()).toBe("fix/panic-src-vdbe.c-1234");

    // Verify TCL test file was created
    const tclFileResult = await sandbox.runInSession(
      sessionName,
      "cat test/panic-src-vdbe.c-1234.test"
    );
    expect(tclFileResult.exitCode).toBe(0);
    expect(tclFileResult.stdout).toContain("Auto-generated test for panic");
    expect(tclFileResult.stdout).toContain("SELECT * FROM t1;");
    expect(tclFileResult.stdout).toContain("INSERT INTO t1 VALUES(1);");

    // Verify panic_context.md was created
    const contextResult = await sandbox.runInSession(
      sessionName,
      "cat panic_context.md"
    );
    expect(contextResult.exitCode).toBe(0);
    expect(contextResult.stdout).toContain("src/vdbe.c:1234");
    expect(contextResult.stdout).toContain("assertion failed: pCur->isValid");
    expect(contextResult.stdout).toContain("```json");

    // Verify commit was made
    const logResult = await sandbox.runInSession(
      sessionName,
      "git log --oneline -1"
    );
    expect(logResult.stdout).toContain("setup: src/vdbe.c:1234");
  });

  it("should handle SQL statements with special characters", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    const panic: PanicFix = {
      panic_location: "src/parse.c:500",
      status: "pending",
      panic_message: "can't parse expression",
      sql_statements: "SELECT 'it''s a test';\nSELECT \"double quoted\";",
      branch_name: null,
      pr_url: null,
      retry_count: 0,
      workflow_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const ctx: WorkflowContext = {
      panic,
      sessionName,
      branchName: "fix/panic-src-parse.c-500",
      config: createMockConfig(),
      db: createMockDb() as any,
      logger: createMockLogger() as any,
      ipcServer: createMockIpcServer() as any,
      sandbox,
    };

    const result = await handleRepoSetup(ctx);

    expect(result.nextStatus).toBe("reproducing");

    // Verify the SQL was written correctly
    const tclResult = await sandbox.runInSession(
      sessionName,
      "cat test/panic-src-parse.c-500.test"
    );
    expect(tclResult.stdout).toContain("it''s a test");
    expect(tclResult.stdout).toContain("double quoted");
  });

  it("should fail gracefully when branch already exists", async () => {
    const sessionName = getUniqueSessionName();
    createdSessions.push(sessionName);

    // Pre-create the branch
    await sandbox.runInSession(
      sessionName,
      "git checkout -b fix/panic-src-exists.c-100"
    );
    await sandbox.runInSession(sessionName, "git checkout main");

    const panic: PanicFix = {
      panic_location: "src/exists.c:100",
      status: "pending",
      panic_message: "test error",
      sql_statements: "SELECT 1;",
      branch_name: null,
      pr_url: null,
      retry_count: 0,
      workflow_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const ctx: WorkflowContext = {
      panic,
      sessionName,
      branchName: "fix/panic-src-exists.c-100",
      config: createMockConfig(),
      db: createMockDb() as any,
      logger: createMockLogger() as any,
      ipcServer: createMockIpcServer() as any,
      sandbox,
    };

    const result = await handleRepoSetup(ctx);

    expect(result.nextStatus).toBe("needs_human_review");
    expect(result.error).toContain("Failed to create branch");
  });
});
