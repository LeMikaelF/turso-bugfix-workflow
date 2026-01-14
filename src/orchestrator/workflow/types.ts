// Shared types for the workflow state machine

import type { PanicFix, PanicStatus, DatabaseClient } from "../database.js";
import type { Logger } from "../logger.js";
import type { IpcServer } from "../ipc-server.js";
import type { SandboxManager } from "../sandbox.js";
import type { Config } from "../config.js";
import type { PanicContextData } from "../context-parser.js";

/**
 * Context passed to each state handler.
 * Contains all dependencies and panic-specific information.
 */
export interface WorkflowContext {
  panic: PanicFix;
  sessionName: string;
  branchName: string;
  config: Config;
  db: DatabaseClient;
  logger: Logger;
  ipcServer: IpcServer;
  sandbox: SandboxManager;
}

/**
 * Result returned by a state handler.
 */
export interface StateResult {
  /** The next status to transition to */
  nextStatus: PanicStatus;
  /** Context data parsed from panic_context.md (populated by shipping state) */
  contextData?: PanicContextData;
  /** PR URL (populated by shipping state after PR creation) */
  prUrl?: string;
  /** Error message if transitioning to needs_human_review */
  error?: string;
}

/**
 * Function signature for state handlers.
 */
export type StateHandler = (ctx: WorkflowContext) => Promise<StateResult>;

/**
 * Map of status to handler function.
 */
export type StateHandlerMap = Partial<Record<PanicStatus, StateHandler>>;
