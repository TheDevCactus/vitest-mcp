# Vitest MCP

## Goal

Vitest MCP is a local stdio MCP server that lets coding agents reliably check
targeted Vitest results and source coverage without constructing shell commands
or parsing terminal output.

It exposes one tool, `check_tests`. The server runs the target project's own
Vitest executable and returns a small, normalized result.

## Requirements

- Node.js 20 or newer
- A project-local Vitest 4.1 or newer installation
- The project's configured Vitest coverage provider when requesting coverage,
  such as `@vitest/coverage-v8`

The server never downloads Vitest or falls back to a global executable.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

Run the server from the directory containing the projects it may inspect:

```sh
node /path/to/vitest-mcp/dist/server.js
```

Because stdout is reserved for MCP messages, server diagnostics are written to
stderr.

## MCP configuration

Example configuration for a single project:

```json
{
  "mcpServers": {
    "vitest": {
      "command": "node",
      "args": ["/path/to/vitest-mcp/dist/server.js"],
      "cwd": "/path/to/project"
    }
  }
}
```

### Poolside

This repository includes a shared Poolside binding in
`.poolside/settings.yaml`. Build the server before starting Poolside from the
repository root:

```sh
npm run build
pool
```

Poolside will start `dist/server.js` over stdio and expose only the
`check_tests` tool. Put personal overrides in
`.poolside/settings.local.yaml`; that file is intentionally ignored.

By default, `check_tests` can only inspect the server's working directory and
its descendants. To allow multiple roots, set `VITEST_MCP_ALLOWED_ROOTS` to a
platform-delimited list (`:` on Linux/macOS and `;` on Windows):

```sh
VITEST_MCP_ALLOWED_ROOTS=/work/app:/work/packages
```

## Tool: `check_tests`

Input:

```json
{
  "projectRoot": "/work/app",
  "testPattern": "src/math.test.ts",
  "coveragePattern": "src/math.ts",
  "timeoutMs": 120000,
  "forceRun": false
}
```

- `projectRoot` is optional and defaults to the server working directory.
- `testPattern` is an optional Vitest test-file filter.
- `coveragePattern` is an optional, independent glob passed to
  `coverage.include`.
- `timeoutMs` defaults to 120 seconds and is limited to 1–600 seconds.
- `forceRun` bypasses result reuse and explicitly executes the selected tests.

Patterns must be project-relative. Absolute paths, parent traversal, and values
beginning with `-` are rejected.

Output status is one of:

- `passed`: Vitest exited successfully.
- `failed`: one or more tests failed.
- `error`: Vitest/configuration/report generation failed.
- `timed_out`: the configured deadline was exceeded.

The structured result includes test counts, up to 20 failures, optional
per-file and total coverage percentages, duration, bounded diagnostics, and:

- `cached`: `true` when the MCP call did not itself execute tests. The result
  may have been refreshed moments earlier by Vitest's background watcher.
- `lastRunAt`: when Vitest last executed the selected tests.
- `invalidatedBy`: up to 20 changed files associated with the latest rerun.

## Persistent sessions

The server keeps one Vitest instance for each unique combination of project,
test filter, and coverage filter. The first call executes the selected tests.
An identical later call reuses the completed result while Vitest's watcher says
it remains valid.

Vitest uses its Vite module graph to rerun selected tests when an imported
dependency changes. Configured `forceRerunTriggers` and `watchTriggerPatterns`
continue to work. Inputs outside that graph—external databases, HTTP services,
the clock, environment changes, or files read directly through `node:fs`—must
use `forceRun: true` unless the project config provides an appropriate trigger.

Inactive sessions are closed after ten minutes. Calls within one session are
serialized so a forced run cannot overlap a watcher-driven run.

## Architecture

The MCP handler validates input and delegates to a project-session manager. A
session loads the target project's `vitest/node` public API, owns its watcher
and warm transform/module caches, and captures results through an inline
reporter. Coverage reports live in a session-specific temporary directory.
Closing or evicting a session closes Vitest and removes those files.
