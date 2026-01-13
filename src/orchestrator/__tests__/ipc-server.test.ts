import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { IpcServer, createIpcServer } from "../ipc-server.js";

describe("IpcServer", () => {
  let server: IpcServer;

  beforeEach(() => {
    server = createIpcServer(0); // Use random port for tests
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("time tracking", () => {
    it("should start tracking a panic", () => {
      server.startTracking("panic-001");
      const elapsed = server.getElapsedMs("panic-001");
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 for unknown panic", () => {
      const elapsed = server.getElapsedMs("unknown");
      expect(elapsed).toBe(0);
    });

    it("should stop tracking a panic", () => {
      server.startTracking("panic-001");
      server.stopTracking("panic-001");
      const elapsed = server.getElapsedMs("panic-001");
      expect(elapsed).toBe(0);
    });

    it("should track elapsed time correctly", async () => {
      server.startTracking("panic-001");

      // Wait a bit
      await sleep(50);

      const elapsed = server.getElapsedMs("panic-001");
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
      expect(elapsed).toBeLessThan(200);
    });

    it("should exclude paused time from elapsed", async () => {
      server.startTracking("panic-001");

      // Wait, then pause
      await sleep(50);
      simulateSimStarted(server, "panic-001");

      // Wait while paused
      await sleep(100);
      simulateSimFinished(server, "panic-001");

      // Wait after resuming
      await sleep(50);

      const elapsed = server.getElapsedMs("panic-001");

      // Should be ~100ms (50 before pause + 50 after resume), not ~200ms
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(150);
    });

    it("should track multiple panics independently", async () => {
      server.startTracking("panic-001");
      await sleep(50);
      server.startTracking("panic-002");
      await sleep(50);

      const elapsed1 = server.getElapsedMs("panic-001");
      const elapsed2 = server.getElapsedMs("panic-002");

      // panic-001 should have more elapsed time
      expect(elapsed1).toBeGreaterThan(elapsed2);
      expect(elapsed1 - elapsed2).toBeGreaterThanOrEqual(30);
    });

    it("should report paused state correctly", () => {
      server.startTracking("panic-001");
      expect(server.isPaused("panic-001")).toBe(false);

      simulateSimStarted(server, "panic-001");
      expect(server.isPaused("panic-001")).toBe(true);

      simulateSimFinished(server, "panic-001");
      expect(server.isPaused("panic-001")).toBe(false);
    });

    it("should detect timeout correctly", async () => {
      server.startTracking("panic-001");

      expect(server.hasTimedOut("panic-001", 1000)).toBe(false);

      await sleep(60);

      expect(server.hasTimedOut("panic-001", 50)).toBe(true);
      expect(server.hasTimedOut("panic-001", 1000)).toBe(false);
    });

    it("should handle multiple pause/resume cycles", async () => {
      server.startTracking("panic-001");

      // First cycle
      await sleep(30);
      simulateSimStarted(server, "panic-001");
      await sleep(50); // Paused
      simulateSimFinished(server, "panic-001");

      // Second cycle
      await sleep(30);
      simulateSimStarted(server, "panic-001");
      await sleep(50); // Paused
      simulateSimFinished(server, "panic-001");

      await sleep(30);

      const elapsed = server.getElapsedMs("panic-001");

      // Should be ~90ms (30 + 30 + 30), not ~190ms
      expect(elapsed).toBeGreaterThanOrEqual(70);
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe("HTTP endpoints", () => {
    it("should respond to health check", async () => {
      await server.start();

      const response = await request(server.getApp()).get("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.trackedPanics).toBe(0);
    });

    it("should track panics in health check", async () => {
      await server.start();
      server.startTracking("panic-001");
      server.startTracking("panic-002");

      const response = await request(server.getApp()).get("/health");

      expect(response.body.trackedPanics).toBe(2);
    });

    it("should handle sim/started endpoint", async () => {
      await server.start();
      server.startTracking("panic-001");

      const response = await request(server.getApp()).post(
        "/sim/panic-001/started"
      );

      expect(response.status).toBe(200);
      expect(server.isPaused("panic-001")).toBe(true);
    });

    it("should handle sim/finished endpoint", async () => {
      await server.start();
      server.startTracking("panic-001");
      simulateSimStarted(server, "panic-001");

      const response = await request(server.getApp()).post(
        "/sim/panic-001/finished"
      );

      expect(response.status).toBe(200);
      expect(server.isPaused("panic-001")).toBe(false);
    });

    it("should return 200 for unknown panic on sim endpoints", async () => {
      await server.start();

      const response = await request(server.getApp()).post(
        "/sim/unknown/started"
      );

      expect(response.status).toBe(200);
    });

    it("should provide debug tracker info", async () => {
      await server.start();
      server.startTracking("panic-001");
      server.startTracking("panic-002");
      simulateSimStarted(server, "panic-001");

      const response = await request(server.getApp()).get("/debug/trackers");

      expect(response.status).toBe(200);
      expect(response.body["panic-001"]).toBeDefined();
      expect(response.body["panic-001"].isPaused).toBe(true);
      expect(response.body["panic-002"]).toBeDefined();
      expect(response.body["panic-002"].isPaused).toBe(false);
    });
  });

  describe("server lifecycle", () => {
    it("should start and stop cleanly", async () => {
      await server.start();
      await server.stop();
      // Should not throw
    });

    it("should handle stop when not started", async () => {
      await server.stop();
      // Should not throw
    });

    it("should return configured port", () => {
      const customServer = createIpcServer(9200);
      expect(customServer.getPort()).toBe(9200);
    });
  });
});

// Helper functions

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simulateSimStarted(server: IpcServer, panicId: string): void {
  // Directly manipulate the tracker to simulate the HTTP call
  // This is needed because we test tracking logic separately from HTTP
  const app = server.getApp();
  // Access internal tracker via the route handler behavior
  request(app).post(`/sim/${panicId}/started`).then(() => {});
  // For synchronous testing, we directly call the internal method
  // by triggering the pause behavior
  const tracker = (server as unknown as { trackers: Map<string, { pausedAt?: Date; totalPausedMs: number }> }).trackers.get(panicId);
  if (tracker && !tracker.pausedAt) {
    tracker.pausedAt = new Date();
  }
}

function simulateSimFinished(server: IpcServer, panicId: string): void {
  const tracker = (server as unknown as { trackers: Map<string, { pausedAt?: Date; totalPausedMs: number }> }).trackers.get(panicId);
  if (tracker && tracker.pausedAt) {
    tracker.totalPausedMs += Date.now() - tracker.pausedAt.getTime();
    delete tracker.pausedAt;
  }
}
