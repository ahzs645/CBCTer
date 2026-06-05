#!/usr/bin/env python3
"""Download GEPAR3D restricted Zenodo assets when access has been granted.

Without an authorized Zenodo token, the record metadata is visible but the files
are hidden. Set ZENODO_TOKEN after access approval to download the requested
archives.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import requests


DEFAULT_RECORD_ID = "15739014"
DEFAULT_FILES = ("GEPAR3D_dataset.zip", "32class_labels.zip")


def headers() -> dict[str, str]:
    token = os.environ.get("ZENODO_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def stream_download(url: str, output: Path) -> None:
    with requests.get(url, headers=headers(), stream=True, timeout=60) as response:
        response.raise_for_status()
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_suffix(output.suffix + ".part")
        with tmp.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
        tmp.replace(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record-id", default=DEFAULT_RECORD_ID)
    parser.add_argument("--output-dir", type=Path, default=Path("external/GEPAR3D-dataset"))
    parser.add_argument("--file", dest="files", action="append", default=[])
    args = parser.parse_args()

    wanted = set(args.files or DEFAULT_FILES)
    api_url = f"https://zenodo.org/api/records/{args.record_id}"
    response = requests.get(api_url, headers=headers(), timeout=60)
    response.raise_for_status()
    record = response.json()
    files = record.get("files", [])
    print(f"record: {record.get('title') or record.get('metadata', {}).get('title')}")
    print(f"access_right: {record.get('metadata', {}).get('access_right')}")
    print(f"visible_files: {len(files)}")

    if not files:
        access_request = record.get("links", {}).get("access_request")
        print("No files are visible to this session.")
        print("This usually means Zenodo access has not been granted for this account/token.")
        if access_request:
            print(f"access_request: {access_request}")
        raise SystemExit(2)

    by_name = {file_info["key"]: file_info for file_info in files}
    missing = sorted(wanted - set(by_name))
    if missing:
        print(f"Requested files not visible: {', '.join(missing)}")

    for name in sorted(wanted & set(by_name)):
        file_info = by_name[name]
        links = file_info.get("links", {})
        url = links.get("self") or links.get("download")
        if not url:
            print(f"Skipping {name}: no download link in API payload")
            continue
        output = args.output_dir / name
        print(f"Downloading {name} -> {output}")
        stream_download(url, output)
        print(f"Downloaded {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
