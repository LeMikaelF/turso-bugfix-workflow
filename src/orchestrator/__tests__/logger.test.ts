import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatabaseClient } from "../database.js";
import { Logger, createLogger, type LogPayload } from "../logger.js";

describe("Logger", () => {
  let db: DatabaseClient;
  let logger: Logger;

  beforeEach(async () => {
    db = new DatabaseClient({ tursoUrl: ":memory:" });
    await db.connect();
    await db.initSchema();
    // Disable console output for cleaner test output
    logger = createLogger(db, { consoleOutput: false });
  });

  afterEach(async () => {
    await db.close();
  });

  describe("basic logging", () => {
    it("should log info messages to database", async () => {
      await logger.info("panic-001", "reproducer", "Starting reproduction");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(1);

      const log = logs[0] as LogPayload;
      expect(log.panic_location).toBe("panic-001");
      expect(log.phase).toBe("reproducer");
      expect(log.level).toBe("info");
      expect(log.message).toBe("Starting reproduction");
      expect(log.timestamp).toBeDefined();
    });

    it("should log all levels", async () => {
      logger = createLogger(db, { consoleOutput: false, minLevel: "debug" });

      await logger.debug("panic-001", "fixer", "Debug message");
      await logger.info("panic-001", "fixer", "Info message");
      await logger.warn("panic-001", "fixer", "Warning message");
      await logger.error("panic-001", "fixer", "Error message");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(4);

      const levels = logs.map((l) => (l as LogPayload).level);
      // Logs are returned in reverse order (most recent first)
      expect(levels).toContain("debug");
      expect(levels).toContain("info");
      expect(levels).toContain("warn");
      expect(levels).toContain("error");
    });

    it("should include metadata in log payload", async () => {
      await logger.info("panic-001", "reproducer", "Found panic", {
        seed: 12345,
        iterations: 3,
      });

      const logs = await db.getLogs(10);
      const log = logs[0] as LogPayload;
      expect(log.metadata).toEqual({
        seed: 12345,
        iterations: 3,
      });
    });

    it("should use system method for non-panic logs", async () => {
      await logger.system("info", "Orchestrator started");

      const logs = await db.getLogs(10);
      const log = logs[0] as LogPayload;
      expect(log.panic_location).toBe("system");
      expect(log.phase).toBe("orchestrator");
      expect(log.message).toBe("Orchestrator started");
    });
  });

  describe("log level filtering", () => {
    it("should filter out debug logs by default", async () => {
      await logger.debug("panic-001", "fixer", "Debug message");
      await logger.info("panic-001", "fixer", "Info message");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(1);
      expect((logs[0] as LogPayload).level).toBe("info");
    });

    it("should respect minLevel setting", async () => {
      logger = createLogger(db, { consoleOutput: false, minLevel: "warn" });

      await logger.debug("panic-001", "fixer", "Debug");
      await logger.info("panic-001", "fixer", "Info");
      await logger.warn("panic-001", "fixer", "Warning");
      await logger.error("panic-001", "fixer", "Error");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(2);

      const levels = logs.map((l) => (l as LogPayload).level);
      expect(levels).toContain("warn");
      expect(levels).toContain("error");
      expect(levels).not.toContain("debug");
      expect(levels).not.toContain("info");
    });

    it("should include all logs when minLevel is debug", async () => {
      logger = createLogger(db, { consoleOutput: false, minLevel: "debug" });

      await logger.debug("panic-001", "fixer", "Debug");
      await logger.info("panic-001", "fixer", "Info");
      await logger.warn("panic-001", "fixer", "Warning");
      await logger.error("panic-001", "fixer", "Error");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(4);
    });

    it("should only log errors when minLevel is error", async () => {
      logger = createLogger(db, { consoleOutput: false, minLevel: "error" });

      await logger.debug("panic-001", "fixer", "Debug");
      await logger.info("panic-001", "fixer", "Info");
      await logger.warn("panic-001", "fixer", "Warning");
      await logger.error("panic-001", "fixer", "Error");

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(1);
      expect((logs[0] as LogPayload).level).toBe("error");
    });
  });

  describe("console output", () => {
    it("should output to console when enabled", async () => {
      const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger = createLogger(db, { consoleOutput: true });

      await logger.info("panic-001", "reproducer", "Test message");

      expect(consoleInfoSpy).toHaveBeenCalled();
      const call = consoleInfoSpy.mock.calls[0]![0];
      expect(call).toContain("INFO");
      expect(call).toContain("reproducer");
      expect(call).toContain("panic-001");
      expect(call).toContain("Test message");

      consoleInfoSpy.mockRestore();
    });

    it("should use correct console method for each level", async () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger = createLogger(db, { consoleOutput: true, minLevel: "debug" });

      await logger.debug("panic-001", "fixer", "Debug");
      await logger.info("panic-001", "fixer", "Info");
      await logger.warn("panic-001", "fixer", "Warning");
      await logger.error("panic-001", "fixer", "Error");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("should not output to console when disabled", async () => {
      const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger = createLogger(db, { consoleOutput: false });

      await logger.info("panic-001", "reproducer", "Test message");

      expect(consoleInfoSpy).not.toHaveBeenCalled();
      consoleInfoSpy.mockRestore();
    });
  });

  describe("timestamp generation", () => {
    it("should generate ISO timestamp for each log", async () => {
      await logger.info("panic-001", "fixer", "Message");

      const logs = await db.getLogs(10);
      const log = logs[0] as LogPayload;

      // Verify it's a valid ISO timestamp
      const timestamp = new Date(log.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();

      // Should be recent (within last minute)
      const now = new Date();
      const diff = now.getTime() - timestamp.getTime();
      expect(diff).toBeLessThan(60000);
    });
  });

  describe("different phases", () => {
    it("should log for all phases", async () => {
      const phases = [
        "preflight",
        "repo_setup",
        "reproducer",
        "fixer",
        "ship",
        "orchestrator",
      ] as const;

      for (const phase of phases) {
        await logger.info("panic-001", phase, `Message for ${phase}`);
      }

      const logs = await db.getLogs(10);
      expect(logs).toHaveLength(6);

      const loggedPhases = logs.map((l) => (l as LogPayload).phase);
      for (const phase of phases) {
        expect(loggedPhases).toContain(phase);
      }
    });
  });
});
