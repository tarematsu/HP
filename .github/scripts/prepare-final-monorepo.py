#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HP_MAIN = Path(os.environ["HP_MAIN"])
SH_SOURCE = Path(os.environ["SH_SOURCE"])
OUT = ROOT / "corrected-workflows"

CLOUDFLARE_WORKFLOWS = {
    "audit-d1-storage.yml",
    "cloud-deploy.yml",
    "database.yml",
    "deploy-split-pipeline.yml",
    "fetch-cloudflare-d1-usage.yml",
    "hp-observability.yml",
    "sh-observability.yml",
    "video-provision-manual-import-queue.yml",
    "video-worker-cpu-report.yml",
}


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
        ('path.resolve("cloud",', 'path.resolve("hp/cloud",'),
        ("path.resolve('cloud',", "path.resolve('hp/cloud',"),
        ('path.resolve("video",', 'path.resolve("hp/video",'),
        ("path.resolve('video',", "path.resolve('hp/video',"),
        ('path.resolve("native",', 'path.resolve("hp/native",'),
        ("path.resolve('native',", "path.resolve('hp/native',"),
    )
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def sync_latest_hp() -> None:
    hp_root = ROOT / "hp"
    hp_root.mkdir(exist_ok=True)
    for directory in ("cloud", "video", "native"):
        source = HP_MAIN / directory
        destination = hp_root / directory
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)
    for document in ("AGENTS.md", "README.md", "DEPLOYMENT.md"):
        source = HP_MAIN / document
        if source.exists():
            shutil.copy2(source, hp_root / document)

    source_scripts = HP_MAIN / ".github" / "scripts"
    destination_scripts = ROOT / ".github" / "scripts"
    destination_scripts.mkdir(parents=True, exist_ok=True)
    for source in source_scripts.rglob("*"):
        if not source.is_file():
            continue
        destination = destination_scripts / source.relative_to(source_scripts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            text = source.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            shutil.copy2(source, destination)
            continue
        destination.write_text(replace_hp_paths(text), encoding="utf-8")


def remove_account_id_env(text: str) -> str:
    return "".join(
        line for line in text.splitlines(keepends=True)
        if not re.match(r"^\s*CLOUDFLARE_ACCOUNT_ID:\s*", line)
    )


def checkout_step_ranges(lines: list[str]) -> list[tuple[int, int, int, bool]]:
    ranges: list[tuple[int, int, int, bool]] = []
    for index, line in enumerate(lines):
        if "uses: actions/checkout@v4" not in line:
            continue
        line_indent = len(line) - len(line.lstrip(" "))
        if line.lstrip().startswith("- uses:"):
            start = index
            step_indent = line_indent
        else:
            start = index
            step_indent = max(0, line_indent - 2)
            for candidate in range(index - 1, -1, -1):
                stripped = lines[candidate].lstrip()
                indent = len(lines[candidate]) - len(stripped)
                if indent == step_indent and stripped.startswith("- "):
                    start = candidate
                    break
        end = index + 1
        while end < len(lines):
            stripped = lines[end].lstrip()
            indent = len(lines[end]) - len(stripped)
            if indent == step_indent and stripped.startswith("- "):
                break
            end += 1
        conditional = any(
            entry.lstrip().startswith("if:")
            for entry in lines[start:end]
        )
        ranges.append((start, end, step_indent, conditional))
    return ranges


def insert_cloudflare_context(text: str) -> str:
    text = remove_account_id_env(text)
    lines = text.splitlines(keepends=True)
    ranges = checkout_step_ranges(lines)
    for _start, end, step_indent, conditional in reversed(ranges):
        if conditional:
            continue
        block = "".join(lines[max(0, end - 12):end])
        if "./.github/actions/cloudflare-context" in block:
            continue
        prefix = " " * step_indent
        lines[end:end] = [
            f"{prefix}- name: Resolve Cloudflare account context\n",
            f"{prefix}  uses: ./.github/actions/cloudflare-context\n",
            f"{prefix}  with:\n",
            f"{prefix}    api-token: ${{{{ secrets.CLOUDFLARE_BUILDS_API_TOKEN }}}}\n",
        ]
    return "".join(lines)


def write_workflow(name: str, text: str) -> None:
    if name in CLOUDFLARE_WORKFLOWS:
        text = insert_cloudflare_context(text)
        if "./.github/actions/cloudflare-context" not in text:
            raise RuntimeError(f"Cloudflare context was not inserted into {name}")
        if re.search(r"CLOUDFLARE_ACCOUNT_ID:\s*['\"]?[0-9a-f]{32}", text, re.I):
            raise RuntimeError(f"hard-coded Cloudflare account ID remains in {name}")
    (OUT / name).write_text(text, encoding="utf-8")


def build_workflows() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    for source in sorted((HP_MAIN / ".github" / "workflows").glob("*.yml")):
        target_name = source.name
        text = source.read_text(encoding="utf-8")
        if source.name == "fetch-cloudflare-observability.yml":
            target_name = "hp-observability.yml"
            text = text.replace(
                ".github/workflows/fetch-cloudflare-observability.yml",
                ".github/workflows/hp-observability.yml",
            )
        write_workflow(target_name, replace_hp_paths(text))

    for source in sorted((SH_SOURCE / ".github" / "workflows").glob("*.yml")):
        target_name = source.name
        text = source.read_text(encoding="utf-8")
        if source.name == "fetch-cloudflare-observability.yml":
            target_name = "sh-observability.yml"
            text = text.replace(
                ".github/workflows/fetch-cloudflare-observability.yml",
                ".github/workflows/sh-observability.yml",
            )
        write_workflow(target_name, text)

    metadata = {
        "files": sorted(path.name for path in OUT.glob("*.yml")),
        "source_sh_commit": "741ccc82c94a17cbe3f3b57f8b6f180105ee1922",
        "source_hp_commit": "89bd022d6c106ffbaea2dd2a3f1a706f56f9a127",
    }
    (OUT / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, indent=2))


def main() -> None:
    sync_latest_hp()
    build_workflows()


if __name__ == "__main__":
    main()
