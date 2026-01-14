import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, type OrchestratorDeps } from "../index.js";
import {
  createMockConfig,
  createMockDb,
  createMockLogger,
  createMockIpcServer,
  createMockSandbox,
} from "../workflow/__tests__/test-utils.js";

describe("CLI entry point", () => {
  describe("cleanup", () => {
    let mockDeps: Pick<OrchestratorDeps, "ipcServer" | "db" | "logger">;

    beforeEach(() => {
      mockDeps = {
        ipcServer: createMockIpcServer(),
        db: createMockDb(),
        logger: createMockLogger(),
      };
    });

    it("should stop IPC server and close database", async () => {
      await cleanup(mockDeps);

      expect(mockDeps.ipcServer.stop).toHaveBeenCalled();
      expect(mockDeps.db.close).toHaveBeenCalled();
    });

    it("should log cleanup messages", async () => {
      await cleanup(mockDeps);

      expect(mockDeps.logger.system).toHaveBeenCalledWith(
        "info",
        "Cleaning up..."
      );
      expect(mockDeps.logger.system).toHaveBeenCalledWith(
        "info",
        "Cleanup complete"
      );
    });

    it("should handle IPC server stop error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(mockDeps.ipcServer.stop).mockRejectedValue(
        new Error("Stop failed")
      );

      await cleanup(mockDeps);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error stopping IPC server:",
        "Stop failed"
      );
      // Should still close database
      expect(mockDeps.db.close).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle database close error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(mockDeps.db.close).mockRejectedValue(
        new Error("Close failed")
      );

      await cleanup(mockDeps);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error closing database:",
        "Close failed"
      );

      consoleSpy.mockRestore();
    });

    it("should cleanup in correct order: IPC stop, log complete, then DB close", async () => {
      const callOrder: string[] = [];

      vi.mocked(mockDeps.ipcServer.stop).mockImplementation(async () => {
        callOrder.push("ipcServer.stop");
      });
      vi.mocked(mockDeps.logger.system).mockImplementation(async (_level, message) => {
        callOrder.push(`logger.system: ${message}`);
      });
      vi.mocked(mockDeps.db.close).mockImplementation(async () => {
        callOrder.push("db.close");
      });

      await cleanup(mockDeps);

      // Logger writes to DB, so "Cleanup complete" must be logged before DB closes
      expect(callOrder).toEqual([
        "logger.system: Cleaning up...",
        "ipcServer.stop",
        "logger.system: Cleanup complete",
        "db.close",
      ]);
    });
  });

  describe("OrchestratorDeps interface", () => {
    it("should have correct shape", () => {
      const deps: OrchestratorDeps = {
        config: createMockConfig(),
        db: createMockDb(),
        logger: createMockLogger(),
        ipcServer: createMockIpcServer(),
        sandbox: createMockSandbox(),
      };

      expect(deps.config).toBeDefined();
      expect(deps.db).toBeDefined();
      expect(deps.logger).toBeDefined();
      expect(deps.ipcServer).toBeDefined();
      expect(deps.sandbox).toBeDefined();
    });
  });
});
