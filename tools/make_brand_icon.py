#!/usr/bin/env python3
"""Generates the HACS brand icons for the AutiPlanner integration.

HACS requires a `brand/` directory containing at least `icon.png`. This script
draws the icon from code so the asset is reproducible and reviewable instead of
an unexplained binary.

Usage:
    python3 tools/make_brand_icon.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 256
OUTPUT = Path(__file__).resolve().parents[1] / "custom_components" / "autiplanner" / "brand"

# Matches the Android launcher background so the product reads consistently.
BACKGROUND = (46, 74, 98)
FOREGROUND = (255, 255, 255)

#: Check mark, as a fraction of the icon size.
CHECK = (
    (0.28, 0.53, 0.43, 0.68),
    (0.43, 0.68, 0.74, 0.33),
)
STROKE = 0.085
CORNER_RADIUS = 0.22
SAMPLES = 4


def _rounded_square_coverage(x: float, y: float, size: float, radius: float) -> float:
    """1.0 inside the rounded square, 0.0 outside."""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    if radius <= x <= size - radius or radius <= y <= size - radius:
        inside = 0 <= x <= size and 0 <= y <= size
    else:
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius**2
    return 1.0 if inside else 0.0


def _distance_to_segment(
    px: float, py: float, x1: float, y1: float, x2: float, y2: float
) -> float:
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return ((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2) ** 0.5


def _check_coverage(x: float, y: float, size: float) -> float:
    half = STROKE * size / 2
    for x1, y1, x2, y2 in CHECK:
        distance = _distance_to_segment(x, y, x1 * size, y1 * size, x2 * size, y2 * size)
        if distance <= half:
            return 1.0
    return 0.0


def render(size: int = SIZE) -> bytes:
    radius = CORNER_RADIUS * size
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type 0
        for x in range(size):
            background = 0.0
            foreground = 0.0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    px = x + (sx + 0.5) / SAMPLES
                    py = y + (sy + 0.5) / SAMPLES
                    background += _rounded_square_coverage(px, py, size, radius)
                    foreground += _check_coverage(px, py, size)
            samples = SAMPLES * SAMPLES
            background /= samples
            foreground = min(foreground / samples, background)
            if background == 0.0:
                rows.extend((0, 0, 0, 0))
                continue
            blend = foreground / background if background else 0.0
            colour = tuple(
                round(BACKGROUND[i] + (FOREGROUND[i] - BACKGROUND[i]) * blend) for i in range(3)
            )
            rows.extend((*colour, round(background * 255)))
    return bytes(rows)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(raw: bytes, size: int = SIZE) -> bytes:
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    payload = encode_png(render())
    # `dark_icon.png` keeps the icon legible on dark themes. The artwork already
    # carries its own background, so the same image is used for both.
    for name in ("icon.png", "dark_icon.png"):
        (OUTPUT / name).write_bytes(payload)
        print(f"wrote {OUTPUT / name} ({len(payload)} bytes)")


if __name__ == "__main__":
    main()
