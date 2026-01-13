import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    const panicLocation = "src/vdbe.c:1234";

    it("should start tracking a panic", () => {
      server.startTracking(panicLocation);
      const elapsed = server.getElapsedMs(panicLocation);
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 for unknown panic", () => {
      const elapsed = server.getElapsedMs("unknown/file.c:999");
      expect(elapsed).toBe(0);
    });

    it("should stop tracking a panic", () => {
      server.startTracking(panicLocation);
      server.stopTracking(panicLocation);
      const elapsed = server.getElapsedMs(panicLocation);
      expect(elapsed).toBe(0);
    });

    it("should track elapsed time correctly", async () => {
      server.startTracking(panicLocation);

      // Wait a bit
      await sleep(50);

      const elapsed = server.getElapsedMs(panicLocation);
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
      expect(elapsed).toBeLessThan(200);
    });

    it("should exclude paused time from elapsed", async () => {
      server.startTracking(panicLocation);

      // Wait, then pause
      await sleep(50);
      simulateSimStarted(server, panicLocation);

      // Wait while paused
      await sleep(100);
      simulateSimFinished(server, panicLocation);

      // Wait after resuming
      await sleep(50);

      const elapsed = server.getElapsedMs(panicLocation);

      // Should be ~100ms (50 before pause + 50 after resume), not ~200ms
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(150);
    });

    it("should track multiple panics independently", async () => {
      const loc1 = "src/a.c:1";
      const loc2 = "src/b.c:2";

      server.startTracking(loc1);
      await sleep(50);
      server.startTracking(loc2);
      await sleep(50);

      const elapsed1 = server.getElapsedMs(loc1);
      const elapsed2 = server.getElapsedMs(loc2);

      // loc1 should have more elapsed time
      expect(elapsed1).toBeGreaterThan(elapsed2);
      expect(elapsed1 - elapsed2).toBeGreaterThanOrEqual(30);
    });

    it("should report paused state correctly", () => {
      server.startTracking(panicLocation);
      expect(server.isPaused(panicLocation)).toBe(false);

      simulateSimStarted(server, panicLocation);
      expect(server.isPaused(panicLocation)).toBe(true);

      simulateSimFinished(server, panicLocation);
      expect(server.isPaused(panicLocation)).toBe(false);
    });

    it("should detect timeout correctly", async () => {
      server.startTracking(panicLocation);

      expect(server.hasTimedOut(panicLocation, 1000)).toBe(false);

      await sleep(60);

      expect(server.hasTimedOut(panicLocation, 50)).toBe(true);
      expect(server.hasTimedOut(panicLocation, 1000)).toBe(false);
    });

    it("should handle multiple pause/resume cycles", async () => {
      server.startTracking(panicLocation);

      // First cycle
      await sleep(30);
      simulateSimStarted(server, panicLocation);
      await sleep(50); // Paused
      simulateSimFinished(server, panicLocation);

      // Second cycle
      await sleep(30);
      simulateSimStarted(server, panicLocation);
      await sleep(50); // Paused
      simulateSimFinished(server, panicLocation);

      await sleep(30);

      const elapsed = server.getElapsedMs(panicLocation);

      // Should be ~90ms (30 + 30 + 30), not ~190ms
      expect(elapsed).toBeGreaterThanOrEqual(70);
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe("HTTP endpoints", () => {
    const panicLocation = "src/vdbe.c:1234";
    // URL-encoded version for HTTP requests
    const urlEncoded = encodeURIComponent(panicLocation);

    it("should respond to health check", async () => {
      await server.start();

      const response = await request(server.getApp()).get("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.trackedPanics).toBe(0);
    });

    it("should track panics in health check", async () => {
      await server.start();
      server.startTracking("src/a.c:1");
      server.startTracking("src/b.c:2");

      const response = await request(server.getApp()).get("/health");

      expect(response.body.trackedPanics).toBe(2);
    });

    it("should handle sim/started endpoint with URL-encoded panicLocation", async () => {
      await server.start();
      server.startTracking(panicLocation);

      // Client sends URL-encoded panic_location, Express auto-decodes it
      const response = await request(server.getApp()).post(
        `/sim/${urlEncoded}/started`
      );

      expect(response.status).toBe(200);
      expect(server.isPaused(panicLocation)).toBe(true);
    });

    it("should handle sim/finished endpoint with URL-encoded panicLocation", async () => {
      await server.start();
      server.startTracking(panicLocation);
      simulateSimStarted(server, panicLocation);

      const response = await request(server.getApp()).post(
        `/sim/${urlEncoded}/finished`
      );

      expect(response.status).toBe(200);
      expect(server.isPaused(panicLocation)).toBe(false);
    });

    it("should return 200 for unknown panic on sim endpoints", async () => {
      await server.start();

      const response = await request(server.getApp()).post(
        `/sim/${encodeURIComponent("unknown/file.c:999")}/started`
      );

      expect(response.status).toBe(200);
    });

    it("should provide debug tracker info", async () => {
      await server.start();
      const loc1 = "src/a.c:1";
      const loc2 = "src/b.c:2";
      server.startTracking(loc1);
      server.startTracking(loc2);
      simulateSimStarted(server, loc1);

      const response = await request(server.getApp()).get("/debug/trackers");

      expect(response.status).toBe(200);
      expect(response.body[loc1]).toBeDefined();
      expect(response.body[loc1].isPaused).toBe(true);
      expect(response.body[loc2]).toBeDefined();
      expect(response.body[loc2].isPaused).toBe(false);
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

function simulateSimStarted(server: IpcServer, panicLocation: string): void {
  // Directly manipulate the tracker to simulate the HTTP call
  // This is needed because we test tracking logic separately from HTTP
  const app = server.getApp();
  // Access internal tracker via the route handler behavior
  request(app).post(`/sim/${encodeURIComponent(panicLocation)}/started`).then(() => {});
  // For synchronous testing, we directly call the internal method
  // by triggering the pause behavior
  const tracker = (server as unknown as { trackers: Map<string, { pausedAt?: Date; totalPausedMs: number }> }).trackers.get(panicLocation);
  if (tracker && !tracker.pausedAt) {
    tracker.pausedAt = new Date();
  }
}

function simulateSimFinished(server: IpcServer, panicLocation: string): void {
  const tracker = (server as unknown as { trackers: Map<string, { pausedAt?: Date; totalPausedMs: number }> }).trackers.get(panicLocation);
  if (tracker && tracker.pausedAt) {
    tracker.totalPausedMs += Date.now() - tracker.pausedAt.getTime();
    delete tracker.pausedAt;
  }
}
