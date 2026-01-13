// Utility functions for panic_location handling
//
// Since panic_location (e.g., "src/vdbe.c:1234") contains characters unsuitable
// for URLs and file paths (/ and :), we provide helpers to convert it to safe formats.

/**
 * Convert panic_location to a filesystem/git-safe slug.
 * Replaces / and : with -
 *
 * @example toSlug("src/vdbe.c:1234") => "src-vdbe.c-1234"
 */
export function toSlug(panicLocation: string): string {
  return panicLocation.replace(/[/:]/g, "-");
}

/**
 * URL-encode panic_location for use in IPC endpoints.
 *
 * @example toUrlSafe("src/vdbe.c:1234") => "src%2Fvdbe.c%3A1234"
 */
export function toUrlSafe(panicLocation: string): string {
  return encodeURIComponent(panicLocation);
}

/**
 * Get session name for a panic (uses slug for filesystem safety)
 *
 * @example getSessionName("src/vdbe.c:1234") => "fix-panic-src-vdbe.c-1234"
 */
export function getSessionName(panicLocation: string): string {
  return `fix-panic-${toSlug(panicLocation)}`;
}

/**
 * Get branch name for a panic (uses slug for git safety)
 *
 * @example getBranchName("src/vdbe.c:1234") => "fix/panic-src-vdbe.c-1234"
 */
export function getBranchName(panicLocation: string): string {
  return `fix/panic-${toSlug(panicLocation)}`;
}
