// Claude Code agent spawning in AgentFS sessions

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { IpcServer } from "./ipc-server.js";
import type { Config } from "./config.js";
import { runInSession } from "./sandbox.js";

export interface SpawnAgentOptions {
  sessionName: string;
  panicLocation: string;
  promptContent: string;
  timeoutMs: number;
  ipcServer: IpcServer;
  mcpToolsPath?: string;
}

export interface AgentResult {
  success: boolean;
  timedOut: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

// Poll interval for checking timeout
const POLL_INTERVAL_MS = 1000;

// Default MCP tools path
const DEFAULT_MCP_TOOLS_PATH = "/opt/tools/server.ts";

/**
 * Escape a string for safe use in shell command line.
 * Wraps the string in single quotes and escapes embedded single quotes.
 */
export function escapeForShell(str: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Set up MCP tools in a session by adding the panic-tools MCP server.
 *
 * @param sessionName - The session to configure
 * @param toolsPath - Path to the MCP tools server script
 */
export async function setupMcpTools(
  sessionName: string,
  toolsPath: string = DEFAULT_MCP_TOOLS_PATH
): Promise<void> {
  const command = `claude mcp add panic-tools --scope project --transport stdio "npx tsx ${toolsPath}"`;
  await runInSession(sessionName, command);
}

/**
 * Spawn a Claude Code agent in an AgentFS session.
 *
 * The agent runs with --dangerously-skip-permissions and --print text flags.
 * Timeout tracking is done via the IpcServer, which excludes simulator runtime.
 *
 * @param options - Agent spawn options
 * @returns AgentResult with success status, output, and timing info
 */
export async function spawnAgent(options: SpawnAgentOptions): Promise<AgentResult> {
  const {
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs,
    ipcServer,
  } = options;

  // Start timeout tracking (excludes simulator pauses)
  ipcServer.startTracking(panicLocation);

  const escapedPrompt = escapeForShell(promptContent);

  // Spawn Claude Code via agentfs run
  const proc: ChildProcess = spawn(
    "agentfs",
    [
      "run",
      "--session",
      sessionName,
      "claude",
      "--dangerously-skip-permissions",
      "--print",
      "text",
      "--prompt",
      escapedPrompt,
    ],
    {
      env: {
        ...process.env,
        PANIC_LOCATION: panicLocation,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  let killed = false;
  let processExited = false;

  // Collect stdout
  proc.stdout?.on("data", (data: Buffer) => {
    stdout += data.toString();
  });

  // Collect stderr
  proc.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  // Set up timeout polling (checks if process still running to avoid race condition)
  const timeoutCheck = setInterval(() => {
    if (!processExited && ipcServer.hasTimedOut(panicLocation, timeoutMs)) {
      killed = true;
      proc.kill("SIGTERM");
      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }
  }, POLL_INTERVAL_MS);

  // Wait for process to complete
  const exitCode = await new Promise<number>((resolve) => {
    proc.on("close", (code) => {
      processExited = true;
      resolve(code ?? 1);
    });
    proc.on("error", () => {
      processExited = true;
      resolve(1);
    });
  });

  // Clean up
  clearInterval(timeoutCheck);
  const elapsedMs = ipcServer.getElapsedMs(panicLocation);
  ipcServer.stopTracking(panicLocation);

  return {
    success: exitCode === 0 && !killed,
    timedOut: killed,
    exitCode,
    stdout,
    stderr,
    elapsedMs,
  };
}

/**
 * Spawn a reproducer agent with the reproducer prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the reproducer prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnReproducerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "reproducerTimeoutMs">,
  ipcServer: IpcServer
): Promise<AgentResult> {
  let promptContent: string;
  try {
    promptContent = await readFile(promptPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read reproducer prompt at ${promptPath}: ${message}`);
  }

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.reproducerTimeoutMs,
    ipcServer,
  });
}

/**
 * Spawn a fixer agent with the fixer prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the fixer prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnFixerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "fixerTimeoutMs">,
  ipcServer: IpcServer
): Promise<AgentResult> {
  let promptContent: string;
  try {
    promptContent = await readFile(promptPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read fixer prompt at ${promptPath}: ${message}`);
  }

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.fixerTimeoutMs,
    ipcServer,
  });
}
