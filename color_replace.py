#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cross-platform color replace tool.
- Replace hex colors in text/code/SVG
- Replace pixel colors in raster images (RGB only; alpha preserved)
- Optional timestamped backups (off by default; use --backup)

Usage:
  python color_replace.py [colors.map] [root_dir]

Map file format (whitespace-separated, 6-hex ONLY, no '#'):
  BAC3FF BFD8C0
  0C1649 050A07   # trailing comment ok (must be preceded by whitespace)

Env / args:
  --fuzz 6        # fuzz percent for image matching (default 6)
  --dry-run       # show what would change, do not write
  --backup        # create timestamped backups (default: off)
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Tuple

# Pillow required
try:
    from PIL import Image
except Exception as e:
    print("ERROR: Pillow not installed. Run: pip install pillow", file=sys.stderr)
    raise

# Optional numpy acceleration
try:
    import numpy as np  # type: ignore

    HAS_NUMPY = True
except Exception:
    HAS_NUMPY = False


# -----------------------------
# Config: file extensions
# -----------------------------
CODE_EXTS = {
    ".ux",
    ".js",
    ".ts",
    ".json",
    ".css",
    ".less",
    ".scss",
    ".xml",
    ".html",
    ".wxml",
    ".wxss",
    ".qml",
    ".vue",
    ".md",
    ".txt",
}
SVG_EXTS = {".svg"}
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


HEX6_RE = re.compile(r"^[0-9A-F]{6}$")


@dataclass(frozen=True)
class Mapping:
    old_hex: str  # uppercase, 6 chars
    new_hex: str  # uppercase, 6 chars
    old_rgb: Tuple[int, int, int]
    new_rgb: Tuple[int, int, int]


def hex6_to_rgb(h: str) -> Tuple[int, int, int]:
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def load_map_file(map_path: Path) -> List[Mapping]:
    mappings: List[Mapping] = []
    for idx, raw in enumerate(
        map_path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1
    ):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # strip trailing comments that start with whitespace + '#'
        line = re.sub(r"\s#.*$", "", line).strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            raise ValueError(f"Invalid mapping format at line {idx}: {raw!r}")
        old, new = parts[0].upper(), parts[1].upper()
        if not HEX6_RE.match(old):
            raise ValueError(
                f"Invalid old color at line {idx} (must be 6 hex digits): {old}"
            )
        if not HEX6_RE.match(new):
            raise ValueError(
                f"Invalid new color at line {idx} (must be 6 hex digits): {new}"
            )
        mappings.append(
            Mapping(
                old_hex=old,
                new_hex=new,
                old_rgb=hex6_to_rgb(old),
                new_rgb=hex6_to_rgb(new),
            )
        )
    if not mappings:
        raise ValueError("No valid mappings found in map file.")
    return mappings


# -----------------------------
# Text replacement
# -----------------------------
def replace_in_text(content: str, mappings: List[Mapping]) -> Tuple[str, int]:
    """
    Replace:
      1) #RRGGBB (case-insensitive)
      2) 0xRRGGBB (case-insensitive)
      3) #AARRGGBB : keep AA, replace RGB
      4) 0xAARRGGBB: keep AA, replace RGB
    Returns (new_content, replacement_count)
    """
    total = 0
    out = content

    for m in mappings:
        old = m.old_hex
        new = m.new_hex

        # 1) #RRGGBB
        pat1 = re.compile(rf"#({old})", re.IGNORECASE)
        out, n = pat1.subn(f"#{new}", out)
        total += n

        # 2) 0xRRGGBB
        pat2 = re.compile(rf"0x({old})", re.IGNORECASE)
        out, n = pat2.subn(f"0x{new}", out)
        total += n

        # 3) #AARRGGBB -> keep AA, swap RGB
        pat3 = re.compile(rf"#([0-9A-Fa-f]{{2}})({old})", re.IGNORECASE)
        out, n = pat3.subn(rf"#\g<1>{new}", out)  # keep alpha
        total += n

        # 4) 0xAARRGGBB -> keep AA, swap RGB
        pat4 = re.compile(rf"0x([0-9A-Fa-f]{{2}})({old})", re.IGNORECASE)
        out, n = pat4.subn(rf"0x\g<1>{new}", out)  # keep alpha
        total += n

    return out, total


