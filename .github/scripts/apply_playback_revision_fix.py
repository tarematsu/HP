from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    print(f"{label}: {count} match(es)")
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


header_path = Path("native/src/web_renderer.h")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    "  bool setupRequired = false;\n"
    "  int currentIndex = -1;\n",
    "  bool setupRequired = false;\n"
    "  std::wstring queueRevision;\n"
    "  int currentIndex = -1;\n",
    "store playback queue revision",
)
header_path.write_text(header, encoding="utf-8")

playback_path = Path("native/src/dashboard_native_playback.cpp")
playback = playback_path.read_text(encoding="utf-8")
playback = replace_once(
    playback,
    "    projection.setupRequired = setupRequired;\n"
    "    projection.sampledAt = fetchedAt;\n",
    "    projection.setupRequired = setupRequired;\n"
    "    projection.queueRevision = FirstText(value, {L\"queue_revision\", L\"queueRevision\"});\n"
    "    if (projection.queueRevision.empty()) {\n"
    "      projection.queueRevision =\n"
    "          FirstText(queueOwner, {L\"queue_revision\", L\"queueRevision\"});\n"
    "    }\n"
    "    projection.sampledAt = fetchedAt;\n",
    "parse queue revision",
)
playback = replace_once(
    playback,
    "        if (hasValidPayload) {\n"
    "          const bool contentChanged = !update.hasPayload || update.payload != payload;\n"
    "          update.payload = std::move(payload);\n"
    "          update.projection = std::move(projection);\n",
    "        if (hasValidPayload) {\n"
    "          const bool contentChanged = !update.hasPayload ||\n"
    "              (!projection.queueRevision.empty()\n"
    "                  ? projection.queueRevision != update.projection.queueRevision\n"
    "                  : update.payload != payload);\n"
    "          update.payload = std::move(payload);\n"
    "          update.projection = std::move(projection);\n",
    "use queue revision for content changes",
)
playback_path.write_text(playback, encoding="utf-8")

combined = header_path.read_text(encoding="utf-8") + playback_path.read_text(encoding="utf-8")
for marker in [
    "std::wstring queueRevision",
    "FirstText(value, {L\"queue_revision\", L\"queueRevision\"})",
    "projection.queueRevision != update.projection.queueRevision",
]:
    if marker not in combined:
        raise SystemExit(f"missing queue-revision marker: {marker}")
