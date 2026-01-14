import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  escapeForShell,
  setupMcpTools,
  spawnAgent,
  spawnReproducerAgent,
  spawnFixerAgent,
  type SpawnAgentOptions,
} from "../agents.js";
import type { IpcServer } from "../ipc-server.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock sandbox
vi.mock("../sandbox.js", () => ({
  runInSession: vi.fn(),
}));

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { runInSession } from "../sandbox.js";

// Helper to create a mock child process
function createMockProcess(exitCode: number = 0, stdout: string = "", stderr: string = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
  });

  // Emit data and close after a short delay
  setTimeout(() => {
    if (stdout) {
      proc.stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      proc.stderr.emit("data", Buffer.from(stderr));
    }
    proc.emit("close", exitCode);
  }, 10);

  return proc;
}

// Helper to create a mock IpcServer
function createMockIpcServer(options: {
  timedOut?: boolean;
  elapsedMs?: number;
} = {}): IpcServer {
  return {
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    hasTimedOut: vi.fn().mockReturnValue(options.timedOut ?? false),
    getElapsedMs: vi.fn().mockReturnValue(options.elapsedMs ?? 1000),
    isPaused: vi.fn().mockReturnValue(false),
    getPort: vi.fn().mockReturnValue(9100),
    start: vi.fn(),
    stop: vi.fn(),
    getApp: vi.fn(),
  } as unknown as IpcServer;
}