def process_text_file(
    path: Path,
    mappings: List[Mapping],
    backup_dir: Path,
    dry_run: bool,
    do_backup: bool,
) -> int:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        # As a fallback, treat as binary-ish text
        content = path.read_bytes().decode("utf-8", errors="replace")

    new_content, n = replace_in_text(content, mappings)
    if n <= 0:
        return 0

    if dry_run:
        return n

    if do_backup:
        backup_path = backup_dir / path
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup_path)

    path.write_text(new_content, encoding="utf-8")
    return n


# -----------------------------
# Image replacement (RGB only; alpha preserved)
# -----------------------------
def fuzz_percent_to_threshold(fuzz_percent: float) -> int:
    """
    Convert fuzz percent to per-channel tolerance (0..255).
    ImageMagick fuzz is more nuanced; this is a practical approximation:
      tol = 255 * (fuzz_percent/100)
    We'll do per-channel absolute tolerance.
    """
    return max(0, min(255, int(round(255.0 * (fuzz_percent / 100.0)))))


def replace_pixels_pillow(
    img: Image.Image, mappings: List[Mapping], tol: int
) -> Tuple[Image.Image, int]:
    """
    Replace pixels whose RGB is within tolerance of old_rgb.
    - For RGBA: alpha preserved (only RGB changed)
    - For RGB: just changes RGB
    Returns (new_img, changed_pixel_count)
    """
    mode = img.mode
    if mode not in ("RGB", "RGBA"):
        # Convert paletted/LA/etc to RGBA for reliable ops
        img = img.convert("RGBA")
        mode = "RGBA"

    if HAS_NUMPY:
        arr = np.array(img)  # (H,W,3|4)
        if mode == "RGB":
            rgb = arr
            a = None
        else:
            rgb = arr[:, :, :3]
            a = arr[:, :, 3:4]  # alpha kept

        # IMPORTANT: match against original pixels only
        orig_rgb = rgb.astype(np.int16).copy()

        # Track which pixels have been replaced already
        done = np.zeros(orig_rgb.shape[:2], dtype=bool)

        changed = 0

        for m in mappings:
            old = np.array(m.old_rgb, dtype=np.int16)
            new = np.array(m.new_rgb, dtype=np.uint8)

            diff = np.abs(orig_rgb - old)
            mask = (
                (~done)
                & (diff[:, :, 0] <= tol)
                & (diff[:, :, 1] <= tol)
                & (diff[:, :, 2] <= tol)
            )

            cnt = int(mask.sum())
            if cnt:
                rgb[mask] = new
                done[mask] = True
                changed += cnt

        if mode == "RGB":
            out = Image.fromarray(rgb.astype(np.uint8), mode="RGB")
        else:
            out_arr = np.concatenate([rgb.astype(np.uint8), a.astype(np.uint8)], axis=2)
            out = Image.fromarray(out_arr, mode="RGBA")

        return out, changed

    # Fallback without numpy (slower)
    px = img.load()
    w, h = img.size
    changed = 0
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if mode == "RGB":
                r, g, b = p
                a = None
            else:
                r, g, b, a = p
            for m in mappings:
                or_, og, ob = m.old_rgb
                if abs(r - or_) <= tol and abs(g - og) <= tol and abs(b - ob) <= tol:
                    nr, ng, nb = m.new_rgb
                    if mode == "RGB":
                        px[x, y] = (nr, ng, nb)
                    else:
                        px[x, y] = (nr, ng, nb, a)  # preserve alpha
                    changed += 1
                    break
    return img, changed


