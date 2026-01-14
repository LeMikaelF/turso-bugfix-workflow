/**
 * Integration tests for sandbox.ts using real AgentFS CLI.
 *
 * These tests require AgentFS to be installed and accessible in PATH.
 * They create real sessions and run real commands.
 *
 * Run with: npm test -- sandbox.integration
 */

import { describe, it, expect, afterEach, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { runInSession, deleteSession, sessionExists } from "../sandbox.js";

// Check if agentfs is available synchronously at module load time
function checkAgentFsAvailable(): boolean {
  try {
    execSync("agentfs --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const agentfsAvailable = checkAgentFsAvailable();

describe.skipIf(!agentfsAvailable)("sandbox integration", () => {
  // Generate unique session names to avoid conflicts between test runs
  const testSessionPrefix = `test-session-${Date.now()}`;
  let sessionCounter = 0;
  const getUniqueSessionName = () => `${testSessionPrefix}-${sessionCounter++}`;

  // Track sessions created during tests for cleanup
  const createdSessions: string[] = [];

  afterEach(async () => {
    // Clean up all sessions created during tests
    for (const session of createdSessions) {
      try {
        await deleteSession(session);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessions.length = 0;
  });

  describe("basic command execution", () => {
    it("should create session implicitly on first run", async () => {

      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Run simple command - session created automatically
      const result = await runInSession(sessionName, "echo hello");

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");

      // Verify session now exists
      const exists = await sessionExists(sessionName);
      expect(exists).toBe(true);
    });

    it("should run commands with CLI flags", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(sessionName, "ls -la /tmp");

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("should capture stderr on failed commands", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        "ls /nonexistent-path-xyz-12345"
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("should return non-zero exit code for failed commands", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(sessionName, "false");

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("multi-word commands", () => {
    it("should handle echo with multiple words", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(sessionName, 'echo "hello world from agentfs"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello world from agentfs");
    });

    it("should handle bash -c with multi-word script", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        'bash -c "echo first && echo second && echo third"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("first");
      expect(result.stdout).toContain("second");
      expect(result.stdout).toContain("third");
    });

    it("should handle node -e with multi-word JavaScript", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        `node -e "console.log('hello from node'); console.log('multiple lines');"`
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello from node");
      expect(result.stdout).toContain("multiple lines");
    });

    it("should handle grep with pattern containing spaces", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Create a file with multi-word content and grep for it
      const result = await runInSession(
        sessionName,
        'bash -c "echo \'hello world test\' | grep \'hello world\'"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello world");
    });

    it("should handle commands with pipes and multiple arguments", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        "echo 'line1\nline2\nline3' | head -n 2"
      );

      expect(result.exitCode).toBe(0);
    });

    it("should handle printf with format and multiple arguments", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        'printf "%s %s %s" one two three'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("one two three");
    });
  });

  describe("session lifecycle: create -> modify -> delete", () => {
    it("should follow complete lifecycle: not exists -> create -> exists -> modify -> delete -> not exists", async () => {
      const sessionName = getUniqueSessionName();
      // Don't add to createdSessions - we're testing deletion explicitly

      // 1. Session doesn't exist yet
      const existsBefore = await sessionExists(sessionName);
      expect(existsBefore).toBe(false);

      // 2. Create session by running a command
      const createResult = await runInSession(sessionName, "echo session created");
      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout.trim()).toBe("session created");

      // 3. Verify session exists
      const existsAfterCreate = await sessionExists(sessionName);
      expect(existsAfterCreate).toBe(true);

      // 4. Modify: run more commands in the session
      const modifyResult1 = await runInSession(sessionName, 'bash -c "echo modification 1"');
      expect(modifyResult1.exitCode).toBe(0);

      const modifyResult2 = await runInSession(sessionName, 'node -e "console.log(\'modification 2\')"');
      expect(modifyResult2.exitCode).toBe(0);

      // 5. Session should still exist after modifications
      const existsAfterModify = await sessionExists(sessionName);
      expect(existsAfterModify).toBe(true);

      // 6. Delete session
      await deleteSession(sessionName);

      // 7. Verify session no longer exists
      const existsAfterDelete = await sessionExists(sessionName);
      expect(existsAfterDelete).toBe(false);
    });

    it("should not throw when deleting non-existent session", async () => {
      await expect(
        deleteSession("nonexistent-session-xyz-never-created-12345")
      ).resolves.not.toThrow();
    });

    it("should handle deleting the same session twice (idempotent)", async () => {
      const sessionName = getUniqueSessionName();

      // Create session
      await runInSession(sessionName, "echo test");
      expect(await sessionExists(sessionName)).toBe(true);

      // Delete first time
      await deleteSession(sessionName);
      expect(await sessionExists(sessionName)).toBe(false);

      // Delete second time - should not throw
      await expect(deleteSession(sessionName)).resolves.not.toThrow();
      expect(await sessionExists(sessionName)).toBe(false);
    });

    it("should allow recreating a deleted session", async () => {
      const sessionName = getUniqueSessionName();

      // Create, verify, delete
      await runInSession(sessionName, "echo first");
      expect(await sessionExists(sessionName)).toBe(true);
      await deleteSession(sessionName);
      expect(await sessionExists(sessionName)).toBe(false);

      // Recreate the session
      const result = await runInSession(sessionName, "echo second");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("second");
      expect(await sessionExists(sessionName)).toBe(true);

      // Cleanup
      await deleteSession(sessionName);
    });
  });

  describe("simulating agent-like behavior (lightweight stand-in for claude)", () => {
    it("should run a bash script that simulates agent output", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Simulate an agent that analyzes and responds
      const agentScript = `
        echo "Agent starting..."
        echo "Analyzing input..."
        sleep 0.1
        echo "Processing complete"
        echo "Result: success"
      `;

      const result = await runInSession(
        sessionName,
        `bash -c "${agentScript.replace(/\n/g, " ")}"`
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Agent starting");
      expect(result.stdout).toContain("Processing complete");
      expect(result.stdout).toContain("Result: success");
    });

    it("should run node script that simulates agent behavior", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Node script simulating agent output
      const nodeScript = `
        console.log('Agent initialized');
        console.log('Reading context...');
        console.log('Generating response...');
        console.log(JSON.stringify({ status: 'complete', result: 'fixed' }));
      `.replace(/\n/g, " ");

      const result = await runInSession(
        sessionName,
        `node -e "${nodeScript}"`
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Agent initialized");
      expect(result.stdout).toContain('"status":"complete"');
    });

    it("should handle long-running command (simulating agent work)", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Simulate work that takes some time
      const result = await runInSession(
        sessionName,
        'bash -c "for i in 1 2 3; do echo step $i; sleep 0.1; done; echo done"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("step 1");
      expect(result.stdout).toContain("step 2");
      expect(result.stdout).toContain("step 3");
      expect(result.stdout).toContain("done");
    });

    it("should pass environment variables to commands", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Note: runInSession doesn't directly set env vars, but we can test via bash
      const result = await runInSession(
        sessionName,
        'bash -c "export MY_VAR=hello && echo $MY_VAR"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });
  });

  describe("file operations within sessions", () => {
    const testDir = "/tmp/agentfs-integration-test";

    afterAll(async () => {
      // Clean up test directory
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it("should create and read files within a session", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const testFile = `${testDir}/test-${sessionName}.txt`;

      // Create directory and file
      await runInSession(sessionName, `mkdir -p ${testDir}`);
      await runInSession(sessionName, `echo "test content" > ${testFile}`);

      // Read file
      const result = await runInSession(sessionName, `cat ${testFile}`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("test content");

      // Cleanup
      await runInSession(sessionName, `rm ${testFile}`);
    });

    it("should persist file changes across multiple commands in same session", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const testFile = `${testDir}/persist-${sessionName}.txt`;

      // Create directory
      await runInSession(sessionName, `mkdir -p ${testDir}`);

      // Write initial content
      await runInSession(sessionName, `echo "line 1" > ${testFile}`);

      // Append more content
      await runInSession(sessionName, `echo "line 2" >> ${testFile}`);
      await runInSession(sessionName, `echo "line 3" >> ${testFile}`);

      // Read all content
      const result = await runInSession(sessionName, `cat ${testFile}`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("line 1");
      expect(result.stdout).toContain("line 2");
      expect(result.stdout).toContain("line 3");

      // Cleanup
      await runInSession(sessionName, `rm ${testFile}`);
    });
  });

  describe("edge cases", () => {
    it("should handle empty command output", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(sessionName, "true");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("should handle commands with special characters", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        'echo "special: $HOME ~user @#$%"'
      );

      expect(result.exitCode).toBe(0);
      // $HOME should be expanded, others should be literal
      expect(result.stdout).toContain("special:");
    });

    it("should handle very long output", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Generate 1000 lines of output
      const result = await runInSession(
        sessionName,
        'bash -c "for i in $(seq 1 1000); do echo line $i; done"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("line 1");
      expect(result.stdout).toContain("line 1000");
    });

    it("should handle commands that output to both stdout and stderr", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await runInSession(
        sessionName,
        'bash -c "echo stdout-msg; echo stderr-msg >&2"'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("stdout-msg");
      expect(result.stderr).toContain("stderr-msg");
    });
  });
});
