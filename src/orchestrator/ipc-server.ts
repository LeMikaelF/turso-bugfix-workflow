// IPC HTTP server for simulator timeout tracking
// Tracks time spent running the simulator to exclude from agent timeouts
//
// Note: The :panicLocation URL param is URL-encoded by clients (e.g., "src%2Fvdbe.c%3A1234")
// Express automatically decodes it via req.params, so we get the raw panic_location.

import express, { type Express, type Request, type Response } from "express";
import type { Server } from "http";

interface TimeTracker {
  startTime: Date;
  pausedAt?: Date;
  totalPausedMs: number;
}

export class IpcServer {
  private readonly app: Express;
  private readonly port: number;
  private server: Server | null = null;
  // Map keyed by raw panic_location (e.g., "src/vdbe.c:1234")
  private trackers: Map<string, TimeTracker> = new Map();

  constructor(port: number = 9100) {
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Simulator started - pause the timer
    // URL param is URL-encoded, Express auto-decodes it
    this.app.post("/sim/:panicLocation/started", (req: Request, res: Response) => {
      const { panicLocation } = req.params;
      if (!panicLocation) {
        res.sendStatus(400);
        return;
      }

      const tracker = this.trackers.get(panicLocation);
      if (tracker && !tracker.pausedAt) {
        tracker.pausedAt = new Date();
      }
      res.sendStatus(200);
    });

    // Simulator finished - resume the timer
    this.app.post("/sim/:panicLocation/finished", (req: Request, res: Response) => {
      const { panicLocation } = req.params;
      if (!panicLocation) {
        res.sendStatus(400);
        return;
      }

      const tracker = this.trackers.get(panicLocation);
      if (tracker && tracker.pausedAt) {
        tracker.totalPausedMs += Date.now() - tracker.pausedAt.getTime();
        delete tracker.pausedAt;
      }
      res.sendStatus(200);
    });

    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", trackedPanics: this.trackers.size });
    });

    // Debug endpoint to get all tracker states
    this.app.get("/debug/trackers", (_req: Request, res: Response) => {
      const trackerInfo: Record<string, {
        elapsedMs: number;
        totalPausedMs: number;
        isPaused: boolean;
      }> = {};

      for (const [panicLocation] of this.trackers) {
        trackerInfo[panicLocation] = {
          elapsedMs: this.getElapsedMs(panicLocation),
          totalPausedMs: this.trackers.get(panicLocation)!.totalPausedMs,
          isPaused: this.trackers.get(panicLocation)!.pausedAt !== undefined,
        };
      }

      res.json(trackerInfo);
    });
  }

  /**
   * Start the IPC server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          resolve();
        });
        this.server.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the IPC server
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the Express app instance (for testing)
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Start tracking time for a panic
   * @param panicLocation - The raw panic location (e.g., "src/vdbe.c:1234")
   */
  startTracking(panicLocation: string): void {
    this.trackers.set(panicLocation, {
      startTime: new Date(),
      totalPausedMs: 0,
    });
  }

  /**
   * Stop tracking time for a panic
   * @param panicLocation - The raw panic location (e.g., "src/vdbe.c:1234")
   */
  stopTracking(panicLocation: string): void {
    this.trackers.delete(panicLocation);
  }

  /**
   * Get elapsed time in milliseconds for a panic, excluding paused time
   * @param panicLocation - The raw panic location (e.g., "src/vdbe.c:1234")
   */
  getElapsedMs(panicLocation: string): number {
    const tracker = this.trackers.get(panicLocation);
    if (!tracker) {
      return 0;
    }

    const totalMs = Date.now() - tracker.startTime.getTime();
    const currentlyPausedMs = tracker.pausedAt
      ? Date.now() - tracker.pausedAt.getTime()
      : 0;
    const pausedMs = tracker.totalPausedMs + currentlyPausedMs;

    return totalMs - pausedMs;
  }

  /**
   * Check if a panic is currently paused (simulator running)
   * @param panicLocation - The raw panic location (e.g., "src/vdbe.c:1234")
   */
  isPaused(panicLocation: string): boolean {
    const tracker = this.trackers.get(panicLocation);
    return tracker?.pausedAt !== undefined;
  }

  /**
   * Check if tracking has timed out
   * @param panicLocation - The raw panic location (e.g., "src/vdbe.c:1234")
   */
  hasTimedOut(panicLocation: string, timeoutMs: number): boolean {
    return this.getElapsedMs(panicLocation) >= timeoutMs;
  }

  /**
   * Get the port the server is configured to use
   */
  getPort(): number {
    return this.port;
  }
}

// Factory function for creating an IPC server
export function createIpcServer(port?: number): IpcServer {
  return new IpcServer(port);
}
