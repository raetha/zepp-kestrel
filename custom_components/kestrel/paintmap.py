"""The paint map: where a watch's paints are, drawn as an SVG (for the image entity).

One compass dial per room the paints were made in (and one for paints made
before rooms were known). North is up; each spot sits at its heading, with
the horizon on the middle ring: higher spots (ceiling lights) towards the
centre, lower ones (floor lamps, the TV) towards the edge. A spot is drawn as
wide as it was painted, so crowded neighbours are easy to see. Corrections
are small dots; spots learned from use are hollow.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any
from xml.sax.saxutils import escape

DIAL = 300  # px per dial, legend included below it
RADIUS = 110
PITCH_TOP = 90  # straight up: the centre
PITCH_BOTTOM = -60  # the edge
COLUMNS = 2
PALETTE = (
    "#4e9af1", "#f28e2b", "#59a14f", "#e15759", "#b07aa1",
    "#edc948", "#76b7b2", "#ff9da7", "#9c755f", "#bab0ac",
)  # fmt: skip
INK = "#e6e6e6"
FAINT = "#5a5a5a"
PAPER = "#1c1c1c"


def _radius(pitch: float) -> float:
    pitch = max(PITCH_BOTTOM, min(PITCH_TOP, pitch))
    return RADIUS * (PITCH_TOP - pitch) / (PITCH_TOP - PITCH_BOTTOM)


def _point(cx: float, cy: float, heading: float, r: float) -> tuple[float, float]:
    a = math.radians(heading)
    return cx + r * math.sin(a), cy - r * math.cos(a)


def _wedge(cx: float, cy: float, spot: dict[str, Any]) -> str:
    """The patch of the dial a spot covers: its heading spread across, its pitch spread deep."""
    h, p = float(spot["heading"]), float(spot["pitch"])
    hs = max(3.0, min(30.0, float(spot.get("headingSpread") or 3)))
    ps = max(2.0, min(20.0, float(spot.get("pitchSpread") or 2)))
    r1, r2 = _radius(p + ps), _radius(p - ps)
    a1, a2 = h - hs, h + hs
    x1, y1 = _point(cx, cy, a1, r2)
    x2, y2 = _point(cx, cy, a2, r2)
    x3, y3 = _point(cx, cy, a2, r1)
    x4, y4 = _point(cx, cy, a1, r1)
    large = 1 if 2 * hs > 180 else 0
    return (
        f"M{x1:.1f},{y1:.1f} A{r2:.1f},{r2:.1f} 0 {large} 1 {x2:.1f},{y2:.1f} "
        f"L{x3:.1f},{y3:.1f} A{r1:.1f},{r1:.1f} 0 {large} 0 {x4:.1f},{y4:.1f} Z"
    )


def _room_order(room_names: dict[str, str]) -> Callable[[str | None], tuple[bool, str]]:
    """Rooms by name, paints made before rooms were known last."""

    def key(room: str | None) -> tuple[bool, str]:
        return (room is None, room_names.get(room, room).lower() if room is not None else "")

    return key


def render(
    paints: dict[str, list[dict[str, Any]]],
    room_names: dict[str, str],
    name_of: Callable[[str], str],
) -> str:
    """SVG of all paints, one dial per room. name_of(entity_id) gives a device's name."""
    by_room: dict[str | None, list[tuple[str, dict[str, Any]]]] = {}
    for entity_id, spots in paints.items():
        for spot in spots:
            by_room.setdefault(spot.get("room"), []).append((entity_id, spot))
    rooms = sorted(by_room, key=_room_order(room_names))
    colour = {e: PALETTE[i % len(PALETTE)] for i, e in enumerate(sorted(paints, key=lambda e: name_of(e).lower()))}

    if not rooms:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{DIAL}" height="80" viewBox="0 0 {DIAL} 80">'
            f'<rect width="100%" height="100%" fill="{PAPER}"/>'
            f'<text x="{DIAL / 2}" y="45" fill="{INK}" font-family="sans-serif" font-size="14" '
            'text-anchor="middle">Nothing painted yet</text></svg>'
        )

    legend_rows = max(len({e for e, _ in by_room[r]}) for r in rooms)
    cell_h = DIAL + 18 * legend_rows
    cols = min(COLUMNS, len(rooms))
    rows = math.ceil(len(rooms) / cols)
    width, height = cols * DIAL, rows * cell_h
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        'font-family="sans-serif">',
        f'<rect width="100%" height="100%" fill="{PAPER}"/>',
    ]
    for i, room in enumerate(rooms):
        ox, oy = (i % cols) * DIAL, (i // cols) * cell_h
        cx, cy = ox + DIAL / 2, oy + 30 + RADIUS + 14
        title = room_names.get(room, room) if room else "Any room"
        out.append(f'<text x="{cx}" y="{oy + 22}" fill="{INK}" font-size="16" text-anchor="middle">{escape(title)}</text>')
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{RADIUS}" fill="none" stroke="{FAINT}"/>')
        out.append(
            f'<circle cx="{cx}" cy="{cy}" r="{_radius(0):.1f}" fill="none" stroke="{FAINT}" stroke-dasharray="3 4"/>'
        )
        for heading, label in ((0, "N"), (90, "E"), (180, "S"), (270, "W")):
            x, y = _point(cx, cy, heading, RADIUS + 10)
            out.append(
                f'<text x="{x:.1f}" y="{y + 4:.1f}" fill="{FAINT}" font-size="11" text-anchor="middle">{label}</text>'
            )
        devices: list[str] = []
        for entity_id, spot in by_room[room]:
            if entity_id not in devices:
                devices.append(entity_id)
            c = colour[entity_id]
            kind = spot.get("kind")
            if kind == "correction":
                x, y = _point(cx, cy, float(spot["heading"]), _radius(float(spot["pitch"])))
                out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{c}"/>')
            elif kind == "learned":
                out.append(f'<path d="{_wedge(cx, cy, spot)}" fill="none" stroke="{c}" stroke-width="1.5"/>')
            else:
                out.append(f'<path d="{_wedge(cx, cy, spot)}" fill="{c}" fill-opacity="0.55" stroke="{c}"/>')
        for j, entity_id in enumerate(sorted(devices, key=lambda e: name_of(e).lower())):
            y = cy + RADIUS + 26 + 18 * j
            out.append(f'<rect x="{ox + 20}" y="{y - 10}" width="12" height="12" fill="{colour[entity_id]}"/>')
            out.append(f'<text x="{ox + 38}" y="{y}" fill="{INK}" font-size="13">{escape(name_of(entity_id)[:40])}</text>')
    out.append("</svg>")
    return "".join(out)
