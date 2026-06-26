# Stacks — how test/lint/doc resolve commands

shipgate's core owns **zero** hardcoded tool knowledge. `test`, `lint`, and the
fix/format step ask a resolved *stack adapter* for the concrete command and run whatever
they get back. This is what makes shipgate work for any project — Node, PHP/WordPress,
Python, Go — without the pipeline knowing about any of them.

## Resolution order (per command kind: test / lint / format)

1. **`.shipgate.yaml` override always wins.** If `commands.<kind>` is set, that exact
   shell string runs.
2. **Else the detected stack adapter's default.**
3. **Else the step skips** with a `*.no-command` (no-op) finding — *not* a failure. The
   fix is to configure the command (option 1), which is how any unanticipated toolchain
   works.

```yaml
# .shipgate.yaml
commands:
  test: npm test
  lint: npm run lint
  format: npm run format
base:
  integrationBranches: [main, develop]
  rules:
    - when: "feature/v2-*"   # glob on the run branch
      use: "release/v2"
push:
  remote: origin             # or: url: git@github.com:me/fork.git
```

So when a step `skipped` with `lint.no-command` / `test.no-command`, the answer is almost
always: add `commands.lint` / `commands.test` to `.shipgate.yaml`.

## Detection

Adapters score the repo; the highest score wins (generic is the guaranteed fallback). A
more specific stack beats a generic one. Detection inspects files, not file extensions
alone.

| Adapter | Detected by | test / lint / format defaults |
|---------|-------------|--------------------------------|
| **node** | `package.json` | the `scripts` that exist: `npm test`, `npm run lint`, `npm run format`; fix = `npm run lint:fix` (else `npm run format`) |
| **wordpress** | `style.css` "Theme Name:", `wp-content/`, wpcs in `composer.json`, or `WordPress` in `phpcs.xml` | composer script → `vendor/bin/<tool>` → global; phpcs (lint), phpunit (test), phpcbf (format/fix) |
| **generic** | always matches, lowest score | nothing — config-only |

A plain PHP project with no WordPress signal is **not** WordPress — it falls back to
generic. WordPress is just the first, most complete PHP adapter, not a special case in the
core.

## Adding a stack

Adding support for a new stack is one new adapter file (`src/core/stacks/<name>.ts`)
implementing `detect()` + `command(kind)` (+ optional `fixCommand()`), registered in
`detect.ts`. The pipeline never changes. If you only need it for one project, you don't
even need an adapter — set the three `commands.*` in `.shipgate.yaml`.
