# Global Codex Workflow

## Project start

- When the chat is for a Git project, start unconditionally with `git pull origin main` before inspecting or editing files.
- When the chat is not for a project, do not run `git pull`.
- After pulling, check the working tree and avoid including unrelated user changes in your work.

## Work delegation

- For coding tasks, the main agent owns investigation, integration, review, final decisions, commits, pushes, and the final response.
- By default, have a bounded worker handle implementation or testing work when that can speed up the task.
- Keep delegated work narrowly scoped, with clear file or module ownership and explicit validation expectations.
- The main agent must review delegated results, resolve conflicts, run or verify the relevant checks, and integrate only the intended changes.

## Minimal implementation

Before coding:

1. Confirm the requested change is necessary.
2. Reuse existing project code and patterns before adding new ones.
3. Prefer standard-library, browser, OS, and already-installed dependency features.
4. Avoid new dependencies, abstractions, files, configuration, and compatibility layers unless required.
5. Trace the real execution flow and fix the shared root cause instead of patching one symptom.
6. Make the smallest correct diff and do not refactor unrelated code.

- Do not simplify away validation, error handling, security, recovery logging, data-integrity checks, hardware calibration, retries, or explicitly requested behavior.
- For non-trivial logic, add or run one small, relevant verification.
- Prefer readable direct code over speculative generalization or future-proofing.

## GitHub Actions

- Do not create temporary or self-modifying workflows.
- Keep workflows only for durable repository CI and deployment.
- Remove obsolete workflow files and confirm that `.github/workflows` contains only intentional long-lived automation.

## Git completion

- Review the diff before committing and do not include unrelated user changes.
- Push completed, verified work to the current branch by default.
- Only open a pull request when explicitly requested.
