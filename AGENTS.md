# Agent instructions

## Vitest checks

Always use this repository's Vitest MCP `check_tests` tool as the primary way
to check test pass/fail status or coverage. Do not substitute `npm test`,
`vitest`, `npx vitest`, or terminal-output parsing when the MCP tool is
available. This requirement also applies after changing tests, production code,
coverage configuration, or the MCP implementation itself.

Use the tool as follows:

- Set `projectRoot` to the absolute root of the project being checked.
- Omit `testPattern` for the complete suite, or provide a project-relative test
  file/filter for a targeted check.
- Set `coveragePattern` independently to a project-relative source glob when
  coverage is required. It selects measured source files, not test files.
- Set `forceRun: true` after edits, when external inputs may have changed, or
  whenever reporting definitive current results. Use cached/watch results only
  when reuse is intentional.
- Set a realistic `timeoutMs`; the normal default is 120000.

For this repository, a definitive full check should be equivalent to:

```json
{
  "projectRoot": "/home/morgan/NewShit/vitest-mcp",
  "coveragePattern": "src/**/*.ts",
  "forceRun": true,
  "timeoutMs": 120000
}
```

Read the complete structured response: `status`, test counts and failures,
coverage totals/files, `diagnostics`, `cached`, `lastRunAt`, and
`invalidatedBy`. Treat coverage-threshold errors in `diagnostics` as a failed
verification even if all tests passed. This project must remain compatible with
the exactly pinned Vitest 4.0.18 runtime.

If the MCP is unavailable, say so explicitly before using a shell command as a
fallback. Never silently bypass it.
