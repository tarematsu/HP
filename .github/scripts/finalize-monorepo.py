#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SH = ROOT / "SH"
HP = ROOT / "hp"
WORKFLOWS = ROOT / ".github" / "workflows"
SCRIPTS = ROOT / ".github" / "scripts"
ACTIONS = ROOT / ".github" / "actions"


def move(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        raise RuntimeError(f"destination already exists: {dst}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def merge_tree(src: Path, dst: Path, *, overwrite: bool = False) -> list[str]:
    duplicates: list[str] = []
    if not src.exists():
        return duplicates
    for item in sorted(src.rglob("*")):
        if item.is_dir():
            continue
        rel = item.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not overwrite:
            duplicates.append(str(rel))
            continue
        shutil.copy2(item, target)
    return duplicates


def replace_text(path: Path, replacements: list[tuple[str, str]]) -> None:
    if not path.exists() or not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return
    updated = text
    for old, new in replacements:
        updated = updated.replace(old, new)
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def insert_cloudflare_context(path: Path) -> None:
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    if "actions/checkout@v4" not in text:
        return

    # Account IDs are non-secret and are resolved from the token. Remove all
    # workflow-specific values, including the former hard-coded fallback.
    lines = [
        line for line in text.splitlines(keepends=True)
        if not re.match(r"^\s*CLOUDFLARE_ACCOUNT_ID:\s*", line)
    ]

    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        if "- uses: actions/checkout@v4" not in line:
            i += 1
            continue

        indent = len(line) - len(line.lstrip(" "))
        i += 1
        while i < len(lines):
            next_line = lines[i]
            stripped = next_line.strip()
            next_indent = len(next_line) - len(next_line.lstrip(" "))
            if stripped and next_indent <= indent and stripped.startswith("-"):
                break
            out.append(next_line)
            i += 1

        nearby = "".join(out[-12:])
        if "./.github/actions/cloudflare-context" not in nearby:
            prefix = " " * indent
            out.extend([
                f"{prefix}- name: Resolve Cloudflare account context\n",
                f"{prefix}  uses: ./.github/actions/cloudflare-context\n",
                f"{prefix}  with:\n",
                f"{prefix}    api-token: ${{{{ secrets.CLOUDFLARE_BUILDS_API_TOKEN }}}}\n",
            ])

    path.write_text("".join(out), encoding="utf-8")


def main() -> None:
    if not SH.is_dir():
        raise RuntimeError("SH snapshot directory is missing")

    HP.mkdir(exist_ok=True)

    # Preserve HP-specific repository guidance and documentation under hp/.
    move(ROOT / "AGENTS.md", HP / "AGENTS.md")
    move(ROOT / "README.md", HP / "README.md")
    move(ROOT / "DEPLOYMENT.md", HP / "DEPLOYMENT.md")

    # Move the existing HomePanel applications as one coherent subtree. Their
    # relative cloud/video/native relationships remain unchanged.
    for directory in ("cloud", "video", "native"):
        move(ROOT / directory, HP / directory)

    # Capture HP automation files before importing SH automation, then rewrite
    # only those files to the new hp/* repository paths.
    hp_automation_files = [
        p for p in (ROOT / ".github").rglob("*")
        if p.is_file() and p.name not in {"finalize-monorepo.py"}
    ]
    hp_replacements = [
        ("cloud/", "hp/cloud/"),
        ("video/", "hp/video/"),
        ("native/", "hp/native/"),
        ("working-directory: cloud", "working-directory: hp/cloud"),
        ("working-directory: video", "working-directory: hp/video"),
        ("working-directory: native", "working-directory: hp/native"),
        ("cd cloud", "cd hp/cloud"),
        ("cd video", "cd hp/video"),
        ("cd native", "cd hp/native"),
    ]
    for path in hp_automation_files:
        replace_text(path, hp_replacements)

    # Give the existing HP observability workflow an explicit product name so
    # the SH workflow can become active at repository root without collision.
    hp_observability = WORKFLOWS / "fetch-cloudflare-observability.yml"
    if hp_observability.exists():
        target = WORKFLOWS / "hp-observability.yml"
        text = hp_observability.read_text(encoding="utf-8").replace(
            ".github/workflows/fetch-cloudflare-observability.yml",
            ".github/workflows/hp-observability.yml",
        )
        target.write_text(text, encoding="utf-8")
        hp_observability.unlink()

    # Remove the temporary snapshot-only CI; SH's original CI becomes active
    # after promotion to repository root.
    (WORKFLOWS / "sh-ci.yml").unlink(missing_ok=True)

    # Promote SH's application tree to repository root. This intentionally
    # preserves SH's Git-root-sensitive migration and changed-file logic.
    sh_special = {".github", ".gitignore", "AGENTS.md", "MIGRATION.md"}
    for item in sorted(SH.iterdir(), key=lambda p: p.name):
        if item.name in sh_special:
            continue
        destination = ROOT / item.name
        if destination.exists():
            raise RuntimeError(f"unexpected SH/HP path collision: {item.name}")
        shutil.move(str(item), str(destination))

    # Merge ignore rules without duplicating entries.
    root_ignore = ROOT / ".gitignore"
    hp_ignore = root_ignore.read_text(encoding="utf-8").splitlines() if root_ignore.exists() else []
    sh_ignore_path = SH / ".gitignore"
    sh_ignore = sh_ignore_path.read_text(encoding="utf-8").splitlines() if sh_ignore_path.exists() else []
    merged_ignore: list[str] = []
    seen: set[str] = set()
    for line in hp_ignore + ["", "# SH"] + sh_ignore:
        if line in seen and line.strip():
            continue
        merged_ignore.append(line)
        if line.strip():
            seen.add(line)
    root_ignore.write_text("\n".join(merged_ignore).rstrip() + "\n", encoding="utf-8")

    # SH instructions apply to the promoted root. HP retains its original child
    # instructions under hp/AGENTS.md.
    sh_agents = (SH / "AGENTS.md").read_text(encoding="utf-8") if (SH / "AGENTS.md").exists() else ""
    (ROOT / "AGENTS.md").write_text(
        "# Home Platform repository instructions\n\n"
        "This repository contains the Stationhead (SH) platform at the repository root "
        "and HomePanel applications under `hp/`. Product deployments remain independent.\n\n"
        + sh_agents,
        encoding="utf-8",
    )

    docs = ROOT / "docs"
    docs.mkdir(exist_ok=True)
    if (SH / "MIGRATION.md").exists():
        shutil.copy2(SH / "MIGRATION.md", docs / "SH-REPOSITORY-MIGRATION.md")

    # HP's implementations are canonical for common Cloudflare diagnostics;
    # SH contributes only scripts/actions that do not already exist.
    duplicate_scripts = merge_tree(SH / ".github" / "scripts", SCRIPTS, overwrite=False)
    merge_tree(SH / ".github" / "actions", ACTIONS, overwrite=False)

    # Activate SH workflows at repository root. Only the observability filename
    # is namespaced because HP already owns the historical filename.
    for workflow in sorted((SH / ".github" / "workflows").glob("*.yml")):
        target_name = "sh-observability.yml" if workflow.name == "fetch-cloudflare-observability.yml" else workflow.name
        target = WORKFLOWS / target_name
        if target.exists():
            target = WORKFLOWS / f"sh-{workflow.name}"
        text = workflow.read_text(encoding="utf-8")
        if workflow.name == "fetch-cloudflare-observability.yml":
            text = text.replace(
                ".github/workflows/fetch-cloudflare-observability.yml",
                ".github/workflows/sh-observability.yml",
            )
        target.write_text(text, encoding="utf-8")

    shutil.rmtree(SH)

    # A single token is sufficient. This action resolves the unique accessible
    # Cloudflare account dynamically and exports the standard environment names.
    action_dir = ACTIONS / "cloudflare-context"
    action_dir.mkdir(parents=True, exist_ok=True)
    (action_dir / "action.yml").write_text(
        "name: Resolve Cloudflare context\n"
        "description: Export Cloudflare token and automatically resolve the accessible account ID\n"
        "inputs:\n"
        "  api-token:\n"
        "    description: Cloudflare API token\n"
        "    required: true\n"
        "  account-id:\n"
        "    description: Optional explicit Cloudflare account ID\n"
        "    required: false\n"
        "    default: ''\n"
        "runs:\n"
        "  using: composite\n"
        "  steps:\n"
        "    - name: Resolve account\n"
        "      shell: bash\n"
        "      env:\n"
        "        INPUT_API_TOKEN: ${{ inputs.api-token }}\n"
        "        INPUT_ACCOUNT_ID: ${{ inputs.account-id }}\n"
        "      run: |\n"
        "        set -euo pipefail\n"
        "        token=\"$INPUT_API_TOKEN\"\n"
        "        account_id=\"$INPUT_ACCOUNT_ID\"\n"
        "        if [[ -z \"$token\" ]]; then\n"
        "          echo 'CLOUDFLARE_BUILDS_API_TOKEN is unavailable' >&2\n"
        "          exit 1\n"
        "        fi\n"
        "        echo \"::add-mask::$token\"\n"
        "        if [[ -z \"$account_id\" ]]; then\n"
        "          response=\"$(curl --fail-with-body --silent --show-error \\\n"
        "            -H \"Authorization: Bearer $token\" \\\n"
        "            'https://api.cloudflare.com/client/v4/accounts?per_page=50')\"\n"
        "          mapfile -t account_ids < <(jq -r '.result[]?.id // empty' <<<\"$response\")\n"
        "          if [[ \"${#account_ids[@]}\" -ne 1 ]]; then\n"
        "            echo \"Expected exactly one accessible Cloudflare account, found ${#account_ids[@]}\" >&2\n"
        "            exit 1\n"
        "          fi\n"
        "          account_id=\"${account_ids[0]}\"\n"
        "        fi\n"
        "        {\n"
        "          echo \"CLOUDFLARE_API_TOKEN=$token\"\n"
        "          echo \"CLOUDFLARE_BUILDS_API_TOKEN=$token\"\n"
        "          echo \"CLOUDFLARE_ACCOUNT_ID=$account_id\"\n"
        "        } >> \"$GITHUB_ENV\"\n",
        encoding="utf-8",
    )

    cloudflare_workflows = {
        "database.yml",
        "deploy-split-pipeline.yml",
        "sh-observability.yml",
        "audit-d1-storage.yml",
        "fetch-cloudflare-d1-usage.yml",
        "cloud-deploy.yml",
        "hp-observability.yml",
        "video-worker-cpu-report.yml",
        "prune-homepanel-updates.yml",
        "video-provision-manual-import-queue.yml",
    }
    for name in cloudflare_workflows:
        insert_cloudflare_context(WORKFLOWS / name)

    # All SH tests now inspect the active root SH observability workflow.
    for test_file in (ROOT / "tests").glob("*.mjs"):
        replace_text(test_file, [
            ("fetch-cloudflare-observability.yml", "sh-observability.yml"),
        ])

    token_test = ROOT / "tests" / "cloudflare-deploy-token.test.mjs"
    if token_test.exists():
        token_test.write_text(
            "import assert from 'node:assert/strict';\n"
            "import { readFileSync } from 'node:fs';\n"
            "import test from 'node:test';\n\n"
            "const workflow = readFileSync(\n"
            "  new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url),\n"
            "  'utf8',\n"
            ");\n\n"
            "test('production deployment uses the shared Cloudflare context resolver', () => {\n"
            "  const action = 'uses: ./.github/actions/cloudflare-context';\n"
            "  assert.ok(workflow.split(action).length - 1 >= 2);\n"
            "  assert.match(workflow, /secrets\\.CLOUDFLARE_BUILDS_API_TOKEN/);\n"
            "  assert.doesNotMatch(workflow, /CLOUDFLARE_ACCOUNT_ID:\\s*['\\\"]?[0-9a-f]{32}/i);\n"
            "});\n",
            encoding="utf-8",
        )

    # Root package scripts orchestrate both products while preserving each
    # product's own lockfiles and deployment boundaries.
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package.setdefault("scripts", {})
    sh_check = scripts.get("check", "")
    scripts["check:sh"] = sh_check
    scripts["check:layout"] = "node scripts/validate-monorepo.mjs"
    scripts["check:hp-cloud"] = "npm --prefix hp/cloud run check"
    scripts["test:hp-cloud"] = "npm --prefix hp/cloud test"
    scripts["check:hp-video"] = "npm --prefix hp/video run check"
    scripts["test:hp-video"] = "npm --prefix hp/video test"
    scripts["check"] = "npm run check:layout && npm run check:sh && npm run check:hp-cloud && npm run check:hp-video"
    scripts["test:all"] = "npm run test:js && npm run test:sql && npm run test:worker && npm run test:site && npm run test:hp-cloud && npm run test:hp-video"
    package["name"] = "home-platform"
    package["version"] = "1.0.0"
    package["description"] = "Stationhead and HomePanel monorepo"
    package_path.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    validator = ROOT / "scripts" / "validate-monorepo.mjs"
    validator.write_text(
        "import assert from 'node:assert/strict';\n"
        "import { existsSync, readFileSync, readdirSync } from 'node:fs';\n"
        "import { resolve } from 'node:path';\n\n"
        "const root = resolve(new URL('..', import.meta.url).pathname);\n"
        "for (const path of ['worker', 'site', 'database', 'hp/cloud', 'hp/video', 'hp/native']) {\n"
        "  assert.equal(existsSync(resolve(root, path)), true, `missing ${path}`);\n"
        "}\n"
        "assert.equal(existsSync(resolve(root, 'SH')), false, 'legacy SH directory must be removed');\n"
        "for (const path of ['cloud', 'video', 'native']) {\n"
        "  assert.equal(existsSync(resolve(root, path)), false, `legacy HP path remains: ${path}`);\n"
        "}\n"
        "const workflows = resolve(root, '.github/workflows');\n"
        "for (const name of ['deploy-split-pipeline.yml', 'database.yml', 'sh-observability.yml', 'cloud-deploy.yml', 'hp-observability.yml']) {\n"
        "  assert.equal(existsSync(resolve(workflows, name)), true, `missing workflow ${name}`);\n"
        "}\n"
        "for (const name of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {\n"
        "  const source = readFileSync(resolve(workflows, name), 'utf8');\n"
        "  assert.doesNotMatch(source, /CLOUDFLARE_ACCOUNT_ID:\\s*['\"]?[0-9a-f]{32}/i, name);\n"
        "}\n"
        "console.log('monorepo layout validated');\n",
        encoding="utf-8",
    )

    duplicate_report = "\n".join(f"- `{name}`" for name in duplicate_scripts) or "- None"
    (docs / "MONOREPO.md").write_text(
        "# Home Platform monorepo\n\n"
        "## Layout\n\n"
        "- `worker/`, `site/`, `database/`, `packages/`: Stationhead platform\n"
        "- `hp/cloud/`, `hp/video/`, `hp/native/`: HomePanel applications\n"
        "- `.github/scripts/`: shared Cloudflare observability and budget tooling\n"
        "- `.github/actions/cloudflare-context/`: token export and automatic account discovery\n\n"
        "## Deployment boundaries\n\n"
        "SH and HP retain independent Workers, D1 migrations, release workflows, and rollback paths. "
        "The repository is unified; production deployments are not.\n\n"
        "## Canonical common scripts\n\n"
        "Where both repositories contained the same Cloudflare operational filename, the HP root implementation "
        "was retained as the canonical shared implementation. SH-only scripts were promoted unchanged.\n\n"
        "Duplicate filenames resolved in favor of the canonical root implementation:\n\n"
        f"{duplicate_report}\n",
        encoding="utf-8",
    )

    (ROOT / "README.md").write_text(
        "# Home Platform\n\n"
        "Unified repository for Stationhead (SH) and HomePanel (HP).\n\n"
        "- SH application and data pipeline: repository root (`worker/`, `site/`, `database/`)\n"
        "- HP applications: `hp/`\n"
        "- Shared Cloudflare operations: `.github/scripts/` and `.github/actions/cloudflare-context/`\n\n"
        "Run `npm run check` for the full JavaScript/TypeScript validation suite. "
        "See `docs/MONOREPO.md` for deployment boundaries and migration details.\n",
        encoding="utf-8",
    )

    # The final commit must not retain one-shot migration automation.
    (WORKFLOWS / "finalize-monorepo.yml").unlink(missing_ok=True)
    Path(__file__).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
