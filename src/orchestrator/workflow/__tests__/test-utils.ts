// Shared test utilities for workflow state tests

import { vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../../config.js";
import type { DatabaseClient, PanicFix } from "../../database.js";
import type { Logger } from "../../logger.js";
import type { IpcServer } from "../../ipc-server.js";
import type { SandboxManager, ExecResult } from "../../sandbox.js";
import { runInSession, deleteSession } from "../../sandbox.js";

// Check if agentfs is available
export function checkAgentFsAvailable(): boolean {
  try {
    execSync("agentfs --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Mock factories
export function createMockLogger(): Logger {
  return {
    debug: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger;
}

export function createMockDb(): DatabaseClient {
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
  } as unknown as DatabaseClient;
}

export function createMockIpcServer(): IpcServer {
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
  } as unknown as IpcServer;
}

export function createMockConfig(overrides?: Partial<Config>): Config {
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
    ...overrides,
  };
}

export function createMockPanic(overrides?: Partial<PanicFix>): PanicFix {
  return {
    panic_location: "src/test.c:100",
    status: "pending",
    panic_message: "test assertion failed",
    sql_statements: "SELECT 1;",
    branch_name: null,
    pr_url: null,
    retry_count: 0,
    workflow_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Result builders for sandbox mocking
export function successResult(stdout = ""): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

export function failureResult(stderr: string, exitCode = 1): ExecResult {
  return { stdout: "", stderr, exitCode };
}

// Mock sandbox factory
export function createMockSandbox(
  runInSessionImpl?: ReturnType<typeof vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>>
): SandboxManager {
  const defaultImpl = vi.fn<(sessionName: string, command: string) => Promise<ExecResult>>().mockResolvedValue(successResult());
  return {
    runInSession: runInSessionImpl ?? defaultImpl,
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sessionExists: vi.fn().mockResolvedValue(true),
  };
}

// Integration test helpers
export interface TempGitRepo {
  tempDir: string;
  sandbox: SandboxManager;
  cleanup: () => Promise<void>;
}

export async function createTempGitRepo(): Promise<TempGitRepo> {
  const tempDir = await mkdtemp(join(tmpdir(), "workflow-test-"));

  // Initialize git repo
  execSync("git init", { cwd: tempDir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: "ignore" });
  execSync('git config user.name "Test User"', { cwd: tempDir, stdio: "ignore" });

  // Create initial commit
  execSync("touch README.md", { cwd: tempDir, stdio: "ignore" });
  execSync("git add README.md", { cwd: tempDir, stdio: "ignore" });
  execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: "ignore" });

  // Create test directory
  execSync("mkdir -p test", { cwd: tempDir, stdio: "ignore" });

  const sandbox: SandboxManager = {
    runInSession: (sessionName, command) => runInSession(sessionName, command, { cwd: tempDir }),
    deleteSession: (sessionName) => deleteSession(sessionName, tempDir),
    sessionExists: async () => true,
  };

  const cleanup = async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { tempDir, sandbox, cleanup };
}
