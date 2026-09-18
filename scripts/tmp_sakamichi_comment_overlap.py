#!/usr/bin/env python3
import csv
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_RECENT

VIDEOS = {
    "nogizaka": {
        "label": "乃木坂46『是非に及ばず』",
        "video_id": "ogAufBgPpBk",
    },
    "hinatazaka": {
        "label": "日向坂46『イチャイチャ虫』",
        "video_id": "mgFUz_c4ToM",
    },
    "sakurazaka": {
        "label": "櫻坂46『愛MUST BE』",
        "video_id": "Sp4xl7wtqtc",
    },
}

OUT = Path("out/sakamichi_overlap")
OUT.mkdir(parents=True, exist_ok=True)
ITERATIONS = 500
SEED = 20260919


def pct(x, d):
    return 0.0 if d == 0 else 100.0 * x / d


def q(values, p):
    if not values:
        return 0.0
    vals = sorted(values)
    if len(vals) == 1:
        return vals[0]
    idx = (len(vals) - 1) * p
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return vals[lo]
    return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo)


def summarize(values):
    return {
        "mean": statistics.fmean(values) if values else 0.0,
        "median": statistics.median(values) if values else 0.0,
        "p2_5": q(values, 0.025),
        "p97_5": q(values, 0.975),
    }


def pattern_name(in_n, in_h, in_s):
    if in_n and in_h and in_s:
        return "nogizaka+hinatazaka+sakurazaka"
    if in_n and in_h:
        return "nogizaka+hinatazaka_only"
    if in_n and in_s:
        return "nogizaka+sakurazaka_only"
    if in_h and in_s:
        return "hinatazaka+sakurazaka_only"
    if in_n:
        return "nogizaka_only"
    if in_h:
        return "hinatazaka_only"
    return "sakurazaka_only"


def exact_patterns(sets):
    n, h, s = sets["nogizaka"], sets["hinatazaka"], sets["sakurazaka"]
    counts = Counter()
    for user in n | h | s:
        counts[pattern_name(user in n, user in h, user in s)] += 1
    ordered = [
        "nogizaka_only",
        "hinatazaka_only",
        "sakurazaka_only",
        "nogizaka+hinatazaka_only",
        "nogizaka+sakurazaka_only",
        "hinatazaka+sakurazaka_only",
        "nogizaka+hinatazaka+sakurazaka",
    ]
    return {k: counts[k] for k in ordered}


def pair_metrics(a_name, b_name, sets):
    a, b = sets[a_name], sets[b_name]
    inter = a & b
    union = a | b
    return {
        "a": a_name,
        "b": b_name,
        "intersection_users": len(inter),
        "a_users": len(a),
        "b_users": len(b),
        "share_of_a_pct": pct(len(inter), len(a)),
        "share_of_b_pct": pct(len(inter), len(b)),
        "overlap_coefficient_pct": pct(len(inter), min(len(a), len(b))),
        "jaccard_pct": pct(len(inter), len(union)),
    }


def collect_one(key, spec):
    url = f"https://www.youtube.com/watch?v={spec['video_id']}"
    downloader = YoutubeCommentDownloader()
    raw_path = OUT / f"{key}_comments.jsonl"
    users = defaultdict(lambda: {"author": "", "comment_count": 0, "reply_count": 0})
    total = 0
    missing_channel = 0
    with raw_path.open("w", encoding="utf-8") as f:
        for comment in downloader.get_comments_from_url(url, sort_by=SORT_BY_RECENT):
            total += 1
            f.write(json.dumps(comment, ensure_ascii=False) + "\n")
            channel = (comment.get("channel") or "").strip()
            if not channel:
                missing_channel += 1
                continue
            rec = users[channel]
            rec["author"] = comment.get("author") or rec["author"]
            rec["comment_count"] += 1
            if comment.get("reply"):
                rec["reply_count"] += 1

    unique_path = OUT / f"{key}_unique_users.csv"
    with unique_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["channel_id", "author", "comment_count", "reply_count"])
        for channel, rec in sorted(users.items(), key=lambda x: (-x[1]["comment_count"], x[0])):
            w.writerow([channel, rec["author"], rec["comment_count"], rec["reply_count"]])

    return set(users), {
        "label": spec["label"],
        "video_id": spec["video_id"],
        "total_comment_records": total,
        "unique_channel_users": len(users),
        "records_missing_channel_id": missing_channel,
    }


