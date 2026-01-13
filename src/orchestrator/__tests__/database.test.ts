import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseClient, type PanicFix } from "../database.js";

describe("DatabaseClient", () => {
  let db: DatabaseClient;

  beforeEach(async () => {
    db = new DatabaseClient({ tursoUrl: ":memory:" });
    await db.connect();
    await db.initSchema();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("panic_fixes CRUD", () => {
    it("should create and retrieve a panic fix", async () => {
      await db.createPanicFix(
        "panic-001",
        "src/vdbe.c:1234",
        "assertion failed: pCur->isValid",
        ["CREATE TABLE t1(a INTEGER);", "SELECT * FROM t1;"]
      );

      const fix = await db.getPanicFix("panic-001");
      expect(fix).not.toBeNull();
      expect(fix!.id).toBe("panic-001");
      expect(fix!.panic_location).toBe("src/vdbe.c:1234");
      expect(fix!.panic_message).toBe("assertion failed: pCur->isValid");
      expect(fix!.status).toBe("pending");
      expect(fix!.sql_statements.split("\n")).toEqual([
        "CREATE TABLE t1(a INTEGER);",
        "SELECT * FROM t1;",
      ]);
    });

    it("should return null/undefined for non-existent panic fix", async () => {
      const fix = await db.getPanicFix("non-existent");
      expect(fix).toBeFalsy();
    });

    it("should get pending panics ordered by creation time", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);
      await db.createPanicFix("panic-002", "loc2", "msg2", []);
      await db.createPanicFix("panic-003", "loc3", "msg3", []);

      const pending = await db.getPendingPanics(2);
      expect(pending).toHaveLength(2);
      expect(pending[0]!.id).toBe("panic-001");
      expect(pending[1]!.id).toBe("panic-002");
    });

    it("should update panic status", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);

      await db.updatePanicStatus("panic-001", "reproducing");

      const fix = await db.getPanicFix("panic-001");
      expect(fix!.status).toBe("reproducing");
    });

    it("should update panic status with additional fields", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);

      await db.updatePanicStatus("panic-001", "pr_open", {
        branch_name: "fix/panic-001",
        pr_url: "https://github.com/test/repo/pull/123",
      });

      const fix = await db.getPanicFix("panic-001");
      expect(fix!.status).toBe("pr_open");
      expect(fix!.branch_name).toBe("fix/panic-001");
      expect(fix!.pr_url).toBe("https://github.com/test/repo/pull/123");
    });

    it("should increment retry count", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);

      await db.incrementRetryCount("panic-001");
      let fix = await db.getPanicFix("panic-001");
      expect(fix!.retry_count).toBe(1);

      await db.incrementRetryCount("panic-001");
      fix = await db.getPanicFix("panic-001");
      expect(fix!.retry_count).toBe(2);
    });

    it("should reset retry count", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);
      await db.incrementRetryCount("panic-001");
      await db.incrementRetryCount("panic-001");

      await db.resetRetryCount("panic-001");

      const fix = await db.getPanicFix("panic-001");
      expect(fix!.retry_count).toBe(0);
    });

    it("should mark needs human review with error", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);

      await db.markNeedsHumanReview("panic-001", {
        phase: "reproducer",
        error: "Timeout exceeded",
        timestamp: "2025-01-13T10:00:00Z",
      });

      const fix = await db.getPanicFix("panic-001");
      expect(fix!.status).toBe("needs_human_review");
      expect(fix!.workflow_error).not.toBeNull();
      const error = JSON.parse(fix!.workflow_error!);
      expect(error.phase).toBe("reproducer");
      expect(error.error).toBe("Timeout exceeded");
    });

    it("should not include non-pending panics in pending query", async () => {
      await db.createPanicFix("panic-001", "loc1", "msg1", []);
      await db.createPanicFix("panic-002", "loc2", "msg2", []);
      await db.updatePanicStatus("panic-002", "reproducing");

      const pending = await db.getPendingPanics();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.id).toBe("panic-001");
    });
  });

  describe("logs operations", () => {
    it("should insert and retrieve logs", async () => {
      await db.insertLog({
        panic_location: "loc1",
        phase: "reproducer",
        level: "info",
        message: "Starting reproduction",
        timestamp: "2025-01-13T10:00:00Z",
      });

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        panic_location: "loc1",
        phase: "reproducer",
        level: "info",
        message: "Starting reproduction",
      });
    });

    it("should retrieve logs by panic location", async () => {
      await db.insertLog({
        panic_location: "loc1",
        message: "Log 1",
      });
      await db.insertLog({
        panic_location: "loc2",
        message: "Log 2",
      });
      await db.insertLog({
        panic_location: "loc1",
        message: "Log 3",
      });

      const logs = await db.getLogsByPanicLocation("loc1");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => (l as { panic_location: string }).panic_location === "loc1")).toBe(
        true
      );
    });

    it("should limit log results", async () => {
      for (let i = 0; i < 10; i++) {
        await db.insertLog({ message: `Log ${i}` });
      }

      const logs = await db.getLogs(5);
      expect(logs).toHaveLength(5);
    });
  });

  describe("connection management", () => {
    it("should throw error when not connected", async () => {
      const disconnectedDb = new DatabaseClient({ tursoUrl: ":memory:" });
      await expect(disconnectedDb.initSchema()).rejects.toThrow(
        "Database not connected"
      );
    });

    it("should close connection cleanly", async () => {
      const tempDb = new DatabaseClient({ tursoUrl: ":memory:" });
      await tempDb.connect();
      await tempDb.initSchema();
      await tempDb.close();
      // Should not throw
    });
  });
});
