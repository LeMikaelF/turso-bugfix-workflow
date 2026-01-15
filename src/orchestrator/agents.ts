// Claude Code agent spawning in AgentFS sessions

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { IpcServer } from "./ipc-server.js";
import type { Config } from "./config.js";
import { runInSession } from "./sandbox.js";

// Stream event types for real-time agent output
export interface StreamEvent {
  type: "text" | "thinking" | "tool" | "tool_result" | "error";
  content: string;
}

// Type definition for Claude Code stream-json messages
interface ClaudeStreamMessage {
  type: "system" | "result" | "assistant" | "tool_use" | "tool_result" | "error";
  message?: {
    content?: Array<{
      type: string;
      thinking?: string;
      text?: string;
    }>;
  };
  tool?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  error?: { message?: string };
}

export type StreamCallback = (event: StreamEvent) => void;

export interface SpawnAgentOptions {
  sessionName: string;
  panicLocation: string;
  promptContent: string;
  timeoutMs: number;
  ipcServer: IpcServer;
  mcpToolsPath?: string | undefined;
  onStream?: StreamCallback | undefined;
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
 * Parse a stream-json line from Claude Code and extract useful info.
 * Returns an array of StreamEvents (may be empty if line contains no useful info).
 */
export function parseStreamLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];

  try {
    const data = JSON.parse(line) as ClaudeStreamMessage;

    // Filter out noise
    if (data.type === "system" || data.type === "result") {
      return [];
    }

    // Handle error events
    if (data.type === "error") {
      return [{
        type: "error",
        content: data.error?.message ?? "Unknown error",
      }];
    }

    // Handle assistant messages - may contain multiple blocks
    if (data.type === "assistant" && data.message?.content) {
      const events: StreamEvent[] = [];
      const content = data.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            events.push({ type: "thinking", content: block.thinking });
          }
          if (block.type === "text" && block.text) {
            events.push({ type: "text", content: block.text });
          }
        }
      }
      return events;
    }

    // Handle tool use - show tool name and brief input summary
    if (data.type === "tool_use" && data.tool) {
      let summary = data.tool;
      const input = data.input;
      if (input) {
        // Add brief context based on tool type
        if (data.tool === "Read" && input.file_path) {
          summary = `Read: ${input.file_path}`;
        } else if (data.tool === "Edit" && input.file_path) {
          summary = `Edit: ${input.file_path}`;
        } else if (data.tool === "Write" && input.file_path) {
          summary = `Write: ${input.file_path}`;
        } else if (data.tool === "Bash" && input.command) {
          const cmd = String(input.command);
          summary = `Bash: ${cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd}`;
        } else if (data.tool === "Glob" && input.pattern) {
          summary = `Glob: ${input.pattern}`;
        } else if (data.tool === "Grep" && input.pattern) {
          summary = `Grep: ${input.pattern}`;
        }
      }
      return [{ type: "tool", content: summary }];
    }

    // Handle tool results
    if (data.type === "tool_result") {
      const status = data.is_error ? "failed" : "succeeded";
      return [{ type: "tool_result", content: `Tool ${status}` }];
    }

    return [];
  } catch {
    // Invalid JSON, ignore
    return [];
  }
}

/**
 * Create a console stream handler that logs events with timestamp and phase prefix.
 */