def main():
    sets = {}
    collection = {}
    for key, spec in VIDEOS.items():
        print(f"Collecting {spec['label']} ({spec['video_id']})", flush=True)
        sets[key], collection[key] = collect_one(key, spec)
        print(json.dumps(collection[key], ensure_ascii=False), flush=True)

    min_n = min(len(v) for v in sets.values())
    raw_union = len(set.union(*sets.values()))
    raw_patterns = exact_patterns(sets)
    raw_pairs = [
        pair_metrics("nogizaka", "hinatazaka", sets),
        pair_metrics("nogizaka", "sakurazaka", sets),
        pair_metrics("hinatazaka", "sakurazaka", sets),
    ]
    triple = sets["nogizaka"] & sets["hinatazaka"] & sets["sakurazaka"]

    raw_summary = {
        "collection": collection,
        "raw_union_users": raw_union,
        "equalized_sample_size_per_video": min_n,
        "raw_pairs": raw_pairs,
        "raw_triple": {
            "intersection_users": len(triple),
            "share_of_nogizaka_pct": pct(len(triple), len(sets["nogizaka"])),
            "share_of_hinatazaka_pct": pct(len(triple), len(sets["hinatazaka"])),
            "share_of_sakurazaka_pct": pct(len(triple), len(sets["sakurazaka"])),
            "share_of_min_group_pct": pct(len(triple), min_n),
            "share_of_union_pct": pct(len(triple), raw_union),
        },
        "raw_exact_patterns": {
            k: {"users": v, "share_of_union_pct": pct(v, raw_union)}
            for k, v in raw_patterns.items()
        },
    }

    rng = random.Random(SEED)
    populations = {k: tuple(sorted(v)) for k, v in sets.items()}
    metrics = defaultdict(list)
    for i in range(ITERATIONS):
        sampled = {
            k: (set(pop) if len(pop) == min_n else set(rng.sample(pop, min_n)))
            for k, pop in populations.items()
        }
        union_n = len(set.union(*sampled.values()))
        pair_defs = [
            ("nogizaka+hinatazaka", "nogizaka", "hinatazaka"),
            ("nogizaka+sakurazaka", "nogizaka", "sakurazaka"),
            ("hinatazaka+sakurazaka", "hinatazaka", "sakurazaka"),
        ]
        for label, a, b in pair_defs:
            c = len(sampled[a] & sampled[b])
            metrics[f"pair::{label}::intersection_users"].append(c)
            metrics[f"pair::{label}::shared_pct_of_equalized_group"].append(pct(c, min_n))
            metrics[f"pair::{label}::jaccard_pct"].append(pct(c, len(sampled[a] | sampled[b])))

        triple_n = len(sampled["nogizaka"] & sampled["hinatazaka"] & sampled["sakurazaka"])
        metrics["triple::intersection_users"].append(triple_n)
        metrics["triple::shared_pct_of_equalized_group"].append(pct(triple_n, min_n))
        metrics["triple::share_of_sampled_union_pct"].append(pct(triple_n, union_n))

        pats = exact_patterns(sampled)
        for pat, c in pats.items():
            metrics[f"pattern::{pat}::users"].append(c)
            metrics[f"pattern::{pat}::share_of_sampled_union_pct"].append(pct(c, union_n))

    balanced_summary = {
        "method": {
            "sample_size_per_video": min_n,
            "iterations": ITERATIONS,
            "seed": SEED,
            "sampling": "uniform_without_replacement_from_each_video_unique_channel_users",
            "interval": "empirical_2.5_to_97.5_percentiles_across_resamples",
        },
        "metrics": {k: summarize(v) for k, v in sorted(metrics.items())},
    }

    result = {
        "videos": VIDEOS,
        "identity_key": "YouTube commenter channel ID (comment['channel']); records without channel ID excluded from user-overlap calculations",
        "raw": raw_summary,
        "balanced": balanced_summary,
    }
    (OUT / "analysis.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    with (OUT / "raw_exact_patterns.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["pattern", "users", "share_of_union_pct"])
        for k, v in raw_summary["raw_exact_patterns"].items():
            w.writerow([k, v["users"], f"{v['share_of_union_pct']:.6f}"])

    with (OUT / "balanced_metrics.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["metric", "mean", "median", "p2_5", "p97_5"])
        for k, v in balanced_summary["metrics"].items():
            w.writerow([k, v["mean"], v["median"], v["p2_5"], v["p97_5"]])

    print("RESULT_SUMMARY")
    print(json.dumps({
        "unique_users": {k: len(v) for k, v in sets.items()},
        "equalized_n": min_n,
        "raw_pairs": raw_pairs,
        "raw_triple_users": len(triple),
        "raw_union_users": raw_union,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
