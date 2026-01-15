import type { Config } from "./src/orchestrator/config.js";

const config: Config = {
  // Required - set via environment variables or replace placeholders
  tursoUrl: process.env.TURSO_URL ?? "libsql://your-db.turso.io",
  githubToken: process.env.GITHUB_TOKEN ?? "",

  // Optional settings with defaults
  baseRepoPath: "/opt/turso-base",
  maxParallelPanics: 2,
  reproducerTimeoutMs: 60 * 60 * 1000,
  fixerTimeoutMs: 60 * 60 * 1000,
  reproducerPlannerTimeoutMs: 15 * 60 * 1000,
  reproducerImplementerTimeoutMs: 45 * 60 * 1000,
  fixerPlannerTimeoutMs: 15 * 60 * 1000,
  fixerImplementerTimeoutMs: 45 * 60 * 1000,
  githubRepo: "tursodatabase/turso",
  prReviewer: "@LeMikaelF",
  prLabels: [],
  ipcPort: 9100,
  dryRun: false,
};

export default config;
