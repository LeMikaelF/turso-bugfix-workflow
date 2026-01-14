// TCL test template generator

import { toSlug } from "../../encoding.js";

/**
 * Generate TCL test content from SQL statements.
 */
export function generateTclTest(sqlStatements: string, panicMessage: string, panicLocation: string): string {
  const statements = sqlStatements
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sqlBlock = statements.map((stmt) => `  execsql {${stmt}}`).join("\n");

  return `# Auto-generated test for panic at ${panicLocation}
# Expected panic: ${panicMessage}

set testdir [file dirname $argv0]
source $testdir/tester.tcl

do_test panic-${toSlug(panicLocation)}-1 {
${sqlBlock}
} {}

finish_test
`;
}
