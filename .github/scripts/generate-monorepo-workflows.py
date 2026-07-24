#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
OUT = ROOT / "generated-workflows"
SH_SOURCE = Path(os.environ["SH_SOURCE"])

TEMPORARY_WORKFLOWS = {
    "finalize-monorepo.yml",
    "generate-monorepo-workflows.yml",
    "sh-ci.yml",
}

CLOUDFLARE_WORKFLOWS = {
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


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def replace_hp_paths(text: str) -> str:
    replacements = (
        ("cloud/", "hp/cloud/"),
        ("video/", "hp/video/"),
        ("native/", "hp/native/"),
        ("working-directory: cloud", "working-directory: hp/cloud"),
        ("working-directory: video", "working-directory: hp/video"),
        ("working-directory: native", "working-directory: hp/native"),
        ("cd cloud", "cd hp/cloud"),
        ("cd video", "cd hp/video"),
        ("cd native", "cd hp/native"),
    )
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def insert_cloudflare_context(text: str) -> str:
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
        prefix = " " * indent
        nearby = "".join(out[-12:])
        if "./.github/actions/cloudflare-context" not in nearby:
            out.extend([
                f"{prefix}- name: Resolve Cloudflare account context\n",
                f"{prefix}  uses: ./.github/actions/cloudflare-context\n",
                f"{prefix}  with:\n",
                f"{prefix}    api-token: ${{{{ secrets.CLOUDFLARE_BUILDS_API_TOKEN }}}}\n",
            ])
    return "".join(out)


def write(name: str, text: str) -> None:
    if name in CLOUDFLARE_WORKFLOWS:
        text = insert_cloudflare_context(text)
    (OUT / name).write_text(text, encoding="utf-8")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    base_commit = git("rev-parse", "HEAD")
    base_tree = git("rev-parse", "HEAD^{tree}")

    # Existing HP workflows are rewritten for the hp/* subtree.
    for source in sorted(WORKFLOWS.glob("*.yml")):
        if source.name in TEMPORARY_WORKFLOWS:
            continue
        target_name = source.name
        text = source.read_text(encoding="utf-8")
        if source.name == "fetch-cloudflare-observability.yml":
            target_name = "hp-observability.yml"
            text = text.replace(
                ".github/workflows/fetch-cloudflare-observability.yml",
                ".github/workflows/hp-observability.yml",
            )
        write(target_name, replace_hp_paths(text))

    # SH workflows become active at repository root. SH's original paths remain
    # valid because the SH application tree is promoted to the Git root.
    for source in sorted((SH_SOURCE / ".github" / "workflows").glob("*.yml")):
        target_name = source.name
        text = source.read_text(encoding="utf-8")
        if source.name == "fetch-cloudflare-observability.yml":
            target_name = "sh-observability.yml"
            text = text.replace(
                ".github/workflows/fetch-cloudflare-observability.yml",
                ".github/workflows/sh-observability.yml",
            )
        write(target_name, text)

    files = sorted(path.name for path in OUT.glob("*.yml"))
    metadata = {
        "base_commit": base_commit,
        "base_tree": base_tree,
        "source_sh_commit": git("-C", str(SH_SOURCE), "rev-parse", "HEAD"),
        "files": files,
        "delete_paths": [
            ".github/workflows/fetch-cloudflare-observability.yml",
            ".github/workflows/finalize-monorepo.yml",
            ".github/workflows/generate-monorepo-workflows.yml",
            ".github/workflows/sh-ci.yml",
            ".github/scripts/generate-monorepo-workflows.py",
            ".github/scripts/trigger-monorepo.txt",
        ],
    }
    (OUT / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
