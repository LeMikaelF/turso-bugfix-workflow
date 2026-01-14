/**
 * Integration tests for git.ts using real AgentFS CLI.
 *
 * These tests require AgentFS to be installed and accessible in PATH.
 * They create real git repositories and run real git commands in sandboxes.
 *
 * Run with: npm test -- git.integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBranch, squashCommits } from "../git.js";
import {
  runInSession,
  deleteSession,
  type SandboxManager,
} from "../sandbox.js";
import type { PanicContextData } from "../context-parser.js";

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

describe.skipIf(!agentfsAvailable)("git integration", () => {
  // Generate unique session names to avoid conflicts between test runs
  const testSessionPrefix = `test-git-${Date.now()}`;
  let sessionCounter = 0;
  const getUniqueSessionName = () => `${testSessionPrefix}-${sessionCounter++}`;

  // Track sessions and temp dirs for cleanup
  const createdSessions: string[] = [];
  let tempDir: string;

  // Create a sandbox manager that uses the temp dir as cwd
  let sandbox: SandboxManager;

  beforeEach(async () => {
    // Create a temp directory for the test git repo
    tempDir = await mkdtemp(join(tmpdir(), "git-test-"));

    // Initialize a git repo in the temp directory
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test User"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create initial commit on main
    execSync("touch README.md", { cwd: tempDir, stdio: "ignore" });
    execSync("git add README.md", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create sandbox manager bound to the temp dir
    sandbox = {
      runInSession: (sessionName, command) =>
        runInSession(sessionName, command, { cwd: tempDir }),
      deleteSession: (sessionName) => deleteSession(sessionName, tempDir),
      sessionExists: async () => true, // Not used in these tests
    };
  });

  afterEach(async () => {
    // Clean up all sessions created during tests
    for (const session of createdSessions) {
      try {
        await deleteSession(session, tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessions.length = 0;

    // Clean up temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("createBranch", () => {
    it("should create and checkout a new branch", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await createBranch(
        { sessionName, branchName: "fix/test-branch" },
        sandbox
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify we're on the new branch
      const branchResult = await sandbox.runInSession(
        sessionName,
        "git branch --show-current"
      );
      expect(branchResult.stdout.trim()).toBe("fix/test-branch");
    });

    it("should fail when branch already exists", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Create branch first time
      const result1 = await createBranch(
        { sessionName, branchName: "fix/duplicate-branch" },
        sandbox
      );
      expect(result1.success).toBe(true);

      // Go back to main
      await sandbox.runInSession(sessionName, "git checkout main");

      // Try to create same branch again
      const result2 = await createBranch(
        { sessionName, branchName: "fix/duplicate-branch" },
        sandbox
      );

      expect(result2.success).toBe(false);
      expect(result2.error).toContain("Failed to create branch");
    });

    it("should handle branch names with slashes", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const result = await createBranch(
        { sessionName, branchName: "fix/panic-src-vdbe.c-1234" },
        sandbox
      );

      expect(result.success).toBe(true);

      const branchResult = await sandbox.runInSession(
        sessionName,
        "git branch --show-current"
      );
      expect(branchResult.stdout.trim()).toBe("fix/panic-src-vdbe.c-1234");
    });
  });

  describe("squashCommits", () => {
    const sampleContextData: PanicContextData = {
      panic_location: "src/vdbe.c:1234",
      panic_message: "assertion failed: pCur->isValid",
      tcl_test_file: "test/panic-src-vdbe.c-1234.test",
      failing_seed: 42,
      why_simulator_missed: "Did not generate cursor operations after close",
      simulator_changes: "Added cursor state tracking",
      bug_description: "Cursor used after being closed",
      fix_description: "Added null check before cursor access",
    };

    it("should squash multiple commits into one", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Create a feature branch
      await createBranch(
        { sessionName, branchName: "fix/squash-test" },
        sandbox
      );

      // Make multiple commits
      await sandbox.runInSession(sessionName, "touch file1.txt");
      await sandbox.runInSession(sessionName, "git add file1.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "Add file1"');

      await sandbox.runInSession(sessionName, "touch file2.txt");
      await sandbox.runInSession(sessionName, "git add file2.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "Add file2"');

      await sandbox.runInSession(sessionName, "touch file3.txt");
      await sandbox.runInSession(sessionName, "git add file3.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "Add file3"');

      // Verify we have 3 commits ahead of main
      const logBefore = await sandbox.runInSession(
        sessionName,
        "git rev-list main..HEAD --count"
      );
      expect(logBefore.stdout.trim()).toBe("3");

      // Squash the commits
      const result = await squashCommits(
        { sessionName, contextData: sampleContextData },
        sandbox
      );

      expect(result.success).toBe(true);

      // Verify we now have 1 commit ahead of main
      const logAfter = await sandbox.runInSession(
        sessionName,
        "git rev-list main..HEAD --count"
      );
      expect(logAfter.stdout.trim()).toBe("1");

      // Verify commit message contains expected content
      const commitMsg = await sandbox.runInSession(
        sessionName,
        "git log -1 --format=%B"
      );
      expect(commitMsg.stdout).toContain("fix: assertion failed: pCur->isValid");
      expect(commitMsg.stdout).toContain("Location: src/vdbe.c:1234");
    });

    it("should include all changed files in squashed commit", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Create a feature branch
      await createBranch(
        { sessionName, branchName: "fix/files-test" },
        sandbox
      );

      // Make multiple commits with different files
      await sandbox.runInSession(sessionName, "echo 'content A' > fileA.txt");
      await sandbox.runInSession(sessionName, "git add fileA.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "Add fileA"');

      await sandbox.runInSession(sessionName, "echo 'content B' > fileB.txt");
      await sandbox.runInSession(sessionName, "git add fileB.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "Add fileB"');

      // Squash
      const result = await squashCommits(
        { sessionName, contextData: sampleContextData },
        sandbox
      );
      expect(result.success).toBe(true);

      // Verify both files are in the squashed commit
      const filesInCommit = await sandbox.runInSession(
        sessionName,
        "git diff-tree --no-commit-id --name-only -r HEAD"
      );
      expect(filesInCommit.stdout).toContain("fileA.txt");
      expect(filesInCommit.stdout).toContain("fileB.txt");
    });

    it("should fail when there are no commits to squash", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      // Create a feature branch with no additional commits
      await createBranch(
        { sessionName, branchName: "fix/empty-test" },
        sandbox
      );

      // Try to squash (nothing to commit)
      const result = await squashCommits(
        { sessionName, contextData: sampleContextData },
        sandbox
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git commit failed");
    });

    it("should handle commit messages with special characters", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const dataWithSpecialChars: PanicContextData = {
        panic_location: "src/foo.c:100",
        panic_message: "can't access \"memory\" at $ptr",
        tcl_test_file: "test/foo.test",
        bug_description: "User's pointer wasn't valid",
        fix_description: "Check `ptr != NULL` before access",
      };

      await createBranch(
        { sessionName, branchName: "fix/special-chars" },
        sandbox
      );

      await sandbox.runInSession(sessionName, "touch special.txt");
      await sandbox.runInSession(sessionName, "git add special.txt");
      await sandbox.runInSession(sessionName, 'git commit -m "wip"');

      const result = await squashCommits(
        { sessionName, contextData: dataWithSpecialChars },
        sandbox
      );

      expect(result.success).toBe(true);

      // Verify the message was preserved correctly
      const commitMsg = await sandbox.runInSession(
        sessionName,
        "git log -1 --format=%B"
      );
      expect(commitMsg.stdout).toContain("can't access");
      expect(commitMsg.stdout).toContain("User's pointer");
    });
  });

  describe("full workflow: branch -> commit -> squash", () => {
    it("should complete entire git workflow in sandbox", async () => {
      const sessionName = getUniqueSessionName();
      createdSessions.push(sessionName);

      const contextData: PanicContextData = {
        panic_location: "src/btree.c:5678",
        panic_message: "btree corruption detected",
        tcl_test_file: "test/btree.test",
        bug_description: "Missing lock before tree modification",
        fix_description: "Added mutex lock around tree operations",
      };

      // 1. Create branch
      const branchResult = await createBranch(
        { sessionName, branchName: "fix/panic-src-btree.c-5678" },
        sandbox
      );
      expect(branchResult.success).toBe(true);

      // 2. Simulate reproducer work
      await sandbox.runInSession(
        sessionName,
        "echo 'simulator changes' > simulator.c"
      );
      await sandbox.runInSession(sessionName, "git add simulator.c");
      await sandbox.runInSession(
        sessionName,
        'git commit -m "reproducer: improve simulator"'
      );

      // 3. Simulate fixer work
      await sandbox.runInSession(sessionName, "echo 'bug fix' > btree.c");
      await sandbox.runInSession(sessionName, "git add btree.c");
      await sandbox.runInSession(sessionName, 'git commit -m "wip: fix compiles"');

      await sandbox.runInSession(sessionName, "echo 'test file' > btree.test");
      await sandbox.runInSession(sessionName, "git add btree.test");
      await sandbox.runInSession(sessionName, 'git commit -m "fix: btree corruption"');

      // Verify 3 commits on branch
      const countBefore = await sandbox.runInSession(
        sessionName,
        "git rev-list main..HEAD --count"
      );
      expect(countBefore.stdout.trim()).toBe("3");

      // 4. Squash all commits
      const squashResult = await squashCommits(
        { sessionName, contextData },
        sandbox
      );
      expect(squashResult.success).toBe(true);

      // 5. Verify final state
      const countAfter = await sandbox.runInSession(
        sessionName,
        "git rev-list main..HEAD --count"
      );
      expect(countAfter.stdout.trim()).toBe("1");

      // Verify all files present
      const files = await sandbox.runInSession(sessionName, "git ls-files");
      expect(files.stdout).toContain("simulator.c");
      expect(files.stdout).toContain("btree.c");
      expect(files.stdout).toContain("btree.test");

      // Verify commit message
      const msg = await sandbox.runInSession(
        sessionName,
        "git log -1 --format=%s"
      );
      expect(msg.stdout.trim()).toBe("fix: btree corruption detected");
    });
  });
});
