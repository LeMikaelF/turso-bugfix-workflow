import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInSession, deleteSession, sessionExists, createSandboxManager } from "../sandbox.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  unlink: vi.fn(),
  access: vi.fn(),
}));

// Import mocked modules
import { exec } from "node:child_process";
import { unlink, access } from "node:fs/promises";

// Type for mocked exec
type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

// Helper to create a mock exec implementation
function mockExecSuccess(stdout: string, stderr: string = "") {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, callback?: ExecCallback) => {
      // Handle both (cmd, callback) and (cmd, opts, callback) signatures
      const cb = typeof _opts === "function" ? (_opts as ExecCallback) : callback;
      if (cb) {
        cb(null, { stdout, stderr });
      }
      return { stdout, stderr };
    }
  );
}

function mockExecFailure(code: number, stdout: string = "", stderr: string = "") {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, callback?: ExecCallback) => {
      const cb = typeof _opts === "function" ? (_opts as ExecCallback) : callback;
      if (cb) {
        const error = Object.assign(new Error("Command failed"), {
          code,
          stdout,
          stderr,
        });
        cb(error);
      }
    }
  );
}

describe("sandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("runInSession", () => {
    it("should run a command in a session successfully", async () => {
      mockExecSuccess("hello\n", "");

      const result = await runInSession("test-session", "echo hello");

      expect(exec).toHaveBeenCalledWith(
        "agentfs run --session test-session echo hello",
        expect.any(Object),
        expect.any(Function)
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
    });

    it("should capture stderr on successful command", async () => {
      mockExecSuccess("output", "warning: something");

      const result = await runInSession("test-session", "some-command");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("output");
      expect(result.stderr).toBe("warning: something");
    });

    it("should handle command failure with non-zero exit code", async () => {
      mockExecFailure(1, "", "error: not found");

      const result = await runInSession("test-session", "ls /nonexistent");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("error: not found");
    });

    it("should pass timeout option to exec", async () => {
      mockExecSuccess("done", "");

      await runInSession("test-session", "slow-command", { timeoutMs: 5000 });

      expect(exec).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
    });

    it("should pass cwd option to exec", async () => {
      mockExecSuccess("done", "");

      await runInSession("test-session", "pwd", { cwd: "/some/path" });

      expect(exec).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: "/some/path" }),
        expect.any(Function)
      );
    });

    it("should handle commands with flags", async () => {
      mockExecSuccess("test", "");

      await runInSession("test-session", "echo -n test");

      expect(exec).toHaveBeenCalledWith(
        "agentfs run --session test-session echo -n test",
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should handle commands with multiple arguments", async () => {
      mockExecSuccess("", "");

      await runInSession("my-session", "ls -la /tmp /var");

      expect(exec).toHaveBeenCalledWith(
        "agentfs run --session my-session ls -la /tmp /var",
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe("deleteSession", () => {
    it("should delete session database file", async () => {
      (unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await deleteSession("test-session", "/project");

      expect(unlink).toHaveBeenCalledWith("/project/.agentfs/test-session.db");
    });

    it("should use cwd when agentfsDir not specified", async () => {
      (unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const originalCwd = process.cwd();

      await deleteSession("test-session");

      expect(unlink).toHaveBeenCalledWith(`${originalCwd}/.agentfs/test-session.db`);
    });

    it("should not throw when session does not exist (ENOENT)", async () => {
      const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      (unlink as ReturnType<typeof vi.fn>).mockRejectedValue(enoentError);

      await expect(deleteSession("nonexistent-session")).resolves.not.toThrow();
    });

    it("should throw on other errors", async () => {
      const permissionError = Object.assign(new Error("EACCES"), { code: "EACCES" });
      (unlink as ReturnType<typeof vi.fn>).mockRejectedValue(permissionError);

      await expect(deleteSession("test-session")).rejects.toThrow("EACCES");
    });
  });

  describe("sessionExists", () => {
    it("should return true when session file exists", async () => {
      (access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const exists = await sessionExists("test-session", "/project");

      expect(access).toHaveBeenCalledWith("/project/.agentfs/test-session.db", expect.any(Number));
      expect(exists).toBe(true);
    });

    it("should return false when session file does not exist", async () => {
      (access as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ENOENT"));

      const exists = await sessionExists("test-session", "/project");

      expect(exists).toBe(false);
    });

    it("should use cwd when agentfsDir not specified", async () => {
      (access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const originalCwd = process.cwd();

      await sessionExists("test-session");

      expect(access).toHaveBeenCalledWith(
        `${originalCwd}/.agentfs/test-session.db`,
        expect.any(Number)
      );
    });
  });

  describe("createSandboxManager", () => {
    it("should create a manager with configured base path", async () => {
      mockExecSuccess("output", "");
      (access as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (unlink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const manager = createSandboxManager({ baseRepoPath: "/opt/turso", dryRun: false });

      // Test runInSession uses baseRepoPath as cwd
      await manager.runInSession("sess", "cmd");
      expect(exec).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: "/opt/turso" }),
        expect.any(Function)
      );

      // Test sessionExists uses baseRepoPath
      await manager.sessionExists("sess");
      expect(access).toHaveBeenCalledWith("/opt/turso/.agentfs/sess.db", expect.any(Number));

      // Test deleteSession uses baseRepoPath
      await manager.deleteSession("sess");
      expect(unlink).toHaveBeenCalledWith("/opt/turso/.agentfs/sess.db");
    });

    it("should allow overriding cwd in runInSession", async () => {
      mockExecSuccess("output", "");

      const manager = createSandboxManager({ baseRepoPath: "/opt/turso", dryRun: false });
      await manager.runInSession("sess", "cmd", { cwd: "/custom/path" });

      expect(exec).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: "/custom/path" }),
        expect.any(Function)
      );
    });
  });
});
