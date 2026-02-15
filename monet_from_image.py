#!/usr/bin/env python3
from __future__ import annotations

import argparse
from typing import Dict, List, Tuple

from materialyoucolor.quantize import ImageQuantizeCelebi
from materialyoucolor.score.score import Score

# 这个在 2.x 基本都在
from materialyoucolor.scheme.scheme_android import SchemeAndroid


def argb_to_hex(argb: int) -> str:
    # argb: 0xAARRGGBB
    return f"#{argb:08X}"


def rgba_list_to_hex(rgba: List[int]) -> str:
    # rgba: [r,g,b,a]
    r, g, b, a = rgba
    return f"#{r:02X}{g:02X}{b:02X}{a:02X}"


def pick_source_argb_from_image(image_path: str, quality: int = 5, max_colors: int = 128) -> int:
    """
    1) Celebi 量化：{ARGB_int: population}
    2) Score 评分：返回最适合做主题的颜色列表（ARGB_int）
    3) 取第一个作为 seed/source
    """
    result = ImageQuantizeCelebi(image_path, quality, max_colors)
    ranked = Score.score(result)
    if not ranked:
        raise RuntimeError("No colors scored from image.")
    return ranked[0]


def try_dynamiccolor_print(source_argb: int, dark: bool, contrast: float, spec: str) -> bool:
    """
    尝试使用 dynamiccolor（有些 wheel/版本会带）。
    成功返回 True；如果模块不存在则返回 False。
    """
    try:
        from materialyoucolor.hct import Hct
        from materialyoucolor.dynamiccolor.color_spec import COLOR_NAMES
        from materialyoucolor.dynamiccolor.material_dynamic_colors import MaterialDynamicColors
        from materialyoucolor.scheme.scheme_tonal_spot import SchemeTonalSpot
    except ModuleNotFoundError:
        return False

    scheme = SchemeTonalSpot(
        Hct.from_int(source_argb),
        dark,
        contrast,
        spec_version=spec,
    )
    mdc = MaterialDynamicColors(spec=spec)

    print("\n===", "DARK" if dark else "LIGHT", "(dynamiccolor)", "===")
    for name in COLOR_NAMES:
        dc = getattr(mdc, name)
        print(f"{name:28s} {dc.get_hex(scheme)}")
    return True


def print_scheme_android(source_argb: int) -> None:
    """
    使用 SchemeAndroid 输出一整套（很像安卓端的那套 keys）。
    props 是 dict: key -> [r,g,b,a]
    """
    light = SchemeAndroid.light(source_argb).props
    dark = SchemeAndroid.dark(source_argb).props

    def dump(title: str, props: Dict[str, List[int]]):
        print("\n===", title, "(SchemeAndroid)", "===")
        # 为了稳定输出顺序：按 key 排序
        for k in sorted(props.keys()):
            print(f"{k:28s} {rgba_list_to_hex(props[k])}")

    dump("LIGHT", light)
    dump("DARK", dark)


def main():
    ap = argparse.ArgumentParser(description="Material You palette from image (Monet-style).")
    ap.add_argument("image", help="seed image path (png/jpg/webp...)")
    ap.add_argument("--quality", type=int, default=5, help="pixel subsampling factor (1=best/slowest)")
    ap.add_argument("--max-colors", type=int, default=128, help="max colors for quantizer (default 128)")
    ap.add_argument("--spec", default="2025", help="spec version (used only if dynamiccolor available)")
    ap.add_argument("--contrast", type=float, default=0.0, help="contrast level (used only if dynamiccolor available)")
    args = ap.parse_args()

    source = pick_source_argb_from_image(args.image, quality=args.quality, max_colors=args.max_colors)
    print("sourceColor:", argb_to_hex(source))

    # 先尝试 dynamiccolor（如果你的 wheel 恰好带了，就输出超全套）
    ok_light = try_dynamiccolor_print(source, dark=False, contrast=args.contrast, spec=args.spec)
    ok_dark = try_dynamiccolor_print(source, dark=True, contrast=args.contrast, spec=args.spec)

    # 如果 dynamiccolor 不存在（你现在的情况），就用 SchemeAndroid 输出整套
    if not (ok_light and ok_dark):
        print_scheme_android(source)


if __name__ == "__main__":
    main()