export function createConsoleStreamHandler(
  panicLocation: string,
  phase: string
): StreamCallback {
  return (event: StreamEvent) => {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${phase.padEnd(12)}] [${panicLocation}]`;

    switch (event.type) {
      case "thinking":
        console.log(`${prefix} [THINK] ${event.content}`);
        break;
      case "text":
        console.log(`${prefix} [TEXT] ${event.content}`);
        break;
      case "tool":
        console.log(`${prefix} [TOOL] ${event.content}`);
        break;
      case "tool_result":
        console.log(`${prefix} [RESULT] ${event.content}`);
        break;
      case "error":
        console.error(`${prefix} [ERROR] ${event.content}`);
        break;
    }
  };
}

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
    onStream,
  } = options;

  // Start timeout tracking (excludes simulator pauses)
  ipcServer.startTracking(panicLocation);

  const escapedPrompt = escapeForShell(promptContent);

  // Spawn Claude Code via agentfs run with stream-json output
  const proc: ChildProcess = spawn(
    "agentfs",
    [
      "run",
      "--session",
      sessionName,
      "claude",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
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

  const stdoutChunks: string[] = [];
  let stderr = "";
  let killed = false;
  let processExited = false;
  let stdoutBuffer = "";

  // Maximum buffer size to prevent unbounded growth (1MB)
  const MAX_BUFFER_SIZE = 1024 * 1024;

  // Process stdout line-by-line for streaming and collect full output
  proc.stdout?.on("data", (data: Buffer) => {
    const chunk = data.toString();
    stdoutChunks.push(chunk);

    // Process lines for streaming callback
    if (onStream) {
      stdoutBuffer += chunk;

      // Prevent unbounded buffer growth
      if (stdoutBuffer.length > MAX_BUFFER_SIZE) {
        const lastNewline = stdoutBuffer.lastIndexOf("\n");
        if (lastNewline > 0) {
          stdoutBuffer = stdoutBuffer.slice(lastNewline + 1);
        } else {
          stdoutBuffer = stdoutBuffer.slice(-MAX_BUFFER_SIZE / 2);
        }
      }

      const lines = stdoutBuffer.split("\n");
      // Keep the last incomplete line in the buffer
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const events = parseStreamLine(line);
        for (const event of events) {
          onStream(event);
        }
      }
    }
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

      // Process any remaining buffered content
      if (onStream && stdoutBuffer.trim()) {
        const events = parseStreamLine(stdoutBuffer);
        for (const event of events) {
          onStream(event);
        }
      }

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
    stdout: stdoutChunks.join(""),
    stderr,
    elapsedMs,
  };
}

/**
 * Helper function to read a prompt file with consistent error handling.
 */
async function readPromptFile(promptPath: string, promptType: string): Promise<string> {
  try {
    return await readFile(promptPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${promptType} prompt at ${promptPath}: ${message}`);
  }
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
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "reproducer");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.reproducerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
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
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "fixer");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.fixerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
  });
}

/**
 * Spawn a reproducer planner agent with the reproducer-planner prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the reproducer-planner prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnReproducerPlannerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "reproducerPlannerTimeoutMs">,
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "reproducer-planner");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.reproducerPlannerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
  });
}

/**
 * Spawn a reproducer implementer agent with the reproducer-implementer prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the reproducer-implementer prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnReproducerImplementerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "reproducerImplementerTimeoutMs">,
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "reproducer-implementer");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.reproducerImplementerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
  });
}

/**
 * Spawn a fixer planner agent with the fixer-planner prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the fixer-planner prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnFixerPlannerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "fixerPlannerTimeoutMs">,
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "fixer-planner");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.fixerPlannerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
  });
}

/**
 * Spawn a fixer implementer agent with the fixer-implementer prompt.
 *
 * @param sessionName - The AgentFS session name
 * @param panicLocation - The panic location (e.g., "src/vdbe.c:1234")
 * @param promptPath - Path to the fixer-implementer prompt file
 * @param config - Configuration with timeout settings
 * @param ipcServer - IPC server for timeout tracking
 * @returns AgentResult
 */
export async function spawnFixerImplementerAgent(
  sessionName: string,
  panicLocation: string,
  promptPath: string,
  config: Pick<Config, "fixerImplementerTimeoutMs">,
  ipcServer: IpcServer,
  onStream?: StreamCallback
): Promise<AgentResult> {
  const promptContent = await readPromptFile(promptPath, "fixer-implementer");

  return spawnAgent({
    sessionName,
    panicLocation,
    promptContent,
    timeoutMs: config.fixerImplementerTimeoutMs,
    ipcServer,
    ...(onStream && { onStream }),
  });
}