describe("agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe("escapeForShell", () => {
    it("should wrap string in single quotes", () => {
      expect(escapeForShell("hello")).toBe("'hello'");
    });

    it("should escape embedded single quotes", () => {
      expect(escapeForShell("it's")).toBe("'it'\\''s'");
    });

    it("should handle multiple single quotes", () => {
      expect(escapeForShell("don't won't can't")).toBe(
        "'don'\\''t won'\\''t can'\\''t'"
      );
    });

    it("should handle empty string", () => {
      expect(escapeForShell("")).toBe("''");
    });

    it("should preserve special characters except single quotes", () => {
      expect(escapeForShell('hello "world" $var')).toBe("'hello \"world\" $var'");
    });

    it("should handle newlines", () => {
      expect(escapeForShell("line1\nline2")).toBe("'line1\nline2'");
    });

    it("should handle backslashes", () => {
      expect(escapeForShell("path\\to\\file")).toBe("'path\\to\\file'");
    });
  });

  describe("setupMcpTools", () => {
    it("should run claude mcp add command in session", async () => {
      (runInSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await setupMcpTools("test-session");

      expect(runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("claude mcp add panic-tools")
      );
      expect(runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("--scope project")
      );
      expect(runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("--transport stdio")
      );
    });

    it("should use custom tools path when provided", async () => {
      (runInSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await setupMcpTools("test-session", "/custom/tools/server.ts");

      expect(runInSession).toHaveBeenCalledWith(
        "test-session",
        expect.stringContaining("/custom/tools/server.ts")
      );
    });

    it("should propagate errors when runInSession fails", async () => {
      (runInSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Session command failed")
      );

      await expect(setupMcpTools("test-session")).rejects.toThrow(
        "Session command failed"
      );
    });
  });

  describe("spawnAgent", () => {
    it("should spawn claude via agentfs with correct arguments", async () => {
      const mockProc = createMockProcess(0, "agent output", "");
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);

      const ipcServer = createMockIpcServer();
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "Test prompt",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        "agentfs",
        [
          "run",
          "--session",
          "test-session",
          "claude",
          "--dangerously-skip-permissions",
          "--print",
          "text",
          "--prompt",
          "'Test prompt'",
        ],
        expect.objectContaining({
          env: expect.objectContaining({
            PANIC_LOCATION: "src/vdbe.c:1234",
          }),
        })
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("agent output");
      expect(result.timedOut).toBe(false);
    });

    it("should start and stop tracking via IpcServer", async () => {
      const mockProc = createMockProcess(0);
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);

      const ipcServer = createMockIpcServer();
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "prompt",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);
      await vi.advanceTimersByTimeAsync(50);
      await resultPromise;

      expect(ipcServer.startTracking).toHaveBeenCalledWith("src/vdbe.c:1234");
      expect(ipcServer.stopTracking).toHaveBeenCalledWith("src/vdbe.c:1234");
    });

    it("should handle non-zero exit code", async () => {
      const mockProc = createMockProcess(1, "", "error occurred");
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);

      const ipcServer = createMockIpcServer();
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "prompt",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("error occurred");
    });

    it("should mark as timed out and kill process when timeout exceeded", async () => {
      // Create a process that doesn't complete
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = vi.fn(() => {
        proc.killed = true;
        // Emit close after kill
        setTimeout(() => proc.emit("close", 143), 5);
      });

      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(proc);

      const ipcServer = createMockIpcServer({ timedOut: true, elapsedMs: 61000 });
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "prompt",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);

      // Advance past the poll interval to trigger timeout check
      await vi.advanceTimersByTimeAsync(1100);
      const result = await resultPromise;

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
    });

    it("should escape prompt content with special characters", async () => {
      const mockProc = createMockProcess(0);
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);

      const ipcServer = createMockIpcServer();
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "Fix this bug: it's broken",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);
      await vi.advanceTimersByTimeAsync(50);
      await resultPromise;

      expect(spawn).toHaveBeenCalledWith(
        "agentfs",
        expect.arrayContaining(["'Fix this bug: it'\\''s broken'"]),
        expect.any(Object)
      );
    });

    it("should return elapsed time from IpcServer", async () => {
      const mockProc = createMockProcess(0);
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);

      const ipcServer = createMockIpcServer({ elapsedMs: 5000 });
      const options: SpawnAgentOptions = {
        sessionName: "test-session",
        panicLocation: "src/vdbe.c:1234",
        promptContent: "prompt",
        timeoutMs: 60000,
        ipcServer,
      };

      const resultPromise = spawnAgent(options);
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result.elapsedMs).toBe(5000);
    });
  });

  describe("spawnReproducerAgent", () => {
    it("should read prompt file and use reproducer timeout", async () => {
      const mockProc = createMockProcess(0, "output", "");
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue("Reproducer prompt content");

      const ipcServer = createMockIpcServer();
      const config = { reproducerTimeoutMs: 3600000 };

      const resultPromise = spawnReproducerAgent(
        "test-session",
        "src/vdbe.c:1234",
        "/path/to/reproducer.md",
        config,
        ipcServer
      );
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(readFile).toHaveBeenCalledWith("/path/to/reproducer.md", "utf-8");
      expect(spawn).toHaveBeenCalledWith(
        "agentfs",
        expect.arrayContaining(["'Reproducer prompt content'"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it("should throw with context when prompt file cannot be read", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT: no such file or directory")
      );

      const ipcServer = createMockIpcServer();
      const config = { reproducerTimeoutMs: 3600000 };

      await expect(
        spawnReproducerAgent(
          "test-session",
          "src/vdbe.c:1234",
          "/nonexistent/prompt.md",
          config,
          ipcServer
        )
      ).rejects.toThrow("Failed to read reproducer prompt at /nonexistent/prompt.md");
    });
  });

  describe("spawnFixerAgent", () => {
    it("should read prompt file and use fixer timeout", async () => {
      const mockProc = createMockProcess(0, "output", "");
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue("Fixer prompt content");

      const ipcServer = createMockIpcServer();
      const config = { fixerTimeoutMs: 3600000 };

      const resultPromise = spawnFixerAgent(
        "test-session",
        "src/vdbe.c:1234",
        "/path/to/fixer.md",
        config,
        ipcServer
      );
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(readFile).toHaveBeenCalledWith("/path/to/fixer.md", "utf-8");
      expect(spawn).toHaveBeenCalledWith(
        "agentfs",
        expect.arrayContaining(["'Fixer prompt content'"]),
        expect.any(Object)
      );
      expect(result.success).toBe(true);
    });

    it("should throw with context when prompt file cannot be read", async () => {
      (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ENOENT: no such file or directory")
      );

      const ipcServer = createMockIpcServer();
      const config = { fixerTimeoutMs: 3600000 };

      await expect(
        spawnFixerAgent(
          "test-session",
          "src/vdbe.c:1234",
          "/nonexistent/fixer.md",
          config,
          ipcServer
        )
      ).rejects.toThrow("Failed to read fixer prompt at /nonexistent/fixer.md");
    });
  });
});