def process_image_file(
    path: Path,
    mappings: List[Mapping],
    backup_dir: Path,
    fuzz_percent: float,
    dry_run: bool,
    do_backup: bool,
) -> int:
    tol = fuzz_percent_to_threshold(fuzz_percent)

    try:
        img = Image.open(path)
        img.load()
    except Exception:
        return 0

    # Keep original format info
    fmt = img.format  # e.g. PNG/JPEG/WEBP

    new_img, changed = replace_pixels_pillow(img, mappings, tol)
    if changed <= 0:
        return 0

    if dry_run:
        return changed

    if do_backup:
        backup_path = backup_dir / path
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup_path)

    # Save with reasonable defaults
    save_kwargs = {}
    suffix = path.suffix.lower()

    if suffix in (".jpg", ".jpeg"):
        # JPEG has no alpha; if we ended in RGBA, composite to RGB on black to be safe
        if new_img.mode == "RGBA":
            bg = Image.new("RGB", new_img.size, (0, 0, 0))
            bg.paste(new_img, mask=new_img.split()[-1])
            new_img = bg
        save_kwargs["quality"] = 95
        save_kwargs["optimize"] = True

    elif suffix == ".png":
        save_kwargs["optimize"] = True

    elif suffix == ".webp":
        save_kwargs["quality"] = 95
        save_kwargs["lossless"] = True

    elif suffix == ".gif":
        # GIF is paletted; saving RGBA directly will re-quantize
        pass

    new_img.save(path, format=fmt, **save_kwargs)
    return changed


# -----------------------------
# Main traversal
# -----------------------------
def should_skip(path: Path) -> bool:
    # skip any backup dirs created by this tool (past or present)
    s = str(path)
    return ".color_replace_backup_" in s


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Replace colors in text/SVG and raster images (RGB only; alpha preserved)."
    )
    ap.add_argument(
        "map_file",
        nargs="?",
        default="colors.map",
        help="Path to colors.map (default: colors.map)",
    )
    ap.add_argument(
        "root", nargs="?", default=".", help="Root directory to scan (default: .)"
    )
    ap.add_argument(
        "--fuzz",
        type=float,
        default=6.0,
        help="Fuzz tolerance percent for images (default: 6)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Only report changes; do not write/backup",
    )
    ap.add_argument(
        "--backup",
        action="store_true",
        help="Create timestamped backups (default: off)",
    )
    args = ap.parse_args()

    map_path = Path(args.map_file)
    root = Path(args.root)

    if not map_path.is_file():
        print(f"ERROR: map file not found: {map_path}", file=sys.stderr)
        return 1
    if not root.exists():
        print(f"ERROR: root not found: {root}", file=sys.stderr)
        return 1

    mappings = load_map_file(map_path)

    print("Mappings:")
    for m in mappings:
        print(f"  #{m.old_hex} -> #{m.new_hex}")
    print()

    backup_dir = Path(
        f".color_replace_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    if args.backup and (not args.dry_run):
        backup_dir.mkdir(parents=True, exist_ok=True)

    text_total = 0
    img_total = 0
    files_touched = 0

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if should_skip(p):
            continue

        ext = p.suffix.lower()

        try:
            if ext in CODE_EXTS or ext in SVG_EXTS:
                n = process_text_file(
                    p, mappings, backup_dir, args.dry_run, args.backup
                )
                if n:
                    text_total += n
                    files_touched += 1

            elif ext in IMG_EXTS:
                n = process_image_file(
                    p, mappings, backup_dir, args.fuzz, args.dry_run, args.backup
                )
                if n:
                    img_total += n
                    files_touched += 1
        except Exception as e:
            # fail-soft per file
            print(f"WARN: failed processing {p}: {e}", file=sys.stderr)

    print("Done ✅")
    print(f"  Files changed: {files_touched}")
    print(f"  Text replacements: {text_total}")
    print(f"  Image pixels changed: {img_total}")
    if args.dry_run:
        print("  (dry-run: no files were written)")
    elif args.backup:
        print(f"  Backups saved at: {backup_dir}")
    else:
        print("  (no backups: use --backup to enable)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
