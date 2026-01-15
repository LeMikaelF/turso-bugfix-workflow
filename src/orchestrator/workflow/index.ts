// Main workflow orchestrator - state machine driver with concurrency control

import type { Config } from "../config.js";
import type { DatabaseClient, PanicFix, PanicStatus } from "../database.js";
import type { Logger } from "../logger.js";
import type { IpcServer } from "../ipc-server.js";
import type { SandboxManager } from "../sandbox.js";
import type { WorkflowContext, StateResult, StateHandler } from "./types.js";
import { getSessionName, getBranchName } from "../encoding.js";
import {
  handlePreflight,
  handleRepoSetup,
  handleReproducing,
  handleFixing,
  handleShipping,
} from "./states/index.js";

// Re-export types
export type { WorkflowContext, StateResult, StateHandler } from "./types.js";

/**
 * State handler registry.
 * Maps each status to its handler function.
 */
const STATE_HANDLERS: Partial<Record<PanicStatus, StateHandler>> = {
  pending: handlePreflight, // pending -> preflight check -> repo_setup
  repo_setup: handleRepoSetup,
  reproducing: handleReproducing,
  fixing: handleFixing,
  shipping: handleShipping,
};

/**
 * Dependencies required by the WorkflowOrchestrator.
 */
export interface WorkflowOrchestratorDeps {
  config: Config;
  db: DatabaseClient;
  logger: Logger;
  ipcServer: IpcServer;
  sandbox: SandboxManager;
}

/**
 * The main workflow orchestrator.
 * Manages concurrent panic processing and drives the state machine.
 */
export class WorkflowOrchestrator {
  private readonly config: Config;
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly ipcServer: IpcServer;
  private readonly sandbox: SandboxManager;

  private shuttingDown = false;
  private readonly inFlightPanics = new Set<string>();

  constructor(deps: WorkflowOrchestratorDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.logger = deps.logger;
    this.ipcServer = deps.ipcServer;
    this.sandbox = deps.sandbox;
  }

  /**
   * Start the orchestrator main loop.
   * Fetches pending panics and processes them up to maxParallelPanics.
   */
  async start(): Promise<void> {
    await this.logger.system("info", "Orchestrator starting", {
      maxParallelPanics: this.config.maxParallelPanics,
    });

    while (!this.shuttingDown) {
      // Check if we can process more panics
      if (this.inFlightPanics.size >= this.config.maxParallelPanics) {
        if (this.shuttingDown) break;
        await this.sleep(1000);
        continue;
      }

      // Fetch next pending panics
      const availableSlots = this.config.maxParallelPanics - this.inFlightPanics.size;
      const panics = await this.db.getPendingPanics(availableSlots);

      if (panics.length === 0) {
        if (this.shuttingDown) break;
        await this.sleep(5000); // Poll interval when no work
        continue;
      }

      // Start processing each panic (non-blocking)
      for (const panic of panics) {
        if (this.shuttingDown) break;
        // Fire and forget - processPanic handles its own errors
        this.processPanic(panic);
      }
    }

    // Wait for in-flight panics to complete
    await this.waitForInFlight();
    await this.logger.system("info", "Orchestrator shutdown complete");
  }

  /**
   * Request graceful shutdown.
   * Stops accepting new panics and waits for in-flight to complete.
   */
  requestShutdown(): void {
    if (this.shuttingDown) return;

    this.shuttingDown = true;
    this.logger.system("info", "Shutdown requested, waiting for in-flight panics", {
      count: this.inFlightPanics.size,
    });
  }

  /**
   * Wait for all in-flight panics to complete.
   */
  async waitForInFlight(): Promise<void> {
    while (this.inFlightPanics.size > 0) {
      await this.logger.system("debug", "Waiting for in-flight panics", {
        count: this.inFlightPanics.size,
        panics: Array.from(this.inFlightPanics),
      });
      await this.sleep(1000);
    }
  }

