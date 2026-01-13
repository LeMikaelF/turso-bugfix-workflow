// Structured logging to database

import type { DatabaseClient } from "./database.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Phase =
  | "preflight"
  | "repo_setup"
  | "reproducer"
  | "fixer"
  | "ship"
  | "orchestrator";

export interface LogPayload {
  panic_location: string;
  phase: Phase;
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  consoleOutput?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private db: DatabaseClient;
  private minLevel: number;
  private consoleOutput: boolean;

  constructor(db: DatabaseClient, options: LoggerOptions = {}) {
    this.db = db;
    this.minLevel = LOG_LEVELS[options.minLevel ?? "info"];
    this.consoleOutput = options.consoleOutput ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatConsoleMessage(payload: LogPayload): string {
    const levelPrefix = payload.level.toUpperCase().padEnd(5);
    const phase = payload.phase.padEnd(12);
    return `[${payload.timestamp}] ${levelPrefix} [${phase}] [${payload.panic_location}] ${payload.message}`;
  }

  async log(payload: Omit<LogPayload, "timestamp">): Promise<void> {
    if (!this.shouldLog(payload.level)) {
      return;
    }

    const fullPayload: LogPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    // Write to console if enabled
    if (this.consoleOutput) {
      const consoleMsg = this.formatConsoleMessage(fullPayload);
      switch (payload.level) {
        case "debug":
          console.debug(consoleMsg);
          break;
        case "info":
          console.info(consoleMsg);
          break;
        case "warn":
          console.warn(consoleMsg);
          break;
        case "error":
          console.error(consoleMsg);
          break;
      }
    }

    // Write to database
    await this.db.insertLog(fullPayload);
  }

  async debug(
    panicLocation: string,
    phase: Phase,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      panic_location: panicLocation,
      phase,
      level: "debug",
      message,
      ...(metadata !== undefined && { metadata }),
    });
  }

  async info(
    panicLocation: string,
    phase: Phase,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      panic_location: panicLocation,
      phase,
      level: "info",
      message,
      ...(metadata !== undefined && { metadata }),
    });
  }

  async warn(
    panicLocation: string,
    phase: Phase,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      panic_location: panicLocation,
      phase,
      level: "warn",
      message,
      ...(metadata !== undefined && { metadata }),
    });
  }

  async error(
    panicLocation: string,
    phase: Phase,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      panic_location: panicLocation,
      phase,
      level: "error",
      message,
      ...(metadata !== undefined && { metadata }),
    });
  }

  // Convenience method for logging without a specific panic context
  async system(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      panic_location: "system",
      phase: "orchestrator",
      level,
      message,
      ...(metadata !== undefined && { metadata }),
    });
  }
}

// Factory function for creating a logger
export function createLogger(
  db: DatabaseClient,
  options?: LoggerOptions
): Logger {
  return new Logger(db, options);
}
