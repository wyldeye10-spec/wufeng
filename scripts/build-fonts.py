#!/usr/bin/env python3
"""
构建无锋的自托管字体子集（可复现，但生成物已提交，正常运行/构建无需 Python）。

- 正文字体：Noto Serif SC Variable（SIL OFL 1.1）→ 覆盖 GB2312 + 界面字符 + 常用标点
- 楷体：LXGW WenKai GB（SIL OFL 1.1）→ 覆盖 GB2312 + 界面字符 + 常用标点
- 展示字体：Ma Shan Zheng（SIL OFL 1.1）→ 只保留界面用字，控制体积

用法：
  python scripts/build-fonts.py --serif-source "C:/Windows/Fonts/NotoSerifSC-VF.ttf" \
      --display-source assets-src/fonts/MaShanZheng-Regular.ttf \
      --kai-source assets-src/fonts/LXGWWenKaiGB-Regular.ttf
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = SRC / "assets" / "fonts"
WORK = ROOT / "assets-src" / "chars"

UI_EXTRA = (
    "，。、；：？！“”‘’（）《》〈〉「」『』【】〔〕…—·×＋"
    "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "　·→←↑↓•※￥°"
)


def collect_ui_text() -> str:
    parts: list[str] = []
    for pattern in ("**/*.tsx", "**/*.ts", "**/*.css"):
        for file in SRC.glob(pattern):
            parts.append(file.read_text(encoding="utf-8"))
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    parts.append(html)
    manifest = ROOT / "public" / "manifest.webmanifest"
    if manifest.exists():
        parts.append(manifest.read_text(encoding="utf-8"))
    return "\n".join(parts)


def gb2312_chars() -> str:
    chars: list[str] = []
    for high in range(0xA1, 0xF8):
        for low in range(0xA1, 0xFF):
            try:
                chars.append(bytes((high, low)).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return "".join(chars)


def unique(text: str) -> str:
    seen: set[str] = set()
    output: list[str] = []
    for char in text:
        if char in seen or char in "\r\n\t":
            continue
        seen.add(char)
        output.append(char)
    return "".join(output)


def run_subset(source: Path, chars: str, target: Path, extra_args: list[str]) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    text_file = WORK / f"{target.stem}.txt"
    text_file.write_text(chars, encoding="utf-8")
    cmd = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(source),
        f"--text-file={text_file}",
        f"--output-file={target}",
        "--flavor=woff2",
        "--layout-features=kern,liga,clig,calt,locl,palt,vert,vrt2",
        "--name-IDs=1,2,3,4,5,6",
        "--no-hinting",
        "--desubroutinize",
        *extra_args,
    ]
    subprocess.run(cmd, check=True)
    print(f"{target.name}: {target.stat().st_size / 1024:.1f} KiB")


def pin_serif_weight(source: Path, weight: int) -> Path:
    """把可变字体固定成一个静态字重，绕过 fontTools 对 gvar 子集化的已知缺陷。"""
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    font = TTFont(source)
    if "fvar" not in font:
        return source
    target = ROOT / "assets-src" / "fonts" / f"NotoSerifSC-{weight}.ttf"
    if target.exists():
        return target
    instantiateVariableFont(font, {"wght": weight}, inplace=True)
    font.save(target)
    print(f"已固定正文字重：{weight} → {target.name}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--serif-source",
        default=r"C:\Windows\Fonts\NotoSerifSC-VF.ttf",
        help="Noto Serif SC Variable TTF",
    )
    parser.add_argument(
        "--display-source",
        default=str(ROOT / "assets-src" / "fonts" / "MaShanZheng-Regular.ttf"),
        help="Ma Shan Zheng Regular TTF",
    )
    parser.add_argument(
        "--kai-source",
        default=str(ROOT / "assets-src" / "fonts" / "LXGWWenKaiGB-Regular.ttf"),
        help="LXGW WenKai GB Regular TTF",
    )
    args = parser.parse_args()

    serif_source = Path(args.serif_source)
    display_source = Path(args.display_source)
    kai_source = Path(args.kai_source)
    if not serif_source.exists():
        raise SystemExit(f"缺少正文源字体：{serif_source}")
    if not display_source.exists():
        raise SystemExit(f"缺少展示源字体：{display_source}")
    if not kai_source.exists():
        raise SystemExit(f"缺少楷体源字体：{kai_source}")

    ui = collect_ui_text()
    ui_chars = unique(ui + UI_EXTRA)
    serif_chars = unique(gb2312_chars() + ui_chars)
    print(f"界面字符 {len(ui_chars)} 个，正文字符 {len(serif_chars)} 个")

    OUT.mkdir(parents=True, exist_ok=True)
    serif_regular = pin_serif_weight(serif_source, 430)
    serif_bold = pin_serif_weight(serif_source, 650)
    run_subset(
        serif_regular,
        serif_chars,
        OUT / "wufeng-serif.woff2",
        [],
    )
    run_subset(
        serif_bold,
        serif_chars,
        OUT / "wufeng-serif-bold.woff2",
        [],
    )
    run_subset(
        display_source,
        ui_chars,
        OUT / "wufeng-display.woff2",
        [],
    )
    run_subset(
        kai_source,
        serif_chars,
        OUT / "wufeng-kai.woff2",
        [],
    )

    from fontTools.ttLib import TTFont

    for name in (
        "wufeng-serif.woff2",
        "wufeng-serif-bold.woff2",
        "wufeng-display.woff2",
        "wufeng-kai.woff2",
    ):
        font = TTFont(OUT / name)
        cmap = font.getBestCmap()
        missing = [char for char in ui_chars if ord(char) not in cmap]
        print(
            f"{name}: glyphs={font['maxp'].numGlyphs}, weight={font['OS/2'].usWeightClass}, "
            f"axes={[a.axisTag for a in font['fvar'].axes] if 'fvar' in font else 'static'}, "
            f"missing_ui={len(missing)}"
        )


if __name__ == "__main__":
    main()
