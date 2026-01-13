import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Enable globals like describe, it, expect without imports (optional, disabled by default)
    globals: false,

    // Test file patterns
    include: ["src/**/*.test.ts"],

    // Environment
    environment: "node",

    // Coverage (optional, configure as needed)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "**/*.test.ts"],
    },
  },

  // Resolve .js extensions in imports to .ts files (for ESM TypeScript projects)
  resolve: {
    alias: {
      // This isn't strictly needed as vitest handles .js -> .ts resolution automatically
      // when using tsx or ts-node, but documenting the pattern here
    },
  },

  // Use esbuild for faster TypeScript transformation
  esbuild: {
    target: "esnext",
  },
});
