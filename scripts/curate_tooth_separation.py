#!/usr/bin/env python3
"""Create a review-oriented manifest from separated tooth candidates."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def quality_status(item: dict[str, object]) -> tuple[str, list[str], float]:
    reasons: list[str] = []
    voxels = int(item.get("assignedVoxels", 0))
    extent = [int(value) for value in item.get("extentZYX", [0, 0, 0])]
    centroid = [float(value) for value in item.get("centroidZYX", [0, 0, 0])]

    if voxels < 10_000:
        reasons.append("small-fragment")
    if voxels > 140_000:
        reasons.append("large-region")
    if min(extent) < 18:
        reasons.append("thin-fragment")
    if extent[0] > 115 or extent[1] > 95 or extent[2] > 100:
        reasons.append("broad-region")
    if centroid[0] < 55 or centroid[0] > 260:
        reasons.append("z-outlier")
    if centroid[1] < 55 or centroid[1] > 380:
        reasons.append("y-outlier")
    if centroid[2] < 95 or centroid[2] > 520:
        reasons.append("x-outlier")

    score = 1.0
    score -= 0.18 * len(reasons)
    if 18_000 <= voxels <= 120_000:
        score += 0.12
    if all(22 <= value <= limit for value, limit in zip(extent, [105, 90, 95], strict=True)):
        score += 0.12
    score = max(0.0, min(1.0, score))
    return ("accepted" if not reasons else "review"), reasons, round(score, 3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("public/sample-segmentation"))
    parser.add_argument("--target", type=Path, default=Path("public/sample-segmentation-curated"))
    args = parser.parse_args()

    if args.target.exists():
        shutil.rmtree(args.target)
    shutil.copytree(args.source, args.target)

    manifest_path = args.target / "manifest.json"
    manifest = json.load(manifest_path.open())
    accepted = 0
    review = 0
    for item in manifest["items"]:
        status, reasons, score = quality_status(item)
        item["qualityStatus"] = status
        item["qualityReasons"] = reasons
        item["qualityScore"] = score
        if status == "accepted":
            accepted += 1
        else:
            review += 1

    manifest["source"] = f"{manifest.get('source', 'segmentation')}-curated"
    manifest["qualityAccepted"] = accepted
    manifest["qualityReview"] = review
    manifest_path.write_text(json.dumps(manifest, indent=2))
    (args.target / "summary.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({
        "target": str(args.target),
        "items": len(manifest["items"]),
        "qualityAccepted": accepted,
        "qualityReview": review,
    }, indent=2))


if __name__ == "__main__":
    main()
