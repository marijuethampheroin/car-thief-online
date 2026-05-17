#!/usr/bin/env python3
"""
Batch BMP to PNG Converter
Usage: python bmp_to_png.py [input_dir] [output_dir]
  - input_dir:  folder containing .bmp files (default: current directory)
  - output_dir: folder to save .png files (default: input_dir/png_output)
"""

import sys
import argparse
from pathlib import Path
from PIL import Image


def convert_bmp_to_png(input_dir: Path, output_dir: Path) -> None:
    bmp_files = list(input_dir.glob("*.bmp")) + list(input_dir.glob("*.BMP"))

    if not bmp_files:
        print(f"No BMP files found in: {input_dir}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Found {len(bmp_files)} BMP file(s). Converting to: {output_dir}\n")

    success, failed = 0, []

    for bmp_path in sorted(bmp_files):
        png_path = output_dir / (bmp_path.stem + ".png")
        try:
            with Image.open(bmp_path) as img:
                img.save(png_path, "PNG")
            print(f"  ✓  {bmp_path.name}  →  {png_path.name}")
            success += 1
        except Exception as e:
            print(f"  ✗  {bmp_path.name}  —  {e}")
            failed.append(bmp_path.name)

    print(f"\nDone: {success} converted", end="")
    if failed:
        print(f", {len(failed)} failed: {', '.join(failed)}", end="")
    print()


def main():
    parser = argparse.ArgumentParser(description="Batch convert BMP files to PNG.")
    parser.add_argument("input_dir", nargs="?", default=".",
                        help="Directory containing BMP files (default: current directory)")
    parser.add_argument("output_dir", nargs="?", default=None,
                        help="Directory to save PNG files (default: <input_dir>/png_output)")
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    if not input_dir.is_dir():
        print(f"Error: '{input_dir}' is not a valid directory.")
        sys.exit(1)

    output_dir = Path(args.output_dir).resolve() if args.output_dir else input_dir / "png_output"
    convert_bmp_to_png(input_dir, output_dir)


if __name__ == "__main__":
    main()