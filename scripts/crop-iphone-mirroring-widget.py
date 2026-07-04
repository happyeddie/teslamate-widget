from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def active_pixel(pixel: tuple[int, int, int]) -> bool:
    return max(pixel) > 24


def group_runs(values: list[int]) -> list[tuple[int, int]]:
    groups: list[list[int]] = []
    for value in values:
        if not groups or value > groups[-1][1] + 1:
            groups.append([value, value])
        else:
            groups[-1][1] = value
    return [(start, end) for start, end in groups]


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0


def score_teslamate_widget(image: Image.Image, box: tuple[int, int, int, int]) -> dict:
    crop = image.crop(box).convert("RGB")
    width, height = crop.size
    pixels = crop.load()
    left_luma: list[float] = []
    right_luma: list[float] = []
    right_bright = 0
    green = 0
    total = width * height

    for y in range(height):
        for x in range(width):
            red, green_value, blue = pixels[x, y]
            luma = (red + green_value + blue) / 3
            if x < width // 2:
                left_luma.append(luma)
            else:
                right_luma.append(luma)
                if luma > 110:
                    right_bright += 1
            if green_value > red + 20 and green_value > blue + 20 and green_value > 80:
                green += 1

    return {
        "leftMean": mean(left_luma),
        "rightMean": mean(right_luma),
        "rightBrightRatio": right_bright / len(right_luma) if right_luma else 0,
        "greenRatio": green / total if total else 0,
    }


def find_widget_boxes(image: Image.Image) -> list[dict]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    x_min = int(width * 0.08)
    x_max = int(width * 0.92)
    row_threshold = int((x_max - x_min) * 0.55)

    active_rows: list[int] = []
    for y in range(height):
        count = 0
        for x in range(x_min, x_max):
            if active_pixel(pixels[x, y]):
                count += 1
        if count >= row_threshold:
            active_rows.append(y)

    boxes: list[dict] = []
    min_card_height = int(height * 0.10)
    max_card_height = int(height * 0.23)
    min_card_width = int(width * 0.55)

    for y1, y2 in group_runs(active_rows):
        card_height = y2 - y1 + 1
        if card_height < min_card_height or card_height > max_card_height:
            continue

        active_columns: list[int] = []
        column_threshold = int(card_height * 0.45)
        for x in range(width):
            count = 0
            for y in range(y1, y2 + 1):
                if active_pixel(pixels[x, y]):
                    count += 1
            if count >= column_threshold:
                active_columns.append(x)

        column_groups = group_runs(active_columns)
        wide_groups = [
            (x1, x2)
            for x1, x2 in column_groups
            if x2 - x1 + 1 >= min_card_width
        ]
        if not wide_groups:
            continue

        x1, x2 = max(wide_groups, key=lambda item: item[1] - item[0])
        box = (x1, y1, x2 + 1, y2 + 1)
        features = score_teslamate_widget(rgb, box)
        if features["rightBrightRatio"] < 0.35 or features["rightMean"] < 90:
            continue

        boxes.append({
            "box": box,
            "features": features,
        })

    boxes.sort(key=lambda item: (item["box"][1], item["box"][0]))
    return boxes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--prefix", default="iphone-widget")
    parser.add_argument("--index", type=int, default=0, help="1-based widget index; 0 means all")
    args = parser.parse_args()

    image = Image.open(args.input)
    boxes = find_widget_boxes(image)
    if args.index:
        if args.index < 1 or args.index > len(boxes):
            raise SystemExit(f"widget index out of range: {args.index}, detected {len(boxes)}")
        boxes = [boxes[args.index - 1]]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    captures = []
    for idx, item in enumerate(boxes, start=1):
        box = tuple(item["box"])
        output = args.output_dir / f"{args.prefix}-{idx:02d}.png"
        image.crop(box).save(output)
        captures.append({
            "index": idx,
            "box": {
                "x": box[0],
                "y": box[1],
                "width": box[2] - box[0],
                "height": box[3] - box[1],
            },
            "features": item["features"],
            "outputPath": str(output),
            "bytes": output.stat().st_size,
        })

    print(json.dumps({
        "inputPath": str(args.input),
        "captures": captures,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
