// IPC HTTP server for simulator timeout tracking
// Tracks time spent running the simulator to exclude from agent timeouts

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
  private trackers: Map<string, TimeTracker> = new Map();

  constructor(port: number = 9100) {
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Simulator started - pause the timer
    this.app.post("/sim/:panicId/started", (req: Request, res: Response) => {
      const { panicId } = req.params;
      if (!panicId) {
        res.sendStatus(400);
        return;
      }

      const tracker = this.trackers.get(panicId);
      if (tracker && !tracker.pausedAt) {
        tracker.pausedAt = new Date();
      }
      res.sendStatus(200);
    });

    // Simulator finished - resume the timer
    this.app.post("/sim/:panicId/finished", (req: Request, res: Response) => {
      const { panicId } = req.params;
      if (!panicId) {
        res.sendStatus(400);
        return;
      }

      const tracker = this.trackers.get(panicId);
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

      for (const [panicId] of this.trackers) {
        trackerInfo[panicId] = {
          elapsedMs: this.getElapsedMs(panicId),
          totalPausedMs: this.trackers.get(panicId)!.totalPausedMs,
          isPaused: this.trackers.get(panicId)!.pausedAt !== undefined,
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
   */
  startTracking(panicId: string): void {
    this.trackers.set(panicId, {
      startTime: new Date(),
      totalPausedMs: 0,
    });
  }

  /**
   * Stop tracking time for a panic
   */
  stopTracking(panicId: string): void {
    this.trackers.delete(panicId);
  }

  /**
   * Get elapsed time in milliseconds for a panic, excluding paused time
   */
  getElapsedMs(panicId: string): number {
    const tracker = this.trackers.get(panicId);
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
   */
  isPaused(panicId: string): boolean {
    const tracker = this.trackers.get(panicId);
    return tracker?.pausedAt !== undefined;
  }

  /**
   * Check if tracking has timed out
   */
  hasTimedOut(panicId: string, timeoutMs: number): boolean {
    return this.getElapsedMs(panicId) >= timeoutMs;
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
