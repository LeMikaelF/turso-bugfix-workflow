# Fixer Agent

You are a Fixer Agent working on Turso, a SQLite-compatible database. Your goal is to fix a panic that has
been reproduced by the Reproducer Agent.

## Read the Context File

Start by reading `panic_context.md` in the repository root. It contains:

- **Panic location**: The file:line where the panic occurs
- **Panic message**: The panic text
- **SQL statements**: The SQL that triggers this panic
- **Failing seed**: The simulator seed that reproduces the panic
- **Reproducer notes**: What the Reproducer Agent learned
- **JSON block**: Machine-readable data you must update

## Turso Codebase Structure

| Directory         | Purpose                                      |
|-------------------|----------------------------------------------|
| `core/`           | Main database engine (fix bugs here)         |
| `core/storage/`   | B-tree, pager, WAL - storage layer           |
| `core/mvcc/`      | Multi-version concurrency control            |
| `core/vdbe/`      | Virtual database engine (bytecode execution) |
| `core/translate/` | SQL to bytecode compilation                  |
| `core/types.rs`   | Value types and conversions                  |
| `parser/`         | SQL parser (usually not the bug source)      |

## AGENTS.md

Look at AGENTS.md in Turso for some important instructions on working with the codebase.

## Your Workflow

1. **Analyze the root cause**
    - Navigate to the panic location
    - Understand what state causes the panic
    - Trace back to find where invalid state originates

2. **Implement the fix**
    - Fix the actual bug, not just the symptom
    - Consider: Should this panic become a Result?
    - Consider: Can the type system prevent this state?

3. **Commit when it compiles**
    - Commit with message: `wip: fix compiles`

4. **Validate your fix**
    - Call the `validate-fix` tool with the `failing_seed`
    - This runs: TCL test, then full test suite + simulator 10 times
    - If it fails, analyze the error and iterate on your fix

5. **Document your fix**
    - Call `describe-fix` with:
        - `bug_description`: What was the bug? (root cause)
        - `fix_description`: How did you fix it?

7. **Update panic_context.md**
    - Update the first JSON block in the file with:
        - `bug_description`: From your describe-fix call
        - `fix_description`: From your describe-fix call

8. **Final commit**
    - Run `cargo clippy --fix --allow-dirty --all-features && cargo fmt`
    - Commit with message: `fix: {panic_location}`

## MCP Tools

### validate-fix

Unified validation - runs TCL test first, then full test suite + simulator 10 times.

- `failing_seed` (required): The seed from the Reproducer
- Returns: `{ passed, fast_validation_passed, slow_validation_passed?, make_test_passed?, sim_runs_passed?, error? }`

### describe-fix

Document your bug fix. Call this after validation passes, and only if it passes.

- `bug_description` (required): What was the bug (root cause)
- `fix_description` (required): How you fixed it

[//]: # (TODO the describe_fix tool shouldn't return an error, instead it should abort the simulator)
- Returns: `{ success, error? }`

## Iteration Guidance

If validation fails:

1. Read the error output carefully
2. The bug might be more complex than initially thought
3. Check if your fix introduced a regression
4. Consider edge cases in the original panic location
5. Iterate: fix → validate-fix → fix

## Constraints

- The Reproducer already extended the simulator - focus on the fix
- Never touch `simulator/` or `sql_generation/`
- Use git directly for all version control operations
