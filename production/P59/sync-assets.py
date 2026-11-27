#!/usr/bin/env python3
"""Mirror the *published* P59 card assets, verifying bytes before committing.

Usage from repository root:
    python3 production/P59/sync-assets.py

The images are publicly served by the existing Worker. No Cloudflare tokens needed.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

BASE_URL = os.getenv("PIDOR_ASSETS_BASE", "https://pidor.uvidimsyamd.workers.dev").rstrip("/")
DEST = pathlib.Path(__file__).resolve().parent / "assets" / "cards"
SUITS = ("H", "D", "C", "S")
RANKS = ("06", "07", "08", "09", "10", "J", "Q", "K", "A")
FILES = ["BACK_COMMON.webp"] + [f"{rank}_{suit}.webp" for rank in RANKS for suit in SUITS]
assert len(FILES) == 37

def retrieve(filename: str) -> bytes:
    url = f"{BASE_URL}/cards/{filename}"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "PIDOR-asset-backup/1.0 (owner-requested GitHub backup)",
                "Accept": "image/webp",
            })
            with urllib.request.urlopen(req, timeout=28) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                content = response.read(5_000_001)
                if "image/webp" not in content_type and "application/octet-stream" not in content_type:
                    raise RuntimeError(f"{filename}: unexpected content type {content_type!r}")
                if not (30 <= len(content) <= 5_000_000):
                    raise RuntimeError(f"{filename}: invalid file size {len(content)}")
                if content[:4] != b"RIFF" or content[8:12] != b"WEBP":
                    raise RuntimeError(f"{filename}: invalid WebP signature")
                return content
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            last = exc
            if attempt < 2:
                time.sleep(1.4 * (attempt + 1))
    raise RuntimeError(f"Unable to download verified {url}: {last}") from last

def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {"release": "P59", "source": BASE_URL, "format": "image/webp", "files": {}}
    missing = []
    for index, filename in enumerate(FILES, 1):
        try:
            content = retrieve(filename)
        except RuntimeError as exc:
            missing.append(str(exc))
            print(f"[{index:02d}/37] FAIL {filename}: {exc}", flush=True)
            continue
        path = DEST / filename
        path.write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        manifest["files"][f"cards/{filename}"] = {"size": len(content), "sha256": digest}
        print(f"[{index:02d}/37] OK   {filename} ({len(content)} bytes)", flush=True)
    if missing:
        raise SystemExit("Asset backup INCOMPLETE: " + str(len(missing)) + " failures:\n" + "\n".join(missing))
    (DEST.parent / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Validated all {len(FILES)} P59 WebP card files; manifest saved.", flush=True)

if __name__ == "__main__":
    main()
