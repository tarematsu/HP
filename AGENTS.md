# Global Codex Workflow

## Oracle browser model verification

- When Oracle is required, use the browser engine with `gpt-5.6-sol` and the
  requested high thinking setting.
- Do not infer model availability from the CLI banner, version number, or the
  first paragraph of `--help`. Oracle may print an older default model there
  while supporting newer aliases in its option parser.
- Before every live consultation, run a dry-run using the exact intended
  command and inspect that it resolves to `browser (gpt-5.6-sol)` (or equivalent
  explicit GPT-5.6 Sol evidence). A successful resolution is proof that the
  model is available; proceed with the live browser run.
- If the dry-run resolves `gpt-5.6-sol`, never substitute another model based
  only on stale help text or a banner. If the live run fails, inspect the
  Oracle session/status and recover the existing session before retrying.
- State that GPT-5.6 Sol is unavailable only after the exact browser dry-run or
  model-selection step explicitly fails to resolve/select it. Preserve the
  failure output when reporting that conclusion.
- Use a quoted unique three-to-five-word `--slug`; do not pass slug words as
  separate positional arguments.

## Git workflow

- At the start of work in this Git project, run `git pull origin main` before
  inspecting or editing files.
- Preserve unrelated user changes. Review the diff before committing.
- After coding work is complete and verified, commit the focused changes and
  push the current branch unless the user asks to keep changes local or there
  is no usable remote.
