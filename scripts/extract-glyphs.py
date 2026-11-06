#!/usr/bin/env python3
"""从 Ma Shan Zheng 字体提取「无」「锋」轮廓，供图标脚本使用。"""
from __future__ import annotations

import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "assets-src" / "fonts" / "MaShanZheng-Regular.ttf"
OUT = ROOT / "assets-src" / "glyphs.json"


def main() -> None:
    font = TTFont(FONT)
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    result = {"unitsPerEm": upem, "glyphs": {}}

    for char in ("无", "锋", "抹", "了", "未"):
        glyph_name = cmap.get(ord(char))
        if not glyph_name:
            raise SystemExit(f"字体缺少字形：{char}")
        pen = SVGPathPen(glyphset)
        glyphset[glyph_name].draw(pen)
        bounds_pen = BoundsPen(glyphset)
        glyphset[glyph_name].draw(bounds_pen)
        result["glyphs"][char] = {
            "path": pen.getCommands(),
            "bounds": list(bounds_pen.bounds) if bounds_pen.bounds else [0, 0, upem, upem],
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"字形已写入 {OUT}")


if __name__ == "__main__":
    main()