  /**
   * Check if the orchestrator is shutting down.
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Get the number of in-flight panics.
   */
  getInFlightCount(): number {
    return this.inFlightPanics.size;
  }

  /**
   * Process a single panic through the workflow.
   */
  private async processPanic(panic: PanicFix): Promise<void> {
    const panicLocation = panic.panic_location;
    this.inFlightPanics.add(panicLocation);

    try {
      await this.runWorkflow(panic);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.logger.error(panicLocation, "orchestrator", "Unhandled error", {
        error: message,
      });
      await this.db.markNeedsHumanReview(panicLocation, {
        phase: "orchestrator",
        error: message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.inFlightPanics.delete(panicLocation);
    }
  }

  /**
   * Run the state machine for a panic.
   */
  private async runWorkflow(panic: PanicFix): Promise<void> {
    const panicLocation = panic.panic_location;
    const sessionName = getSessionName(panicLocation);
    const branchName = getBranchName(panicLocation);

    let currentStatus: PanicStatus = panic.status;

    // Create workflow context
    const ctx: WorkflowContext = {
      panic,
      sessionName,
      branchName,
      config: this.config,
      db: this.db,
      logger: this.logger,
      ipcServer: this.ipcServer,
      sandbox: this.sandbox,
    };

    // Drive state machine
    while (currentStatus !== "pr_open" && currentStatus !== "needs_human_review") {
      const handler = STATE_HANDLERS[currentStatus];
      if (!handler) {
        await this.logger.error(
          panicLocation,
          "orchestrator",
          `No handler for status: ${currentStatus}`
        );
        await this.db.markNeedsHumanReview(panicLocation, {
          phase: "orchestrator",
          error: `No handler for status: ${currentStatus}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await this.logger.info(panicLocation, "orchestrator", `Entering state: ${currentStatus}`);

      let result: StateResult;
      try {
        result = await handler(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logger.error(panicLocation, "orchestrator", `Handler threw error`, {
          state: currentStatus,
          error: message,
        });
        await this.db.markNeedsHumanReview(panicLocation, {
          phase: currentStatus,
          error: message,
          timestamp: new Date().toISOString(),
        });
        // Session retained for debugging
        await this.logger.warn(
          panicLocation,
          "orchestrator",
          `Session retained for debugging: ${sessionName}`
        );
        return;
      }

      // Update database with new status
      const updateFields: { branch_name?: string; pr_url?: string } = {};
      if (currentStatus === "repo_setup") {
        updateFields.branch_name = branchName;
      }
      if (result.prUrl) {
        updateFields.pr_url = result.prUrl;
      }

      if (result.error) {
        // Transitioning to needs_human_review
        await this.db.markNeedsHumanReview(panicLocation, {
          phase: currentStatus,
          error: result.error,
          timestamp: new Date().toISOString(),
        });

        // Log warning about retained session for debugging
        await this.logger.warn(
          panicLocation,
          "orchestrator",
          `Session retained for debugging: ${sessionName}`
        );
        return;
      }

      // Normal transition
      await this.db.updatePanicStatus(panicLocation, result.nextStatus, updateFields);
      currentStatus = result.nextStatus;
    }

    // Cleanup on success (skip in dry run mode to allow inspection)
    if (currentStatus === "pr_open") {
      if (this.config.dryRun) {
        await this.logger.info(
          panicLocation,
          "orchestrator",
          `Workflow complete (dry run). Session retained: ${sessionName}`
        );
      } else {
        await this.logger.info(
          panicLocation,
          "orchestrator",
          "Workflow complete, cleaning up session"
        );
        await this.sandbox.deleteSession(sessionName);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create a WorkflowOrchestrator.
 */
export function createWorkflowOrchestrator(deps: WorkflowOrchestratorDeps): WorkflowOrchestrator {
  return new WorkflowOrchestrator(deps);
}
