#!/usr/bin/env python3
"""Deterministically extract the static Ability Catalogue artwork.

The manifest is intentionally declarative: every sprite-sheet grid, frame
index, crop, padding, and compositing instruction lives beside the generated
asset contract. The output is production-ready transparent WebP artwork; the
browser never runs this script.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageColor, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
MANIFEST_PATH = SCRIPT_DIR / "ability_catalogue_icon_manifest.json"
OUTPUT_ROOT = REPO_ROOT / "frontend/public/assets/ability-list/icons"


def fail(message: str) -> None:
    raise ValueError(message)


def source_path(relative_path: str) -> Path:
    """Resolve a manifest source while allowing Pixi geometry references."""
    if "#" in relative_path:
        return REPO_ROOT / relative_path.split("#", 1)[0]
    return REPO_ROOT / relative_path


def validate_grid(image: Image.Image, grid: dict[str, Any], name: str) -> tuple[int, int, int]:
    columns = grid.get("columns")
    rows = grid.get("rows")
    frame_index = grid.get("frame_index")
    if not all(isinstance(value, int) and value > 0 for value in (columns, rows)):
        fail(f"{name}: grid columns and rows must be positive integers")
    if not isinstance(frame_index, int) or frame_index < 0:
        fail(f"{name}: grid frame_index must be a non-negative integer")
    frame_count = columns * rows
    used_frames = grid.get("used_frames", frame_count)
    if not isinstance(used_frames, int) or not 0 < used_frames <= frame_count:
        fail(f"{name}: used_frames must be between 1 and {frame_count}")
    if frame_index >= used_frames:
        fail(f"{name}: frame_index {frame_index} is outside the first {used_frames} frames")
    return columns, rows, frame_index


def extract_frame(image: Image.Image, spec: dict[str, Any], name: str) -> Image.Image:
    grid = spec.get("grid")
    if grid is None:
        return image.copy()
    columns, rows, frame_index = validate_grid(image, grid, name)
    # Match abilitySpriteAssets.js: frame bounds are calculated from the
    # floating-point cell size, then the raster crop rounds those bounds.
    cell_width = image.width / columns
    cell_height = image.height / rows
    column = frame_index % columns
    row = frame_index // columns
    bounds = (round(column * cell_width), round(row * cell_height),
              round((column + 1) * cell_width), round((row + 1) * cell_height))
    return image.crop(bounds)


def crop_to_alpha(image: Image.Image, name: str) -> Image.Image:
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        fail(f"{name}: selected frame has no visible alpha")
    return image.crop(bbox)


def apply_tint(image: Image.Image, tint: str | None) -> Image.Image:
    if not tint:
        return image
    rgb = ImageColor.getrgb(tint)
    colored = Image.new("RGBA", image.size, (*rgb, 0))
    colored.putalpha(image.getchannel("A"))
    return colored


def apply_opacity(image: Image.Image, opacity: float) -> Image.Image:
    if opacity == 1:
        return image
    if not 0 <= opacity <= 1:
        fail(f"opacity must be between 0 and 1, got {opacity}")
    alpha = image.getchannel("A").point(lambda value: round(value * opacity))
    result = image.copy()
    result.putalpha(alpha)
    return result


def prepare_art_layer(spec: dict[str, Any], name: str) -> Image.Image:
    source = spec.get("source")
    if not isinstance(source, str):
        fail(f"{name}: source path is required")
    path = source_path(source)
    if not path.exists():
        fail(f"{name}: source does not exist: {source}")
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    image = extract_frame(image, spec, name)
    if spec.get("crop") != "alpha":
        fail(f"{name}: crop must explicitly be 'alpha'")
    image = crop_to_alpha(image, name)
    image = apply_tint(image, spec.get("tint"))
    return apply_opacity(image, float(spec.get("opacity", 1)))


def resize_preserving_aspect(image: Image.Image, max_extent: int) -> Image.Image:
    if max_extent <= 0:
        fail(f"max extent must be positive, got {max_extent}")
    # Upscaling is intentional for catalogue artwork: every source frame is
    # normalized to the same high-resolution icon canvas without stretching.
    scale = max_extent / max(image.size)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def parse_color(value: str) -> tuple[int, int, int, int]:
    return (*ImageColor.getrgb(value), 255)


def draw_status_symbol(status: str, size: int, color: str, symbol_scale: int) -> Image.Image:
    """Rasterize PixiCanvas.jsx drawStatusSymbol() at supersampled resolution.

    The coordinate geometry below mirrors the RA and AG branches in
    frontend/src/beta/PixiCanvas.jsx. Keep both implementations together when
    the in-arena status-symbol geometry changes.
    """
    supersample = 4
    canvas = Image.new("RGBA", (size * supersample, size * supersample), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    center = size * supersample / 2
    unit = symbol_scale * supersample
    stroke = max(1, round(2 * unit))
    rgba = parse_color(color)

    def point(x: float, y: float) -> tuple[float, float]:
        return center + x * unit, center + y * unit

    if status == "RA":
        # Pixi: poly([x,y-7,x+6,y-4,x+5,y+4,x,y+8,
        # x-5,y+4,x-6,y-4]).stroke(...); three prongs at -6, 0, 6.
        points = [point(0, -7), point(6, -4), point(5, 4), point(0, 8),
                  point(-5, 4), point(-6, -4), point(0, -7)]
        draw.line(points, fill=rgba, width=stroke, joint="curve")
        for offset in (-6, 0, 6):
            draw.line([point(offset, -5), point(offset, -9)], fill=rgba, width=stroke)
    elif status == "AG":
        # Pixi: two 4.5-radius circles centered four units apart, then the
        # crossing two-unit guard strokes.
        radius = 4.5 * unit
        for offset in (-4, 4):
            x, y = point(offset, 0)
            draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                         outline=rgba, width=stroke)
        draw.line([point(-1, -3), point(1, 3)], fill=rgba, width=stroke)
        draw.line([point(-1, 3), point(1, -3)], fill=rgba, width=stroke)
    else:
        fail(f"unsupported status symbol: {status}")

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def render_procedural(spec: dict[str, Any], name: str, canvas_size: int) -> Image.Image:
    if spec.get("procedural") != "status_symbol":
        fail(f"{name}: unsupported procedural renderer")
    return draw_status_symbol(
        spec["status"], canvas_size, spec["color"], int(spec["symbol_scale"]),
    )


def render_single(spec: dict[str, Any], name: str, canvas_size: int) -> Image.Image:
    image = prepare_art_layer(spec, name)
    padding = int(spec["padding"])
    if not 0 <= padding < canvas_size / 2:
        fail(f"{name}: padding must leave room on the canvas")
    image = resize_preserving_aspect(image, canvas_size - padding * 2)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((canvas_size - image.width) // 2,
                                   (canvas_size - image.height) // 2))
    return canvas


def render_composite(spec: dict[str, Any], name: str, canvas_size: int) -> Image.Image:
    if spec.get("composite") != "alpha_over_center":
        fail(f"{name}: unsupported composite instruction")
    layers = spec.get("layers")
    if not isinstance(layers, list) or not layers:
        fail(f"{name}: composite layers are required")
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    for layer_index, layer in enumerate(layers):
        layer_name = f"{name}.layers[{layer_index}]"
        image = prepare_art_layer(layer, layer_name)
        target_extent = int(layer.get("target_extent", canvas_size - int(spec["padding"]) * 2))
        image = resize_preserving_aspect(image, target_extent)
        position = ((canvas_size - image.width) // 2, (canvas_size - image.height) // 2)
        canvas.alpha_composite(image, position)
    return canvas


def validate_manifest(manifest: dict[str, Any]) -> None:
    canvas_size = manifest.get("canvas_size")
    if not isinstance(canvas_size, int) or canvas_size <= 0:
        fail("canvas_size must be a positive integer")
    icons = manifest.get("icons")
    if not isinstance(icons, dict) or not icons:
        fail("icons must be a non-empty object")
    for name, spec in icons.items():
        if not isinstance(spec, dict):
            fail(f"{name}: spec must be an object")
        if not isinstance(spec.get("output"), str) or Path(spec["output"]).name != spec["output"]:
            fail(f"{name}: output must be a filename")
        if not isinstance(spec.get("padding"), int):
            fail(f"{name}: padding must be explicitly encoded")
        if spec.get("procedural"):
            source = spec.get("source", "")
            if "#" not in source:
                fail(f"{name}: procedural source must link to its implementation")
        elif "layers" not in spec and not isinstance(spec.get("source"), str):
            fail(f"{name}: source path is required")


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    validate_manifest(manifest)
    canvas_size = int(manifest["canvas_size"])
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    for name, spec in manifest["icons"].items():
        if spec.get("procedural"):
            icon = render_procedural(spec, name, canvas_size)
        elif "layers" in spec:
            icon = render_composite(spec, name, canvas_size)
        else:
            icon = render_single(spec, name, canvas_size)
        output = OUTPUT_ROOT / spec["output"]
        icon.save(output, format="WEBP", quality=90, method=6)
        print(f"{name}: {output.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"ability icon generation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
