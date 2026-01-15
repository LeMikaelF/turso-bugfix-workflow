// CLI entry point with main loop and graceful shutdown

import { fileURLToPath } from "url";
import { resolve } from "path";
import { loadConfig, type Config } from "./config.js";
import { createDatabaseClient, type DatabaseClient } from "./database.js";
import { createLogger, type Logger } from "./logger.js";
import { createIpcServer, type IpcServer } from "./ipc-server.js";
import { createSandboxManager, type SandboxManager } from "./sandbox.js";
import {
  createWorkflowOrchestrator,
} from "./workflow/index.js";

/**
 * Dependencies required by the orchestrator.
 * Used for dependency injection in tests.
 */
export interface OrchestratorDeps {
  config: Config;
  db: DatabaseClient;
  logger: Logger;
  ipcServer: IpcServer;
  sandbox: SandboxManager;
}

/**
 * Initialize all dependencies and return them.
 * Handles cleanup of partially initialized resources on failure.
 * This function is exported for testing.
 */
export async function initializeDependencies(): Promise<OrchestratorDeps> {
  // 1. Load configuration (async, no cleanup needed)
  const config = await loadConfig();

  // 2. Initialize database
  const db = await createDatabaseClient({ tursoUrl: config.tursoUrl });

  try {
    await db.initSchema();

    // 3. Create logger
    const logger = createLogger(db);
    await logger.system("info", "Panic Fix Workflow starting", {
      dryRun: config.dryRun,
      maxParallelPanics: config.maxParallelPanics,
    });

    // 4. Create and start IPC server
    const ipcServer = createIpcServer(config.ipcPort);

    try {
      await ipcServer.start();
      await logger.system("info", `IPC server listening on port ${config.ipcPort}`);

      // 5. Create sandbox manager (sync, no cleanup needed)
      const sandbox = createSandboxManager(config);

      return { config, db, logger, ipcServer, sandbox };
    } catch (error) {
      // IPC server failed - stop it if partially started
      try {
        await ipcServer.stop();
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  } catch (error) {
    // Cleanup database on any failure after it was connected
    try {
      await db.close();
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Cleanup resources.
 * Logs completion before closing database (since logger writes to DB).
 * This function is exported for testing.
 */
export async function cleanup(
  deps: Pick<OrchestratorDeps, "ipcServer" | "db" | "logger">
): Promise<void> {
  const { ipcServer, db, logger } = deps;

  await logger.system("info", "Cleaning up...");

  // Stop IPC server first
  try {
    await ipcServer.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error stopping IPC server:", message);
  }

  // Log completion before closing database (logger writes to DB)
  await logger.system("info", "Cleanup complete");

  // Close database last
  try {
    await db.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error closing database:", message);
  }
}

/**
 * Run the orchestrator with the given dependencies.
 * Sets up signal handlers and runs until shutdown.
 * This function is exported for testing.
 */
export async function runOrchestrator(deps: OrchestratorDeps): Promise<void> {
  const { config, db, logger, ipcServer, sandbox } = deps;

  // Create workflow orchestrator
  const orchestrator = createWorkflowOrchestrator({
    config,
    db,
    logger,
    ipcServer,
    sandbox,
  });

  // State for signal handling
  // First signal requests graceful shutdown, second forces exit
  let gracefulShutdownRequested = false;

  const handleShutdown = (): void => {
    if (gracefulShutdownRequested) {
      console.log("Force shutdown...");
      process.exit(1);
    }

    gracefulShutdownRequested = true;
    orchestrator.requestShutdown();
  };

  // Setup signal handlers
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  // Start orchestrator (blocks until shutdown)
  try {
    await orchestrator.start();
  } finally {
    // Remove signal handlers
    process.off("SIGINT", handleShutdown);
    process.off("SIGTERM", handleShutdown);

    // Cleanup resources
    await cleanup({ ipcServer, db, logger });
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const deps = await initializeDependencies();
  await runOrchestrator(deps);
}

// Determine if this is the main module using import.meta.url
// This allows the module to be imported for testing without side effects
const __filename = fileURLToPath(import.meta.url);
const isMainModule = resolve(process.argv[1] ?? "") === resolve(__filename);

if (isMainModule) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
