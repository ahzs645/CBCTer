#!/usr/bin/env python3
"""Summarize final-vs-best ToothSeg browser-library outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_manifest(root: Path) -> dict:
    return json.loads((root / "manifest.json").read_text())


def item_summary(manifest: dict) -> dict[int, dict]:
    rows = {}
    for item in manifest.get("items", []):
        fdi = int(item.get("fdi") or item["label"])
        rows[fdi] = {
            "label": int(item["label"]),
            "name": item.get("fdiName") or item.get("name"),
            "voxels": int(item.get("assignedVoxels", 0)),
            "status": item.get("qualityStatus", "accepted"),
        }
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final-public", type=Path, required=True)
    parser.add_argument("--best-public", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    final = load_manifest(args.final_public)
    best = load_manifest(args.best_public)
    final_items = item_summary(final)
    best_items = item_summary(best)
    all_fdi = sorted(set(final_items) | set(best_items))
    rows = []
    for fdi in all_fdi:
        final_row = final_items.get(fdi)
        best_row = best_items.get(fdi)
        rows.append(
            {
                "fdi": fdi,
                "name": (final_row or best_row or {}).get("name"),
                "finalVoxels": final_row["voxels"] if final_row else 0,
                "bestVoxels": best_row["voxels"] if best_row else 0,
                "deltaVoxels": (best_row["voxels"] if best_row else 0)
                - (final_row["voxels"] if final_row else 0),
                "finalPresent": final_row is not None,
                "bestPresent": best_row is not None,
            }
        )

    result = {
        "final": {
            "root": str(args.final_public),
            "items": len(final_items),
            "positiveVoxels": int(final.get("positiveVoxels", 0)),
            "fdi": sorted(final_items),
        },
        "best": {
            "root": str(args.best_public),
            "items": len(best_items),
            "positiveVoxels": int(best.get("positiveVoxels", 0)),
            "fdi": sorted(best_items),
        },
        "missingInFinal": sorted(set(best_items) - set(final_items)),
        "missingInBest": sorted(set(final_items) - set(best_items)),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
