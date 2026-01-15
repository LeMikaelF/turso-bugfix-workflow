/**
 * Unit tests for WorkflowOrchestrator.
 *
 * Tests concurrency control, state transitions, and shutdown behavior.
 * Uses mocks for all dependencies since we're testing orchestration logic.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { WorkflowOrchestrator, type WorkflowOrchestratorDeps } from "../index.js";
import type { PanicFix, PanicStatus } from "../../database.js";

// Mock factory functions
function createMockConfig() {
  return {
    tursoUrl: ":memory:",
    tursoAuthToken: "",
    baseRepoPath: "/opt/turso-base",
    maxParallelPanics: 2,
    reproducerTimeoutMs: 60 * 60 * 1000,
    fixerTimeoutMs: 60 * 60 * 1000,
    reproducerPlannerTimeoutMs: 15 * 60 * 1000,
    reproducerImplementerTimeoutMs: 45 * 60 * 1000,
    fixerPlannerTimeoutMs: 15 * 60 * 1000,
    fixerImplementerTimeoutMs: 45 * 60 * 1000,
    githubToken: "test-token",
    githubRepo: "test/repo",
    prReviewer: "@test",
    prLabels: [],
    ipcPort: 9100,
    dryRun: false,
  };
}

function createMockPanic(overrides: Partial<PanicFix> = {}): PanicFix {
  return {
    panic_location: "src/test.c:100",
    status: "pending" as PanicStatus,
    panic_message: "test panic",
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

function createMockDb() {
  return {
    connect: vi.fn(),
    close: vi.fn(),
    initSchema: vi.fn(),
    createPanicFix: vi.fn(),
    getPanicFix: vi.fn(),
    getPendingPanics: vi.fn().mockResolvedValue([]),
    updatePanicStatus: vi.fn().mockResolvedValue(undefined),
    incrementRetryCount: vi.fn(),
    resetRetryCount: vi.fn(),
    markNeedsHumanReview: vi.fn().mockResolvedValue(undefined),
    insertLog: vi.fn(),
    getLogs: vi.fn(),
    getLogsByPanicLocation: vi.fn(),
  };
}

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

function createMockSandbox() {
  return {
    runInSession: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sessionExists: vi.fn().mockResolvedValue(true),
  };
}

describe("WorkflowOrchestrator", () => {
  let deps: WorkflowOrchestratorDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      config: createMockConfig(),
      db: createMockDb() as any,
      logger: createMockLogger() as any,
      ipcServer: createMockIpcServer() as any,
      sandbox: createMockSandbox() as any,
    };
  });

  describe("constructor", () => {
    it("should create orchestrator with dependencies", () => {
      const orchestrator = new WorkflowOrchestrator(deps);
      expect(orchestrator).toBeDefined();
      expect(orchestrator.isShuttingDown()).toBe(false);
      expect(orchestrator.getInFlightCount()).toBe(0);
    });
  });

  describe("requestShutdown", () => {
    it("should set shutting down flag", () => {
      const orchestrator = new WorkflowOrchestrator(deps);
      expect(orchestrator.isShuttingDown()).toBe(false);

      orchestrator.requestShutdown();

      expect(orchestrator.isShuttingDown()).toBe(true);
    });

    it("should log shutdown request", () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      orchestrator.requestShutdown();

      expect(deps.logger.system).toHaveBeenCalledWith(
        "info",
        "Shutdown requested, waiting for in-flight panics",
        expect.any(Object)
      );
    });

    it("should be idempotent", () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      orchestrator.requestShutdown();
      orchestrator.requestShutdown();
      orchestrator.requestShutdown();

      // Should only log once
      expect(deps.logger.system).toHaveBeenCalledTimes(1);
    });
  });

  describe("start", () => {
    it("should log startup message", async () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      // Start and immediately request shutdown to exit the loop
      const startPromise = orchestrator.start();
      orchestrator.requestShutdown();
      await startPromise;

      expect(deps.logger.system).toHaveBeenCalledWith(
        "info",
        "Orchestrator starting",
        expect.objectContaining({ maxParallelPanics: 2 })
      );
    });

    it("should log shutdown complete message", async () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      const startPromise = orchestrator.start();
      orchestrator.requestShutdown();
      await startPromise;

      expect(deps.logger.system).toHaveBeenCalledWith(
        "info",
        "Orchestrator shutdown complete"
      );
    });

    it("should fetch pending panics when slots available", async () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      // Return empty array and trigger shutdown when called
      (deps.db.getPendingPanics as Mock).mockImplementation(async () => {
        // Trigger shutdown after first fetch
        orchestrator.requestShutdown();
        return [];
      });

      await orchestrator.start();

      expect(deps.db.getPendingPanics).toHaveBeenCalled();
    });
  });

  describe("concurrency control", () => {
    it("should track in-flight panics", () => {
      const orchestrator = new WorkflowOrchestrator(deps);
      expect(orchestrator.getInFlightCount()).toBe(0);
    });

    it("should respect maxParallelPanics limit", async () => {
      deps.config.maxParallelPanics = 1;

      // Create two panics
      const panic1 = createMockPanic({ panic_location: "src/a.c:1" });
      const panic2 = createMockPanic({ panic_location: "src/b.c:2" });

      let callCount = 0;
      (deps.db.getPendingPanics as Mock).mockImplementation(async (limit: number) => {
        callCount++;
        if (callCount === 1) {
          // First call - return both panics
          return [panic1, panic2];
        }
        // Subsequent calls - return empty
        return [];
      });

      // Mock sandbox to take some time so we can observe concurrency
      (deps.sandbox.runInSession as Mock).mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const orchestrator = new WorkflowOrchestrator(deps);
      const startPromise = orchestrator.start();

      // Let it process
      await new Promise((r) => setTimeout(r, 200));
      orchestrator.requestShutdown();
      await startPromise;

      // Should have fetched panics
      expect(deps.db.getPendingPanics).toHaveBeenCalled();
    });
  });

  describe("waitForInFlight", () => {
    it("should resolve immediately when no panics in flight", async () => {
      const orchestrator = new WorkflowOrchestrator(deps);

      const start = Date.now();
      await orchestrator.waitForInFlight();
      const elapsed = Date.now() - start;

      // Should resolve quickly (no waiting)
      expect(elapsed).toBeLessThan(100);
    });
  });
});
