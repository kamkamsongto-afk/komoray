"""Komoray render worker on Modal.

Takes a raw video + its edit.json, then with FFmpeg:
cuts out the silences, reframes to vertical 1080x1920, burns in subtitles.

Also makes the editor's preview copy (proxy.mp4) of every upload: see `proxy` below.

Modal never holds R2 keys: the website hands it short-lived signed URLs to read the
source video and to write the result (or an error report) back.

Deploy:  python -m modal deploy modal_app/render.py
"""

import hmac
import json
import math
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import modal

# The test site's own copy: KOMORAY_RENDER_APP=komoray-render-staging python -m modal deploy modal_app/render.py
# (its address then has -staging in it, which RENDER_URL in wrangler.jsonc's staging part points at).
app = modal.App(os.environ.get("KOMORAY_RENDER_APP", "komoray-render"))

GOOGLE_FONTS = "https://github.com/google/fonts/raw/main/ofl"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fontconfig", "curl", "fonts-dejavu-core", "fonts-thai-tlwg")
    .run_commands(
        "mkdir -p /usr/share/fonts/truetype/google",
        *[
            f"curl -fsSL -o /usr/share/fonts/truetype/google/{name} {GOOGLE_FONTS}/{family}/{name}"
            for family, name in [
                ("kanit", "Kanit-Regular.ttf"),
                ("kanit", "Kanit-Medium.ttf"),
                ("kanit", "Kanit-SemiBold.ttf"),
                ("kanit", "Kanit-Bold.ttf"),
                ("prompt", "Prompt-Medium.ttf"),
                ("mitr", "Mitr-Medium.ttf"),
                ("sarabun", "Sarabun-SemiBold.ttf"),
                ("chakrapetch", "ChakraPetch-SemiBold.ttf"),
                ("poppins", "Poppins-SemiBold.ttf"),
                ("anton", "Anton-Regular.ttf"),
                ("bebasneue", "BebasNeue-Regular.ttf"),
                ("itim", "Itim-Regular.ttf"),
                ("sriracha", "Sriracha-Regular.ttf"),
                ("pattaya", "Pattaya-Regular.ttf"),
                ("chonburi", "Chonburi-Regular.ttf"),
                ("charm", "Charm-Bold.ttf"),
                ("mali", "Mali-SemiBold.ttf"),
                ("baijamjuree", "BaiJamjuree-SemiBold.ttf"),
                ("k2d", "K2D-SemiBold.ttf"),
                ("krub", "Krub-SemiBold.ttf"),
                ("kodchasan", "Kodchasan-SemiBold.ttf"),
                ("trirong", "Trirong-SemiBold.ttf"),
                ("maitree", "Maitree-SemiBold.ttf"),
                ("bangers", "Bangers-Regular.ttf"),
                ("pacifico", "Pacifico-Regular.ttf"),
                ("lobster", "Lobster-Regular.ttf"),
                ("abrilfatface", "AbrilFatface-Regular.ttf"),
                ("alfaslabone", "AlfaSlabOne-Regular.ttf"),
                ("righteous", "Righteous-Regular.ttf"),
                ("archivoblack", "ArchivoBlack-Regular.ttf"),
                ("titanone", "TitanOne-Regular.ttf"),
                ("firasans", "FiraSans-Medium.ttf"),
            ]
        ],
        "fc-cache -f",
        # The noise reduction model of polish_sound, a fixed version ("conjoined-burgers": fans, AC, computers).
        "mkdir -p /opt/rnnoise",
        "curl -fsSL -o /opt/rnnoise/cb.rnnn https://raw.githubusercontent.com/richardpl/arnndn-models/0fda24c46d78f0207d820bb970fbe85c1971b39c/cb.rnnn",
    )
    .pip_install("fastapi[standard]", "opencv-python-headless==4.10.0.84", "numpy<2.3", "uharfbuzz==0.51.1")
)

WIDTH, HEIGHT, FPS = 1080, 1920, 30
# How long a subtitle line may get, per look. Thai letters don't count marks above and below;
# thai_letters fits text size `size` (bigger letters: fewer per line, so a line never wraps).
# Same as LINE_LIMITS in src/lib/timeline.ts.
LINE_LIMITS = {
    "normal": {"words": 3, "seconds": 1.6, "thai_words": 6, "thai_letters": 16, "thai_seconds": 2.2, "size": 130},
    "big": {"words": 2, "seconds": 1.2, "thai_words": 4, "thai_letters": 10, "thai_seconds": 1.6, "size": 195},
    "two": {"words": 7, "seconds": 3.0, "thai_words": 12, "thai_letters": 30, "thai_seconds": 3.6, "size": 117},
}
THAI_PAUSE = 0.15  # a pause this long inside a Thai line gets a space
LINE_BREAK_GAP = 0.5  # a pause this long starts a new subtitle line

# The editor's fonts (FONTS in src/lib/subtitle-style.ts) by their name inside the font file.
FONTS = {
    "kanit": "Kanit Medium",
    "prompt": "Prompt Medium",
    "mitr": "Mitr Medium",
    "sarabun": "Sarabun SemiBold",
    "chakra": "Chakra Petch SemiBold",
    "poppins": "Poppins SemiBold",
    "anton": "Anton",
    "bebas": "Bebas Neue",
    "itim": "Itim",
    "sriracha": "Sriracha",
    "pattaya": "Pattaya",
    "chonburi": "Chonburi",
    "charm": "Charm",
    "mali": "Mali SemiBold",
    "baijam": "Bai Jamjuree SemiBold",
    "k2d": "K2D SemiBold",
    "krub": "Krub SemiBold",
    "kodchasan": "Kodchasan SemiBold",
    "trirong": "Trirong SemiBold",
    "maitree": "Maitree SemiBold",
    "bangers": "Bangers",
    "pacifico": "Pacifico",
    "lobster": "Lobster",
    "abril": "Abril Fatface",
    "alfaslab": "Alfa Slab One",
    "righteous": "Righteous",
    "archivo": "Archivo Black",
    "titan": "Titan One",
}
# None of FONTS has Russian-style letters: text with them uses this one, or libass picks a system font
# (too big, words nearly touching). Same as CYRILLIC_FONT in src/lib/subtitle-style.ts.
# libass makes a font's full height the font size: Kanit's is 1.58 ems, this one's 1.2, so this one is
# asked for smaller to draw letters as big as Kanit's.
CYRILLIC_FONT = "Fira Sans Medium"
CYRILLIC_SCALE = 1.2 / 1.58
BOX_PADDING = 20  # the Box look: space around the letters, px
# To measure text for rounded boxes: each font's file, and its full height in ems (FONTS in subtitle-style.ts).
FONT_FOLDER = "/usr/share/fonts/truetype/google/"
FONT_FILES = {
    "kanit": ("Kanit-Medium.ttf", 1.58),
    "prompt": ("Prompt-Medium.ttf", 1.512),
    "mitr": ("Mitr-Medium.ttf", 1.57),
    "sarabun": ("Sarabun-SemiBold.ttf", 1.853),
    "chakra": ("ChakraPetch-SemiBold.ttf", 1.814),
    "poppins": ("Poppins-SemiBold.ttf", 1.762),
    "anton": ("Anton-Regular.ttf", 1.733),
    "bebas": ("BebasNeue-Regular.ttf", 1.3),
    "itim": ("Itim-Regular.ttf", 1.2),
    "sriracha": ("Sriracha-Regular.ttf", 1.77),
    "pattaya": ("Pattaya-Regular.ttf", 1.388),
    "chonburi": ("Chonburi-Regular.ttf", 1.2),
    "charm": ("Charm-Bold.ttf", 2.353),
    "mali": ("Mali-SemiBold.ttf", 2.122),
    "baijam": ("BaiJamjuree-SemiBold.ttf", 1.786),
    "k2d": ("K2D-SemiBold.ttf", 1.916),
    "krub": ("Krub-SemiBold.ttf", 1.739),
    "kodchasan": ("Kodchasan-SemiBold.ttf", 1.788),
    "trirong": ("Trirong-SemiBold.ttf", 1.734),
    "maitree": ("Maitree-SemiBold.ttf", 1.65),
    "bangers": ("Bangers-Regular.ttf", 1.757),
    "pacifico": ("Pacifico-Regular.ttf", 1.935),
    "lobster": ("Lobster-Regular.ttf", 1.49),
    "abril": ("AbrilFatface-Regular.ttf", 1.349),
    "alfaslab": ("AlfaSlabOne-Regular.ttf", 1.565),
    "righteous": ("Righteous-Regular.ttf", 1.242),
    "archivo": ("ArchivoBlack-Regular.ttf", 1.347),
    "titan": ("TitanOne-Regular.ttf", 1.145),
}
LOGO = {"size": 52, "outline": 4, "side": 40, "top": 40}  # the channel name or logo in a corner (LOGO in PlayerFrame.tsx)


# Banners (src/lib/banners.ts): sizes in px, fade in seconds, top of each place.
BANNER = {"size": 72, "sub_size": 44, "padding": 28, "fade": 0.25}
BANNER_SCALE = (0.5, 5)  # smallest and biggest size (BANNER_SCALE in banners.ts)
BANNER_MAX_LINES = 3  # lines of a banner's text (BANNER.maxLines in banners.ts)
BANNER_LINE_GAP = (-60, 80)  # extra px between its rows, at normal size (BANNER_LINE_GAP in banners.ts)
# An uploaded banner (BANNER_FILE in banners.ts): its width at size 100%, share of the video's; where it starts.
BANNER_FILE = {"width": 0.5, "x": 0.5, "y": 0.3}
# How a banner arrives (BANNER_ANIMS in banners.ts): size keyframes (ms, %), fades in, starts this far off (px).
BANNER_ANIMS = {
    "fade": {"fade_in": True},
    "pop": {"fade_in": False, "keys": [(0, 60), (140, 112), (260, 100)]},
    "bounce": {"fade_in": False, "keys": [(0, 30), (180, 118), (300, 92), (420, 104), (520, 100)]},
    "slideUp": {"fade_in": True, "slide": (0, 160)},
    "slideSide": {"fade_in": True, "slide": (-300, 0)},
    "pulse": {"fade_in": True},
}
SLIDE_MS = 320
PULSE_MS = 450
# Where each banner place starts, share of the video's height, per shape (BANNER_TOP in banners.ts).
BANNER_TOP = {
    "9:16": {"top": 0.135, "middle": 0.448, "bottom": 0.78},
    "1:1": {"top": 0.08, "middle": 0.35, "bottom": 0.55},
    "16:9": {"top": 0.08, "middle": 0.35, "bottom": 0.62},
}
# The final video's shape (FORMATS in src/lib/subtitle-style.ts): width, height.
FORMATS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


def banner_ink(hex_colour: str) -> str:
    """Dark letters on a light brand colour, white on a dark one. Same as bannerInk in banners.ts."""
    n = int(hex_colour.lstrip("#"), 16) if re.fullmatch(r"#[0-9a-fA-F]{6}", hex_colour or "") else 0xFFE600
    r, g, b = (n >> 16) & 255, (n >> 8) & 255, n & 255
    return "#111111" if 0.299 * r + 0.587 * g + 0.114 * b > 160 else "#FFFFFF"


def font_tag(text: str, own_font: bool, size: float) -> str:
    """The ASS tags for text with Russian-style letters at this size (the user's own font is left alone:
    they picked it)."""
    return f"\\fn{CYRILLIC_FONT}\\fs{size * CYRILLIC_SCALE:.1f}" if not own_font and re.search("[Ѐ-ԯ]", text) else ""


_shapers: dict = {}


def text_width(text: str, style: dict, size: float, spacing: int = 0, cyrillic: bool = False) -> float:
    """How wide libass draws this text, px, to draw a box around it: libass makes a font's full height the
    font size, and Thai needs real shaping to know its width. cyrillic: part of a line drawn in the Russian
    font (font_tag picks one font for a whole line)."""
    import uharfbuzz as hb

    if style.get("font") == "own" and style.get("_ownFontPath"):
        path, height = style["_ownFontPath"], float((style.get("ownFont") or {}).get("height") or 1.58)
    elif style.get("font") != "own" and (cyrillic or re.search("[Ѐ-ԯ]", text)):
        path, height = FONT_FOLDER + "FiraSans-Medium.ttf", 1.58  # asked for smaller, drawn as big as Kanit's (CYRILLIC_SCALE)
    else:
        name, height = FONT_FILES.get(style.get("font"), FONT_FILES["kanit"])
        path = FONT_FOLDER + name
    if path not in _shapers:
        face = hb.Face(hb.Blob.from_file_path(path))
        _shapers[path] = (hb.Font(face), face.upem)
    font, upem = _shapers[path]
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer)
    advance = sum(p.x_advance for p in buffer.glyph_positions)
    clusters = len({g.cluster for g in buffer.glyph_infos})
    return advance / upem * size / height + spacing * clusters


def rounded_box(w: float, h: float, radius: float) -> str:
    """A box with round corners, as an ASS drawing starting at its top left."""
    w, h = round(w), round(h)
    r = round(min(radius, w / 2, h / 2))
    k = round(r * 0.45)
    return (
        f"m {r} 0 l {w - r} 0 b {w - k} 0 {w} {k} {w} {r} l {w} {h - r} b {w} {h - k} {w - k} {h} {w - r} {h} "
        f"l {r} {h} b {k} {h} 0 {h - k} 0 {h - r} l 0 {r} b 0 {k} {k} 0 {r} 0"
    )


def alpha_of(opacity: float) -> str:
    """How solid (0..1) as an ASS alpha, where 00 is solid."""
    return f"&H{round((1 - min(1.0, max(0.0, opacity))) * 255):02X}&"


def banner_motion(anim: str, x: float, y: float, seconds: float, factor: float) -> str:
    """The tags that make a banner's part arrive at (x, y). factor: its size, 1 = normal."""
    spec = BANNER_ANIMS.get(anim, BANNER_ANIMS["fade"])
    fade = int(BANNER["fade"] * 1000)
    slide = spec.get("slide")
    tags = f"\\move({x + slide[0]:.0f},{y + slide[1]:.0f},{x:.0f},{y:.0f},0,{SLIDE_MS})" if slide else f"\\pos({x:.0f},{y:.0f})"
    ms = int(seconds * 1000)
    if spec["fade_in"] and ms < 2 * fade:
        # Shorter than both fades: the preview takes the smaller of the two (bannerMotion), so it is most solid
        # halfway, at seconds/2/fade. \fad would finish the fade in first, then jump down to the fade out.
        top = round((1 - ms / 2 / fade) * 255)
        tags += f"\\fade(255,{top},255,0,{ms // 2},{ms // 2},{ms})"
    else:
        tags += f"\\fad({fade if spec['fade_in'] else 0},{fade})"
    keys = spec.get("keys")
    if anim == "pulse":
        keys, at = [(0, 100)], 0
        while at < seconds * 1000:
            keys += [(at + PULSE_MS // 2, 108), (at + PULSE_MS, 100)]
            at += PULSE_MS
    if keys:
        return tags + scale_tags([(t, round(s * factor, 1)) for t, s in keys], 0)
    return tags + (f"\\fscx{factor * 100:g}\\fscy{factor * 100:g}" if factor != 1 else "")


def banner_pose(b: dict, t: float) -> tuple[float, float, float, float]:
    """Where the animation has a banner at final-video second t: opacity, size (1 = its size), x and y off in px.
    Same as bannerMotion in banners.ts."""
    start, end = float(b.get("start", 0)), float(b.get("end", 0))
    if t < start or t >= end:
        return 0.0, 1.0, 0.0, 0.0
    anim = b.get("anim") or "fade"
    spec = BANNER_ANIMS.get(anim, BANNER_ANIMS["fade"])
    ms = (t - start) * 1000
    fade_in = (t - start) / BANNER["fade"] if spec["fade_in"] else 1.0
    left = max(0.0, 1 - ms / SLIDE_MS)
    swing = (ms % PULSE_MS) / (PULSE_MS / 2)
    keys = spec.get("keys")
    scale = scale_at(keys, ms) / 100 if keys else (1 + 0.08 * (swing if swing <= 1 else 2 - swing) if anim == "pulse" else 1.0)
    slide = spec.get("slide") or (0, 0)
    return min(1.0, fade_in, (end - t) / BANNER["fade"]), scale, slide[0] * left, slide[1] * left


def banner_frames(b, rows, looks, box, fill_colour, ink, centre, box_middle, middles, size, fill_opacity, layer=2) -> list[str]:
    """A banner of several rows that grows as it arrives (Pop, Bounce, Pulse), frame by frame: the box and every row
    grow around the box's middle, as in the preview. Once it stops growing (Pop, Bounce), one plain event each.
    layer: its box's ASS layer, its letters one above (banner_events)."""
    start, end = float(b.get("start", 0)), float(b.get("end", 0))
    anim = b.get("anim") or "fade"
    keys = BANNER_ANIMS.get(anim, {}).get("keys")
    # Frames until it settles (Pulse never does), but at least up to where the fade out begins.
    settle = start + keys[-1][0] / 1000 if keys else end
    if settle >= end - BANNER["fade"]:
        settle = end
    colour = fill_colour.split("\\1a")[0]
    events = []
    first, last = math.ceil(start * FPS), math.ceil(settle * FPS)
    for f in range(first, last):
        opacity, scale, dx, dy = banner_pose(b, f / FPS)
        if opacity <= 0.004:
            continue
        when = f"{ass_time(f / FPS)},{ass_time((f + 1) / FPS)}"
        if not b.get("noBox"):
            events.append(f"Dialogue: {layer},{when},Banner,,0,0,0,,{{\\an5\\bord0\\shad0{colour}\\1a{alpha_of(fill_opacity * opacity)}\\pos({centre + dx:.1f},{box_middle + dy:.1f})\\fscx{scale * 100:.2f}\\fscy{scale * 100:.2f}\\p1}}{box}{{\\p0}}")
        for (row_text, _), middle, look in zip(rows, middles, looks):
            y = box_middle + (middle - box_middle) * scale + dy
            grow = size * scale * 100
            events.append(f"Dialogue: {layer + 1},{when},Banner,,0,0,0,,{{\\an5\\bord0\\shad0\\1c{ink}\\alpha{alpha_of(opacity)}{look}\\pos({centre + dx:.1f},{y:.1f})\\fscx{grow:.2f}\\fscy{grow:.2f}}}{row_text}")
    if last / FPS < end:
        # Settled: still until the end, then the fade out, as banner_motion does it.
        rest = f"{ass_time(last / FPS)},{ass_time(end)}"
        fade = int(BANNER["fade"] * 1000)
        if not b.get("noBox"):
            events.append(f"Dialogue: {layer},{rest},Banner,,0,0,0,,{{\\an5\\bord0\\shad0{fill_colour}\\pos({centre:.0f},{box_middle:.0f})\\fad(0,{fade})\\p1}}{box}{{\\p0}}")
        for (row_text, _), middle, look in zip(rows, middles, looks):
            events.append(f"Dialogue: {layer + 1},{rest},Banner,,0,0,0,,{{\\an5\\bord0\\shad0\\1c{ink}{look}\\pos({centre:.0f},{middle:.0f})\\fad(0,{fade})\\fscx{size * 100:g}\\fscy{size * 100:g}}}{row_text}")
    return events


def banner_events(banners: list[dict], height: int = HEIGHT, shape: str = "9:16", own_font: bool = False, style: dict | None = None) -> list[str]:
    """Each banner's rows, as a box and its letters: in its place, or with its middle where it was dragged
    (x, y: share of the width / height), at its size (scale), arriving as picked (anim). Everything was
    checked by the app (readBanners). Rows: each line of its text, then the small line, lineGap px apart
    (bannerRows in banners.ts). font: one of FONTS or "own"; without it, the subtitles' font.
    An uploaded banner (kind "file") is a picture put on by FFmpeg instead (banner_file_filters)."""
    style = style or {}
    brand = style.get("color", "#FFE600")
    events = []
    width = FORMATS.get(shape, (WIDTH, HEIGHT))[0]
    # Each banner its own pair of ASS layers, the later in the list on top (Bring forward / Send backward,
    # lib/layers.ts): with one layer for every box and one for every row of letters, an overlapping banner's
    # letters showed through the box over them, which the preview never does (12 Nov). From 3: over the logo (1) and
    # every subtitle, a bouncing word included (up to 2 with a box, bounce_events; Codex review 12 Nov).
    layer = 3
    for b in banners:
        start, end = float(b.get("start", 0)), float(b.get("end", 0))
        lines = [ass_text(line).strip() for line in str(b.get("text", "")).split("\n")]
        lines = [line for line in lines if line][:BANNER_MAX_LINES]
        if end <= start or not lines or b.get("kind") == "file":
            continue
        # Its own font: measured and named per banner. "own" without the file here falls back to Kanit, as the
        # preview does when the font can't load (its family list ends in Kanit).
        picked, row_style, row_own, name = b.get("font"), style, own_font, ""
        if picked == "own" and style.get("_ownFontPath") and style.get("ownFamily"):
            row_style, row_own, name = {**style, "font": "own", "ownFont": b.get("ownFont") or style.get("ownFont")}, True, str(style["ownFamily"])
        elif picked == "own" or picked in FONTS:
            key = picked if picked in FONTS else "kanit"
            row_style, row_own, name = {**style, "font": key}, False, FONTS[key]
        size = min(BANNER_SCALE[1], max(BANNER_SCALE[0], float(b.get("scale") or 1)))
        pad_x, pad_y = BANNER["padding"] * size, BANNER["padding"] / 2 * size
        sub = ass_text(str(b.get("sub", ""))).strip()
        background = b.get("color") or brand
        ink = ass_colour(b.get("ink") or banner_ink(background))
        fill = f"\\1c{ass_colour(background)}\\1a{alpha_of(float(b.get('opacity') or 1))}"
        radius = float(b.get("radius") or 0) * size
        rows = [(line, BANNER["size"]) for line in lines] + ([(sub, BANNER["sub_size"])] if sub else [])
        # One box around all the rows (coach, 11 Nov: two lines were two boxes), as the preview draws it (PlayerFrame):
        # rows row-size tall, lineGap apart, inside the padding; never shorter than its tallest row.
        heights = [row_size * size for _, row_size in rows]
        gap = min(BANNER_LINE_GAP[1], max(BANNER_LINE_GAP[0], float(b.get("lineGap") or 0))) * size
        inside = max(sum(heights) + gap * (len(rows) - 1), max(heights))
        tall = inside + 2 * pad_y
        places = BANNER_TOP.get(shape, BANNER_TOP["9:16"])
        x, y = b.get("x"), b.get("y")
        if x is not None and y is not None:
            centre, top = float(x) * width, float(y) * height - tall / 2
        else:
            # A place is where the first row's letters start; the box reaches a little above them.
            centre, top = width / 2, places.get(b.get("place"), places["top"]) * height - pad_y
        box_middle = top + tall / 2
        middles, at = [], top + pad_y
        for row_height in heights:
            middles.append(at + row_height / 2)
            at += row_height + gap
        box_width = max(text_width(row_text, row_style, row_size * size) for row_text, row_size in rows) + 2 * pad_x
        box = rounded_box(box_width, tall, radius)
        named = f"\\fn{name}" if name else ""
        looks = []
        for row_text, row_size in rows:
            font = font_tag(row_text, row_own, row_size)
            looks.append(font or f"{named}\\fs{row_size}")
        anim, seconds = b.get("anim") or "fade", end - start
        grows = anim in ("pop", "bounce", "pulse")
        layer += 2
        if len(rows) > 1 and grows:
            # Growing as one piece: libass grows each line around its own middle, so the rows would come apart
            # from the box. Here every frame puts them where the box's growth takes them (banner_pose).
            events += banner_frames(b, rows, looks, box, fill, ink, centre, box_middle, middles, size, float(b.get("opacity") or 1), layer - 2)
            continue
        if not b.get("noBox"):
            events.append(f"Dialogue: {layer - 2},{ass_time(start)},{ass_time(end)},Banner,,0,0,0,,{{\\an5\\bord0\\shad0{fill}{banner_motion(anim, centre, box_middle, seconds, 1)}\\p1}}{box}{{\\p0}}")
        for (row_text, _), middle, look in zip(rows, middles, looks):
            events.append(f"Dialogue: {layer - 1},{ass_time(start)},{ass_time(end)},Banner,,0,0,0,,{{\\an5\\bord0\\shad0\\1c{ink}{look}{banner_motion(anim, centre, middle, seconds, size)}}}{row_text}")
    return events


# ---- Cutout layers (src/lib/behind.ts): text behind the speaker, pictures and clips behind a smaller speaker.
# The motion is worked out frame by frame with the same formulas as behindMotion, so the final video
# matches the preview exactly. The speaker's matte comes from modal_app/cutout.py (matte.mp4).
BEHIND = {"fade": 0.25}
RUN_SPEED = {"slow": 150, "normal": 300, "fast": 600}
ARRIVE_TIME = {"slow": 1.6, "normal": 1, "fast": 0.6}
RUN_GAP = "   •   "
INSERT_FADE = 0.25
INSERT_ZOOM = 0.2  # how much bigger a picture with Zoom in / Zoom out gets, when its video has no Zoom speed (INSERT.zoom.start in behind.ts)
INSERT_EDGE_FADE = 0  # how far a smaller speaker fades out at the left and right, 0 = a sharp cut (INSERT.edgeFade in behind.ts)


def run_repeats(t: dict, width: int) -> int:
    """How many times running text repeats its words (runRepeats in behind.ts)."""
    reach = width + RUN_SPEED.get(t.get("speed"), 300) * (float(t["end"]) - float(t["start"]))
    each = 0.4 * float(t["size"]) * len(str(t["text"]) + RUN_GAP)
    return min(40, math.ceil(reach / max(1, each)) + 1)


def _smooth(p: float) -> float:
    q = min(1.0, max(0.0, p))
    return q * q * (3 - 2 * q)


def behind_motion(b: dict, t: float, width: int, height: int) -> list[dict]:
    """Where a text is at final-video second t (behindMotion in behind.ts): opacity, x, y, sx, sy, align."""
    start, end = float(b["start"]), float(b["end"])
    if t < start or t >= end:
        return []
    s = t - start
    k = ARRIVE_TIME.get(b.get("speed"), 1)
    out = min(1.0, (end - t) / BEHIND["fade"])
    y = float(b["y"]) * height
    size = float(b["size"])

    def pose(opacity, py=y, sx=1.0, sy=None, x=width / 2, align="center"):
        return {"opacity": opacity * out, "x": x, "y": py, "sx": sx, "sy": sx if sy is None else sy, "align": align}

    fx = b.get("fx")
    if fx == "pulse":
        q = s % 0.9
        beat = 0.09 * math.exp(-(((q - 0.05) / 0.05) ** 2)) + 0.05 * math.exp(-(((q - 0.25) / 0.05) ** 2))
        return [pose(min(1.0, s / 0.2), y, 1 + beat)]
    if fx == "burst":
        span = 0.45 * k
        p = min(s / span, 1.0)
        scale = 0.25 + 0.75 * (1 + 2.9 * (p - 1) ** 3 + 1.9 * (p - 1) ** 2)
        py = y + 0.12 * height * (1 - _smooth(s / (0.3 * k)))
        poses = [pose(min(1.0, s / 0.08), py, scale)]
        fade = max(0.0, 1 - s / span)
        if fade > 0:
            poses += [pose(0.35 * fade, py, scale * (1 + 0.18 * (1 - fade))), pose(0.15 * fade, py, scale * (1 + 0.4 * (1 - fade)))]
        return poses
    if fx == "drop":
        fall = 0.32 * k
        if s < fall:
            return [pose(1, -size + (y + size) * (s / fall) ** 2)]
        q = s - fall
        squash = math.exp(-q / 0.07) * math.cos(q * 45)
        return [pose(1, y + 20 * squash, 1 + 0.12 * squash, 1 - 0.18 * squash)]
    if fx == "runLeft":
        return [pose(min(1.0, s / 0.3), y, 1, 1, 0.1 * width - RUN_SPEED.get(b.get("speed"), 300) * s, "left")]
    if fx == "runRight":
        return [pose(min(1.0, s / 0.3), y, 1, 1, 0.9 * width + RUN_SPEED.get(b.get("speed"), 300) * s, "right")]
    p = _smooth(s / (0.8 * k))  # fade
    return [pose(p, y + 40 * (1 - p))]


def build_behind(texts: list[dict], shape: str = "9:16") -> str:
    """The text behind the speaker as subtitles, one line per text per frame (the motion is worked out here,
    see behind_motion). Each text was checked by the app (readCutout in behind.ts)."""
    width, height = FORMATS.get(shape, (WIDTH, HEIGHT))
    events = []
    for b in texts:
        text = ass_text(str(b.get("text", ""))).strip()
        if not text:
            continue
        if b.get("fx") in ("runLeft", "runRight"):
            rows = [RUN_GAP.join([text.replace("\n", " ")] * run_repeats(b, width))]  # one long line (runText in behind.ts)
        else:
            rows = text.split("\n")
        # Each row is its own event: subtitles have no line spacing of their own. Rows sit around the text's middle.
        row_step = float(b["size"]) + float(b.get("lineGap") or 0)
        font = FONTS.get(b.get("font"), FONTS["kanit"])
        stroke = int(b.get("stroke") or 0)
        look = f"\\fn{font}\\fs{int(b['size'])}\\1c{ass_colour(b.get('color', '#FFFFFF'))}\\3c{ass_colour(b.get('strokeColor', '#000000'))}\\bord{stroke}\\shad2\\4c&H000000&"
        for f in range(math.ceil(float(b["start"]) * FPS), math.ceil(float(b["end"]) * FPS)):
            for pose in behind_motion(b, f / FPS, width, height):
                if pose["opacity"] <= 0.004:
                    continue
                an = {"center": 5, "left": 4, "right": 6}[pose["align"]]
                for r, row in enumerate(rows):
                    y = pose["y"] + (r - (len(rows) - 1) / 2) * row_step * pose["sy"]
                    # The soft shadow under the letters, as in the preview (roundOutline in PlayerFrame): 40% black.
                    tags = (
                        f"\\an{an}\\pos({pose['x']:.1f},{y:.1f})\\fscx{pose['sx'] * 100:.2f}\\fscy{pose['sy'] * 100:.2f}"
                        f"\\alpha{alpha_of(pose['opacity'])}\\4a{alpha_of(0.4 * pose['opacity'])}"
                    )
                    events.append(f"Dialogue: 0,{ass_time(f / FPS)},{ass_time((f + 1) / FPS)},Behind,,0,0,0,,{{{look}{tags}}}{row}")
    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "WrapStyle: 2",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Behind,{FONTS['kanit']},200,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,0,0,0,0,100,100,0,0,1,0,2,5,0,0,0,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )


def picture_zoom(ins: dict, seconds: float, size: tuple[int, int]) -> str:
    """ffmpeg: a picture growing or shrinking around the screen's middle while it shows. Same as pictureZoom in behind.ts.
    Scale and crop only move in whole pixels, which shakes a slow zoom, so `perspective` does it (smooth_filter)."""
    motion = ins.get("picMotion")
    if ins.get("kind") == "video" or motion not in ("in", "out"):
        return ""
    W, H = size
    p = f"clip((in-1)/{seconds * FPS:.3f},0,1)"
    amount = float(ins.get("picZoom", INSERT_ZOOM))
    z = f"(1+{amount:.3f}*{p})" if motion == "in" else f"(1+{amount:.3f}*(1-{p}))"
    x, y = f"({W}/2*(1-1/{z}))", f"({H}/2*(1-1/{z}))"
    return (
        f"format=yuva420p,perspective=x0='{x}':y0='{y}':x1='{W}-{x}':y1='{y}':x2='{x}':y2='{H}-{y}':x3='{W}-{x}':y3='{H}-{y}'"
        ":interpolation=linear:eval=frame,"
    )


def cutout_filters(parts: list[str], base: str, size: tuple[int, int], cutout: dict, inputs: dict) -> str:
    """Puts the cutout layers on the joined video `base`, in the preview's order (PlayerFrame): text behind
    the speaker, then each picture or clip fading in over the whole picture, then the speaker cut out
    (matte from cutout.py, already cut and framed like the picture as [cm]): full size outside the
    pictures, smaller in front of one (or hidden). Returns the new label."""
    W, H = size
    inserts = cutout.get("inserts") or []
    person = "matte" in inputs
    smalls = [i for i in inserts if not i.get("hidden")] if person else []
    # Two pictures at once: the speaker goes by the one on top, the later in the list (Bring forward, lib/layers.ts),
    # as the preview does (PlayerFrame). So a smaller speaker is only drawn while no later picture shows, hidden or not.
    later = {id(ins): "+".join(f"between(t,{float(k['start']):.3f},{float(k['end']):.3f})" for k in inserts[n + 1 :]) for n, ins in enumerate(inserts)}
    if person:
        parts.append(f"{base}split=2[cbg][cpic]")
        base = "[cbg]"
    # Darken / Blur background while a text shows (dim, blur in behind.ts): the picture under the speaker blurred (gblur's
    # sigma is CSS blur's px) with black laid over at dim, only for the text's time, fading in and out like backdropShown.
    for j, t in enumerate(cutout.get("texts") or []):
        dim, blur = float(t.get("dim") or 0), float(t.get("blur") or 0)
        if dim <= 0 and blur < 1:
            continue
        a, b = float(t["start"]), float(t["end"])
        fade = BEHIND["fade"]
        parts.append(f"{base}split=2[cdm{j}][cdi{j}]")
        parts.append(
            f"[cdi{j}]trim=start={a:.3f}:end={b:.3f},{f'gblur=sigma={blur:.0f},' if blur >= 1 else ''}"
            f"{f'drawbox=c=black@{dim:.2f}:t=fill,' if dim > 0 else ''}format=yuva420p,"
            f"fade=t=in:st={a:.3f}:d={fade}:alpha=1,fade=t=out:st={max(a, b - fade):.3f}:d={fade}:alpha=1[cdk{j}]"
        )
        parts.append(f"[cdm{j}][cdk{j}]overlay=eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[cdo{j}]")
        base = f"[cdo{j}]"
    if cutout.get("behind"):
        parts.append(f"{base}ass={cutout['behind']}:shaping=complex{f':fontsdir={cutout['fontsdir']}' if cutout.get('fontsdir') else ''}[cbt]")
        base = "[cbt]"
    for j, ins in enumerate(inserts):
        a, b = float(ins["start"]), float(ins["end"])
        d = b - a
        # A clip or a GIF that ends early stays on its last frame, as a browser shows it.
        hold = f"tpad=stop_mode=clone:stop_duration={d:.3f}," if ins.get("kind") == "video" or str(ins.get("file", "")).endswith(".gif") else ""
        fades = (
            f"format=yuva420p,fade=t=in:st=0:d={INSERT_FADE}:alpha=1,fade=t=out:st={max(0.0, d - INSERT_FADE):.3f}:d={INSERT_FADE}:alpha=1,"
            f"setpts=PTS-STARTPTS+{a:.3f}/TB[ins{j}]"
        )
        zoom = picture_zoom(ins, d, size)
        grow, turn = float(ins.get("picScale", 1)), float(ins.get("picRotate", 0))
        dx, dy = float(ins.get("picX", 0)) * W, float(ins.get("picY", 0)) * H
        if grow == 1 and turn == 0 and dx == 0 and dy == 0:
            parts.append(f"[{inputs['inserts'][j]}:v]fps={FPS},{hold}trim=duration={d:.3f},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,{zoom}{fades}")
        else:
            # Moved, turned or resized: the whole picture on black. Same as picturePlace in behind.ts.
            # Only what can land on the screen is kept, around the picture's middle so its place doesn't change.
            # At 2.5x and turned, the whole picture took 4.3 GB for three clips, more than this machine has (10 Nov).
            half_w, half_h = W / 2 + abs(dx), H / 2 + abs(dy)
            reach = math.ceil(2 * math.hypot(half_w, half_h) / grow) + 2
            angle = f"{turn}*PI/180"
            rotate = f",rotate={angle}:ow={2 * math.ceil(half_w)}:oh={2 * math.ceil(half_h)}:c=none" if turn else ""
            parts.append(
                f"[{inputs['inserts'][j]}:v]fps={FPS},{hold}trim=duration={d:.3f},setpts=PTS-STARTPTS,scale={W}:{H}:force_original_aspect_ratio=increase,setsar=1,format=rgba,"
                f"crop=w='min(iw,{reach})':h='min(ih,{reach})':exact=1,scale=iw*{grow}:ih*{grow}{rotate}[ipic{j}]"
            )
            # A picture with clear parts keeps them around it too, so the normal video shows there.
            parts.append(f"color=c=black{'@0' if ins.get('seeThrough') else ''}:s={W}x{H}:r={FPS}:d={d:.3f},format=rgba[ibg{j}]")
            parts.append(f"[ibg{j}][ipic{j}]overlay=x=(main_w-overlay_w)/2+{dx:.1f}:y=(main_h-overlay_h)/2+{dy:.1f}:shortest=1:format=rgb,{zoom}{fades}")
        parts.append(f"{base}[ins{j}]overlay=eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[cbi{j}]")
        base = f"[cbi{j}]"
    if not person:
        return base
    parts.append(f"[cpic][cm]alphamerge,split={1 + len(smalls)}[cper]{''.join(f'[cps{j}]' for j in range(len(smalls)))}")
    away = "+".join(f"between(t,{float(i['start']):.3f},{float(i['end']):.3f})" for i in inserts) or "0"
    parts.append(f"{base}[cper]overlay=enable='not({away})'[cfull]")
    base = "[cfull]"
    for j, ins in enumerate(smalls):
        a, b, k = float(ins["start"]), float(ins["end"]), float(ins["speakerScale"])
        w = max(2, round(W * k / 2) * 2)
        x = float(ins["speakerX"]) * W - w / 2
        speaker = f"[cps{j}]"
        soft = float(ins.get("soft", INSERT_EDGE_FADE) or 0)
        if soft > 0:
            # Soft edges: a still picture of how see-through each spot is (made once, then repeated), melting at the
            # sides and the bottom, multiplied into the speaker's see-through. Same as the mask in PlayerFrame.
            parts.append(
                f"color=c=black:s={W}x{H}:r={FPS}:d=1,format=gray,geq=lum='255*min(1,min(X+0.5,W-X-0.5)/({soft}*W))*min(1,(H-Y-0.5)/({soft}*H))',"
                f"loop=loop=-1:size=1:start=0[cg{j}]"
            )
            parts.append(f"[cps{j}]split[cpa{j}][cpb{j}]")
            parts.append(f"[cpa{j}]alphaextract[cpe{j}]")
            parts.append(f"[cpe{j}][cg{j}]blend=all_mode=multiply:shortest=1[cpf{j}]")
            speaker = f"[cpb{j}][cpf{j}]alphamerge,"
        parts.append(
            f"{speaker}scale={w}:-2,format=yuva420p,fade=t=in:st={a:.3f}:d={INSERT_FADE}:alpha=1,"
            f"fade=t=out:st={max(a, b - INSERT_FADE):.3f}:d={INSERT_FADE}:alpha=1[csm{j}]"
        )
        lift = float(ins.get("speakerLift", 0)) * H
        on_top = f"*not({later[id(ins)]})" if later[id(ins)] else ""
        parts.append(f"{base}[csm{j}]overlay=x={x:.1f}:y=main_h-overlay_h-{lift:.1f}:enable='between(t,{a:.3f},{b:.3f}){on_top}'[cs{j}]")
        base = f"[cs{j}]"
    return base


# Frame Me (src/lib/frame-me.ts): the speaker inside a shape over a background, for a stretch of the video.
FRAME_RATIO = {"circle": 1, "oval": 1.3, "square": 1, "rounded": 1.25, "triangle": 0.9, "star": 1, "heart": 0.9}  # FRAME_SHAPES ratio
FRAME_ROUND = 0.18  # Rounded: the corners' radius, share of the shorter side (ROUND in frame-me.ts)
FRAME_FADE = 0.25  # seconds a frame fades in, and out, over the plain picture (FRAME.fade, frameShown in frame-me.ts)
FRAME_SUPERSAMPLE = 4  # the shape is drawn this many times bigger and shrunk: smooth edges


def _fit(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return [((x - x0) / (x1 - x0) - 0.5, (y - y0) / (y1 - y0) - 0.5) for x, y in points]


def frame_points(shape: str) -> list[tuple[float, float]]:
    """The shape's outline as points from -0.5 to 0.5 of its box, y down. Same numbers as framePoints in frame-me.ts."""
    ring = lambda n, at: [at(2 * math.pi * k / n) for k in range(n)]
    if shape in ("circle", "oval"):
        return ring(96, lambda a: (0.5 * math.cos(a), 0.5 * math.sin(a)))
    if shape == "square":
        return [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
    if shape == "rounded":
        r = FRAME_ROUND
        ry = r / FRAME_RATIO["rounded"]
        corners = [(0.5 - r, -0.5 + ry, -math.pi / 2), (0.5 - r, 0.5 - ry, 0), (-0.5 + r, 0.5 - ry, math.pi / 2), (-0.5 + r, -0.5 + ry, math.pi)]
        return [(cx + r * math.cos(a), cy + ry * math.sin(a)) for cx, cy, start in corners for a in (start + k / 8 * math.pi / 2 for k in range(9))]
    if shape == "triangle":
        return [(0, -0.5), (0.5, 0.5), (-0.5, 0.5)]
    if shape == "star":
        return _fit([((0.25 if k % 2 else 0.5) * math.cos(-math.pi / 2 + k * math.pi / 5), (0.25 if k % 2 else 0.5) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)])
    if shape == "heart":
        return _fit(ring(120, lambda t: (16 * math.sin(t) ** 3, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)))))
    return frame_points("circle")


def frame_rect(f: dict, size: tuple[int, int]) -> tuple[float, float, float, float]:
    """The shape's box on the video: left, top, width, height px. Its width is size times the video's shorter side.
    Same as frameRect in frame-me.ts."""
    W, H = size
    w = float(f["size"]) * min(W, H)
    h = w * FRAME_RATIO.get(f.get("shape"), 1)
    return float(f["x"]) * W - w / 2, float(f["y"]) * H - h / 2, w, h


def frame_art(f: dict, size: tuple[int, int], folder: Path, n: int) -> dict:
    """The shape as a still mask (white inside, the size of the video) and its border as a still picture, drawn
    with OpenCV at FRAME_SUPERSAMPLE times the size and shrunk, so the edge is as smooth as the preview's SVG.
    The border is as thick on both sides of the edge, as an SVG stroke is (frameEdge in PlayerFrame.tsx)."""
    import cv2
    import numpy as np

    W, H = size
    S = FRAME_SUPERSAMPLE
    left, top, w, h = frame_rect(f, size)
    # Sixteenths of a pixel (shift=4): the shape lands where the preview puts it, not on the nearest pixel.
    points = np.array([[[round((left + (x + 0.5) * w) * S * 16), round((top + (y + 0.5) * h) * S * 16)] for x, y in frame_points(f.get("shape", "circle"))]], dtype=np.int32)
    big = np.zeros((H * S, W * S), dtype=np.uint8)
    cv2.fillPoly(big, points, 255, lineType=cv2.LINE_8, shift=4)
    mask = folder / f"frame-mask-{n}.png"
    cv2.imwrite(str(mask), cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA))
    art = {"mask": mask, "border": None}
    border = float(f.get("border") or 0)
    if border > 0:
        big[:] = 0
        cv2.polylines(big, points, True, 255, thickness=max(1, round(border * S)), lineType=cv2.LINE_8, shift=4)
        alpha = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA)
        hexa = str(f.get("borderColor") or "#FFFFFF").lstrip("#")
        r, g, b = (int(hexa[k : k + 2], 16) for k in (0, 2, 4))
        picture = np.dstack([np.full((H, W), b, np.uint8), np.full((H, W), g, np.uint8), np.full((H, W), r, np.uint8), alpha])
        art["border"] = folder / f"frame-border-{n}.png"
        cv2.imwrite(str(art["border"]), picture)
    return art


def frame_filters(parts: list[str], base: str, size: tuple[int, int], frames: list[dict], inputs: list[dict], plain: str | None = None) -> str:
    """Frame Me: for each frame's time, the picture so far (the speaker and the Cutout layers) is made smaller or bigger
    (zoom), put with the point (meX, meY) of it in the shape's middle, cut to the shape (the mask from frame_art) and laid
    on its background: the same picture blurred and darkened, a colour, or a project picture or clip. Then its border.
    Over the speaker and Cutout, under the banners and subtitles, as the preview draws it (PlayerFrame). Two at once: the
    later in the list on top. inputs: each frame's FFmpeg inputs {"mask", "border", "file"}. plain: the picture before the
    Cutout layers, which Blur blurs: the preview blurs the picture it draws on, without the layers (Codex review 12 Nov).
    Returns the new label.
    Every frame is made from the picture before any frame and covers the whole screen, so where two overlap the later
    one simply hides the earlier, as in the preview: chained, the earlier frame showed blurred in the later one's
    background (Codex review 12 Nov)."""
    W, H = size
    blurs = [j for j, f in enumerate(frames) if f.get("back") not in ("color", "file") or inputs[j].get("file") is None and f.get("back") == "file"]
    parts.append(f"{base}split={len(frames) + 1}[fmm]{''.join(f'[fms{j}]' for j in range(len(frames)))}")
    if plain and blurs:
        parts.append(f"{plain}split={len(blurs)}{''.join(f'[fpl{j}]' for j in blurs)}")
    elif plain:
        parts.append(f"{plain}nullsink")  # no Blur frame: an output left unused stops FFmpeg
    base = "[fmm]"
    for j, f in enumerate(frames):
        a, b = float(f["start"]), float(f["end"])
        d = b - a
        src = inputs[j]
        trim = f"trim=start={a:.3f}:end={b:.3f}"
        # fmq: the picture without frames, which a frame fades over (the preview fades it over a copy of its picture,
        # not over an earlier frame still showing: Codex review 12 Nov).
        if plain and j in blurs:
            parts.append(f"[fms{j}]{trim},split=2[fmp{j}][fmq{j}]")
            parts.append(f"[fpl{j}]{trim}[fmb{j}]")
        else:
            parts.append(f"[fms{j}]{trim},split=3[fmb{j}][fmp{j}][fmq{j}]")
        back = f.get("back")
        if back == "color":
            colour = str(f.get("backColor") or "#000000").lstrip("#")
            parts.append(f"[fmb{j}]drawbox=c=0x{colour}:t=fill[fbg{j}]")
        elif back == "file" and src.get("file") is not None:
            # Fills the screen (cover), as the preview's object-fit: cover. A clip or GIF that ends early stays on its last frame.
            moving = f.get("media") == "video" or str(f.get("file", "")).endswith(".gif")
            hold = f"tpad=stop_mode=clone:stop_duration={d:.3f}," if moving else ""
            parts.append(
                f"[{src['file']}:v]fps={FPS},{hold}trim=duration={d:.3f},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
                f"format=yuv420p,setpts=PTS-STARTPTS+{a:.3f}/TB[fbf{j}]"
            )
            parts.append(f"[fmb{j}]drawbox=c=black:t=fill[fbk{j}]")
            parts.append(f"[fbk{j}][fbf{j}]overlay=eof_action=repeat[fbg{j}]")
        else:
            # Blur: gblur's sigma is CSS blur's px (as the Cutout backdrop), black laid over at dim.
            blur, dim = float(f.get("blur") or 0), float(f.get("dim") or 0)
            look = ",".join(x for x in (f"gblur=sigma={blur:.0f}" if blur >= 1 else "", f"drawbox=c=black@{dim:.2f}:t=fill" if dim > 0 else "") if x) or "null"
            parts.append(f"[fmb{j}]{look}[fbg{j}]")
        parts.append(f"[fbg{j}]split=2[fbu{j}][fbv{j}]")
        # The picture at zoom, its (meX, meY) on the shape's middle (framePicture in frame-me.ts), on the background:
        # where it doesn't reach, the background shows inside the shape too, as in the preview.
        zoom = float(f["zoom"])
        sw, sh = max(2, round(W * zoom / 2) * 2), max(2, round(H * zoom / 2) * 2)
        px = float(f["x"]) * W - zoom * float(f["meX"]) * W
        py = float(f["y"]) * H - zoom * float(f["meY"]) * H
        parts.append(f"[fmp{j}]scale={sw}:{sh},setsar=1[fpz{j}]")
        parts.append(f"[fbv{j}][fpz{j}]overlay=x={px:.1f}:y={py:.1f}[fpc{j}]")
        parts.append(f"[{src['mask']}:v]format=gray,trim=duration={d:.3f},setpts=PTS-STARTPTS+{a:.3f}/TB[fmk{j}]")
        parts.append(f"[fpc{j}][fmk{j}]alphamerge[fpa{j}]")
        parts.append(f"[fbu{j}][fpa{j}]overlay[fco{j}]")
        out = f"[fco{j}]"
        if src.get("border") is not None:
            parts.append(f"[{src['border']}:v]format=rgba,trim=duration={d:.3f},setpts=PTS-STARTPTS+{a:.3f}/TB[fbd{j}]")
            parts.append(f"[fco{j}][fbd{j}]overlay=format=auto[fcb{j}]")
            out = f"[fcb{j}]"
        # Fades in and out over the picture under it (frameShown in frame-me.ts). Timestamps are the whole video's here.
        fade_in = min(FRAME_FADE, d / 2)
        parts.append(
            f"{out}format=yuva420p,fade=t=in:st={a:.3f}:d={fade_in:.3f}:alpha=1,fade=t=out:st={b - fade_in:.3f}:d={fade_in:.3f}:alpha=1[fcf{j}]"
        )
        parts.append(f"[fmq{j}][fcf{j}]overlay[fcx{j}]")
        parts.append(f"{base}[fcx{j}]overlay=eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[fmo{j}]")
        base = f"[fmo{j}]"
    return base


# Layout (src/lib/layout.ts): the screen split, the speaker in one part and a picture, clip or colour in the other.
LAYOUT_SLIDE = 0.5  # seconds the other part takes to slide in, and out (LAYOUT.slide in layout.ts)
LAYOUT_FLASH = 0.15  # seconds the white flash takes to come up, and to go, at each edge (LAYOUT.flash in layout.ts)


def layout_boxes(l: dict, size: tuple[int, int]) -> dict:
    """The speaker's part, the other part (left, top, width, height px) and where the speaker's whole picture goes once
    split (its top left corner; it keeps its size, so it stays as sharp). Same as layoutBoxes in layout.ts."""
    W, H = size
    stack = l.get("kind") != "side"
    first = l.get("meFirst") is not False
    mine = 2 * js_round(float(l.get("split") or 0.5) * (H if stack else W) / 2)  # even px, as layoutBoxes
    if stack:
        me = (0, 0 if first else H - mine, W, mine)
        other = (0, mine if first else 0, W, H - mine)
    else:
        me = (0 if first else W - mine, 0, mine, H)
        other = (mine if first else 0, 0, W - mine, H)

    def along(middle: float, point: float, start: float, length: float, whole: float) -> float:
        return min(start, max(start + length - whole, middle - point))

    picture = (
        along(me[0] + me[2] / 2, float(l.get("meX", 0.5)) * W, me[0], me[2], W),
        along(me[1] + me[3] / 2, float(l.get("meY", 0.4)) * H, me[1], me[3], H),
    )
    return {"me": me, "other": other, "picture": picture}


def layout_ease_expr(l: dict) -> str:
    """How far it is split at the frame's time t, as an FFmpeg expression: 0 = all speaker, 1 = split. Only Slide moves,
    eased in and out; one shorter than both slides slides over half its time each way. Same as layoutProgress."""
    if l.get("enter", "slide") != "slide":
        return "1"
    a, b = float(l["start"]), float(l["end"])
    d = min(LAYOUT_SLIDE, (b - a) / 2)
    u = f"clip(min((t-{a:.3f})/{d:.4f},({b:.3f}-t)/{d:.4f}),0,1)"
    return f"if(lt({u},0.5),4*pow({u},3),1-pow(2-2*{u},3)/2)"


def layout_filters(parts: list[str], base: str, size: tuple[int, int], layouts: list[dict], inputs: list[int | None]) -> str:
    """Layout: for each layout's time, the picture so far (the speaker and the Cutout layers) is moved, never scaled, so
    the point (meX, meY) sits in the middle of the speaker's part, and the other part (a project picture or clip filling
    it, else its colour) comes in from its own edge of the screen. Both move by the same eased amount, so nothing
    uncovered ever shows between them. Over Cutout, under Frame Me, banners and subtitles, as the preview draws it
    (PlayerFrame). Two at once: the later in the list on top. inputs: each layout's file input, or None. Returns the new label.
    Every layout is made from the picture before any layout, so where two overlap the later one simply hides the earlier."""
    W, H = size
    parts.append(f"{base}split={len(layouts) + 1}[lym]{''.join(f'[lys{j}]' for j in range(len(layouts)))}")
    base = "[lym]"
    for j, l in enumerate(layouts):
        a, b = float(l["start"]), float(l["end"])
        d = b - a
        boxes = layout_boxes(l, size)
        px, py = boxes["picture"]
        ox, oy, ow, oh = boxes["other"]
        stack, first = l.get("kind") != "side", l.get("meFirst") is not False
        e = layout_ease_expr(l)
        parts.append(f"[lys{j}]trim=start={a:.3f}:end={b:.3f},split=3[lyk{j}][lyp{j}][lyc{j}]")
        parts.append(f"[lyk{j}]drawbox=c=black:t=fill[lyb{j}]")
        # The speaker's picture moved e of the way (layoutPose: picture * p).
        parts.append(f"[lyb{j}][lyp{j}]overlay=x='{px:.1f}*({e})':y='{py:.1f}*({e})'[lyv{j}]")
        if inputs[j] is not None:
            # Fills its part (cover), as the preview's object-fit: cover. A clip or GIF that ends early stays on its last frame.
            moving = l.get("media") == "video" or str(l.get("file", "")).endswith(".gif")
            hold = f"tpad=stop_mode=clone:stop_duration={d:.3f}," if moving else ""
            parts.append(
                f"[{inputs[j]}:v]fps={FPS},{hold}trim=duration={d:.3f},scale={ow}:{oh}:force_original_aspect_ratio=increase,crop={ow}:{oh},setsar=1,"
                f"format=yuv420p,setpts=PTS-STARTPTS+{a:.3f}/TB[lyf{j}]"
            )
        else:
            colour = str(l.get("color") or "#000000").lstrip("#")
            parts.append(f"[lyc{j}]crop={ow}:{oh}:0:0,drawbox=c=0x{colour}:t=fill[lyf{j}]")
        if inputs[j] is not None:
            parts.append(f"[lyc{j}]nullsink")
        # The other part slid in from its own edge: off by (1 - p) of its size (layoutPose).
        sign = 1 if first else -1
        x = f"{ox}" if stack else f"{ox}+{sign * ow}*(1-({e}))"
        y = f"{oy}+{sign * oh}*(1-({e}))" if stack else f"{oy}"
        parts.append(f"[lyv{j}][lyf{j}]overlay=x='{x}':y='{y}':eof_action=repeat[lyo{j}]")
        parts.append(f"{base}[lyo{j}]overlay=eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[lyx{j}]")
        base = f"[lyx{j}]"
    return base


def layout_flash_windows(layouts: list[dict]) -> list[float]:
    """The edges of the Flash layouts, seconds of the final video: a white flash peaks at each one (layoutFlash)."""
    return [float(l[k]) for l in layouts if l.get("enter") == "flash" for k in ("start", "end")]


def layout_flashes(parts: list[str], base: str, edges: list[float]) -> str:
    """White over the picture from LAYOUT_FLASH before each edge to LAYOUT_FLASH after it, fully white at the edge, as
    layoutFlash in layout.ts. Over the layouts, under Frame Me, banners and subtitles. Returns the new label."""
    if not edges:
        return base
    F = LAYOUT_FLASH
    parts.append(f"{base}split={len(edges) + 1}[lfm]{''.join(f'[lfs{k}]' for k in range(len(edges)))}")
    base = "[lfm]"
    for k, e in enumerate(edges):
        a, b = max(0.0, e - F), e + F
        parts.append(
            f"[lfs{k}]trim=start={a:.3f}:end={b:.3f},drawbox=c=white:t=fill,format=yuva420p,"
            f"fade=t=in:st={e - F:.3f}:d={F}:alpha=1,fade=t=out:st={e:.3f}:d={F}:alpha=1[lfw{k}]"
        )
        parts.append(f"{base}[lfw{k}]overlay=eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[lfo{k}]")
        base = f"[lfo{k}]"
    return base


def banner_file_size(anim: str, frames_ms: str) -> tuple[float, str]:
    """An uploaded banner's size over time (1 = its Size), as an FFmpeg expression of `frames_ms` (ms since it
    arrived), and the biggest it gets. Same keyframes as BANNER_ANIMS / bannerMotion in banners.ts, and as the
    word banners' tags (banner_motion)."""
    spec = BANNER_ANIMS.get(anim, BANNER_ANIMS["fade"])
    if anim == "pulse":  # up to 108% and back every PULSE_MS
        half = PULSE_MS / 2
        swing = f"mod({frames_ms},{PULSE_MS})/{half:g}"
        return 1.08, f"(1+0.08*if(lte({swing},1),{swing},2-{swing}))"
    keys = spec.get("keys")
    if not keys:
        return 1.0, "1"
    expr = f"{keys[-1][1] / 100:g}"
    for (t0, s0), (t1, s1) in reversed(list(zip(keys, keys[1:]))):
        expr = f"if(lt({frames_ms},{t1}),{s0 / 100:g}+{(s1 - s0) / 100:g}*({frames_ms}-{t0})/{t1 - t0},{expr})"
    return max(1.0, max(k[1] for k in keys) / 100), expr


def banner_file_filters(parts: list[str], base: str, size: tuple[int, int], banners: list[dict], inputs: list[int]) -> str:
    """Puts each uploaded banner (a picture, GIF or clip: kind "file" in banners.ts) on the video `base`, over
    the speaker and the Cutout layers, under the logo, the subtitles and the word banners: the preview's order
    (PlayerFrame). Its middle at (x, y), BANNER_FILE width x its size wide, as solid as its opacity, arriving as
    picked (anim: bannerMotion in banners.ts) and fading out like a word banner. inputs: each one's FFmpeg input.
    Growing and shrinking is done by `perspective` on a canvas as big as it ever gets: scale moves in whole
    pixels, which shakes (as it did for Auto zoom, smooth_zoom_expr). Returns the new label."""
    W, H = size
    fade = BANNER["fade"]
    for j, b in enumerate(banners):
        a, e = float(b["start"]), float(b["end"])
        d = e - a
        grow = min(BANNER_SCALE[1], max(BANNER_SCALE[0], float(b.get("scale") or 1)))
        x, y = float(b.get("x", BANNER_FILE["x"])) * W, float(b.get("y", BANNER_FILE["y"])) * H
        opacity = min(1.0, max(0.05, float(b.get("opacity") or 1)))
        anim = b.get("anim") or "fade"
        spec = BANNER_ANIMS.get(anim, BANNER_ANIMS["fade"])
        ms = f"((in-1)*{1000 / FPS:.6f})"  # perspective counts frames from 1 (as in picture_zoom): one frame ahead without -1
        biggest, now = banner_file_size(anim, ms)
        # Drawn at its biggest, with a clear edge so the shrinking corners stay clear; at its normal size it is w wide.
        w = max(2, round(W * BANNER_FILE["width"] * grow * biggest / 2) * 2)
        motion = ""
        if now != "1":
            f = f"({now}/{biggest:g})"
            mx, my = f"(W/2*(1-1/{f}))", f"(H/2*(1-1/{f}))"
            motion = (
                f"format=yuva420p,perspective=x0='{mx}':y0='{my}':x1='W-{mx}':y1='{my}':x2='{mx}':y2='H-{my}':x3='W-{mx}':y3='H-{my}'"
                ":interpolation=linear:eval=frame,"
            )
        fade_in = f"fade=t=in:st=0:d={fade}:alpha=1," if spec["fade_in"] else ""
        fades = f"{fade_in}fade=t=out:st={max(0.0, d - fade):.3f}:d={fade}:alpha=1,"
        shown = ""
        if d < 2 * fade:
            # Shorter than both fades: the preview takes the smaller of the two (bannerMotion), two fades in a row
            # multiply them (Codex review, 12 Nov). So the preview's rule, on these few frames only.
            fall = f"({d:.3f}-T)/{fade}"
            level = f"min(1,min(T/{fade},{fall}))" if spec["fade_in"] else f"min(1,{fall})"
            shown = f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*{level}',"
            fades = ""
        # A clip or a GIF that ends early stays on its last frame, as the preview shows it (same as an insert).
        moving = b.get("media") == "video" or str(b.get("file", "")).endswith(".gif")
        hold = f"tpad=stop_mode=clone:stop_duration={d:.3f}," if moving else ""
        parts.append(
            f"[{inputs[j]}:v]fps={FPS},{hold}trim=duration={d:.3f},setpts=PTS-STARTPTS,format=rgba,scale={w}:-2,setsar=1,"
            f"colorchannelmixer=aa={opacity:.2f},{shown}pad=iw+4:ih+4:2:2:color=black@0,{motion}"
            f"format=yuva420p,{fades}"
            f"setpts=PTS-STARTPTS+{a:.3f}/TB[bf{j}]"
        )
        # Slide: starts this far off and glides into place in SLIDE_MS (whole pixels are fine for a fast move).
        sx, sy = spec.get("slide") or (0, 0)
        left = f"max(0,1-(t-{a:.3f})*{1000 / SLIDE_MS:.6f})"
        px = f"{x:.1f}-overlay_w/2" + (f"+{sx}*{left}" if sx else "")
        py = f"{y:.1f}-overlay_h/2" + (f"+{sy}*{left}" if sy else "")
        parts.append(f"{base}[bf{j}]overlay=x='{px}':y='{py}':eval=frame:eof_action=pass:format=auto:enable='between(t,{a:.3f},{e:.3f})'[bfo{j}]")
        base = f"[bfo{j}]"
    return base


def banner_file_input(b: dict) -> list[str]:
    """How FFmpeg reads an uploaded banner: a picture as one frame repeated, a GIF as its file plays (-stream_loop
    froze it, 11 Nov), an MP4 clip as it is."""
    path, name = str(b["path"]), str(b.get("file", ""))
    if b.get("media") != "video":
        return (["-ignore_loop", "0"] if name.endswith(".gif") else ["-loop", "1", "-framerate", str(FPS)]) + ["-i", path]
    return ["-i", path]


def ass_colour(hex_colour: str) -> str:
    """#RRGGBB to an ASS colour (&H00BBGGRR&)."""
    h = hex_colour.lstrip("#") if re.fullmatch(r"#[0-9a-fA-F]{6}", hex_colour or "") else "FFE600"
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}&".upper()

# Subtitle look, as picked in the editor (src/lib/subtitle-style.ts).
DEFAULT_STYLE = {
    "font": "kanit",
    "look": "clean",  # clean | box | highlight | big | two
    "size": 100,  # px on a 1080x1920 frame
    "outline": 10,  # black border around the white letters, px
    "position": 0.31,  # 0 = bottom edge, 0.5 = middle of the screen
    "textColor": "#FFFFFF",  # the letters
    "outlineColor": "#000000",  # the border around the letters
    "boxColor": "#000000",  # the Box look's box
    "letterSpacing": 0,  # px between letters
    "lineSpacing": 0,  # px added between the rows of the Two lines look
    "color": "#FFE600",  # brand colour: the Highlight look's word
    "logo": "",  # channel name in a corner, "" = none
    "logoAt": "top-left",  # or top-right, bottom-left, bottom-right
    "logoSize": 180,  # the logo picture's width, px (logoUrl: a link to the picture, sent by the app)
    "logoOpacity": 1,
    "zoom": "off",  # Auto zoom: "in" / "out" = one way across the whole video, "smooth" = a slow glide in and out, "cuts" = every other kept piece a little closer
    "motion": "none",  # none | pop (lines pop in) | bounce (and every word bounces as it is said)
    "subtitles": True,  # False: no subtitles on the video (banners and the logo stay)
    "audio": True,  # Audio optimization (polish_sound), False: the sound stays as recorded
    "audioAmount": 1,  # 0 = as recorded .. 1 = fully optimized, in between the two are mixed
}
# Auto zoom: how close it gets, seconds to glide in and out (both picked by the user: zoomAmount and
# zoomPeriod in src/lib/subtitle-style.ts), seconds to settle around a no-zoom part (src/lib/zoom.ts).
ZOOM = 1.12
SMOOTH_PERIOD = 12
SMOOTH_FADE = 0.75
PART_GLIDE = 0.8  # seconds a zoom part's push in (or pull back) takes (PART_GLIDE in src/lib/zoom.ts)
PART_ZOOMS = ("in", "out", "smooth", "cuts")
CUT_FADE = 0.004  # seconds of sound faded in and out at every cut
ZOOM_ORIGIN = (0.5, 0.4)  # zoomed around this point of the frame: a little above the middle, where faces are


def keep_segments(duration: float, cuts: list[dict]) -> list[tuple[float, float]]:
    """The parts of the video that stay: everything that is not a cut."""
    keeps, pos = [], 0.0
    for cut in sorted(cuts, key=lambda c: c["start"]):
        if cut["start"] > pos:
            keeps.append((pos, cut["start"]))
        pos = max(pos, cut["end"])
    if pos < duration:
        keeps.append((pos, duration))
    return [(a, b) for a, b in keeps if b - a > 0.05]


def js_round(x: float) -> int:
    # Math.round in the browser (Python's round() sends halves to the even number).
    return math.floor(x + 0.5)


def frame_segments(keeps: list[tuple[float, float]]) -> list[tuple[int, int, int]]:
    """The kept parts in frames: (output frame, source frame, frame count). Same as keepSegments in timeline.ts."""
    segments, start = [], 0
    for a, b in keeps:
        trim = js_round(a * FPS)
        frames = js_round(b * FPS) - trim
        if frames <= 0:
            continue
        segments.append((start, trim, frames))
        start += frames
    return segments


def place_frame(t: float, segments: list[tuple[int, int, int]]) -> float | None:
    """The output frame for a moment of the original video (None if it was cut). Same as placeFrame in timeline.ts."""
    f = t * FPS
    for start, trim, frames in segments:
        if trim <= f <= trim + frames:
            return start + (f - trim)
    return None


def break_frame(t: float, segments: list[tuple[int, int, int]]) -> float | None:
    """The output frame a Split breaks subtitle lines at (the breaks in subtitleLines, timeline.ts)."""
    placed = place_frame(t, segments)
    return placed if placed is not None else next((start for start, trim, _ in segments if trim / FPS > t), None)


def source_at(frame: float, segments: list[tuple[int, int, int]]) -> float | None:
    """The second of the original video at this output frame, a hundredth in (lineSource in timeline.ts)."""
    for start, trim, frames in reversed(segments):  # right after a cut, the piece that starts there
        if start <= frame <= start + frames:
            return (trim + frame - start) / FPS + 0.01
    return None


def is_thai(text: str) -> bool:
    return any("฀" <= ch <= "๿" for ch in text)


def fix_thai(text: str) -> str:
    # Deepgram writes sara am as nikhahit + sara aa (ํา); fonts render that badly.
    return text.replace("ํา", "ำ")


def char_kind(ch: str) -> str | None:
    if "฀" <= ch <= "๿":
        return "thai"
    if ch.isdigit():
        return "number"
    if ch.isascii() and ch.isalpha():
        return "latin"
    return None


# Polite endings: a Thai sentence usually ends on one, so a space goes after it.
THAI_ENDINGS = {"ครับ", "คับ", "ค่ะ", "คะ", "ค่า", "นะ", "จ้ะ", "จ้า", "ฮะ", "ฮับ", "เนอะ", "นะครับ", "นะคะ"}
THAI_MARKS = re.compile("[ัิ-ฺ็-๎]")


def thai_letters(text: str) -> int:
    return len(THAI_MARKS.sub("", text))


# Where a Thai line may break: never before a word that belongs to the one before it ("ชุด|นี้"),
# best at a pause or before a word that starts a phrase. Same as THAI_NO_START / THAI_STARTS in timeline.ts.
THAI_NO_START = {"นี้", "นั้น", "โน้น", "ไหม", "มั้ย", "เลย", "ด้วย", "กัน", "ได้", "ๆ", "อยู่", "หรอ", "เหรอ", "เดียว", "กว่า", "ที่สุด", "มาก", "หน่อย", "บ้าง", "เอง", "ไว้", "ขึ้น", "ออก"}
THAI_STARTS = {"แต่", "ถ้า", "และ", "หรือ", "เพราะ", "ซึ่ง", "โดย", "ดังนั้น", "เช่น", "คือ", "เมื่อ", "ตอนที่", "จน", "ทำให้", "แล้วก็", "ก็"}
START_BONUS = 8  # frames: a phrase start or a polite ending is worth a pause this long
THAI_LETTER_EM = 0.44  # how wide a Thai letter is, in text sizes: to work out what letter spacing costs (timeline.ts)


def group_lines(placed: list[dict], thai: bool, per_line: int, max_frames: float, max_letters: int, gap_frames: float, breaks: list[float] | None = None) -> list[list[dict]]:
    """Words into short subtitle lines. Same as the grouping in subtitleLines (timeline.ts). breaks: frames of the Splits."""
    letters_of = lambda run: sum(thai_letters(w["text"]) for w in run)

    def fits(run: list[dict]) -> bool:
        return len(run) <= per_line and run[-1]["end"] - run[0]["start"] <= max_frames and (not thai or letters_of(run) <= max_letters)

    def best_break(run: list[dict], nxt: dict) -> int:
        # A full Thai line: k = how many words stay, the rest is carried to the next line if it fits.
        every = run + [nxt]
        best, best_score = len(run), -math.inf
        for k in range(1, len(run) + 1):
            first, last = every[k], every[k - 1]
            if first["text"] in THAI_NO_START or first["text"] in THAI_ENDINGS or first["text"].startswith("ๆ"):
                continue
            if k < len(run) and (letters_of(run[:k]) < max(3, max_letters * 0.4) or not fits(every[k:])):
                continue
            score = first["start"] - last["end"] + (START_BONUS if first["text"] in THAI_STARTS else 0) + (START_BONUS if last["text"] in THAI_ENDINGS else 0) + 0.3 * k
            if score >= best_score:
                best, best_score = k, score
        return best

    lines, current = [], []
    for w in placed:
        crosses_split = bool(current) and any(current[-1]["start"] < b <= w["start"] + 0.01 for b in (breaks or []))
        if crosses_split or (current and w["start"] - current[-1]["end"] > gap_frames):
            lines.append(current)
            current = []
        elif current and not fits(current + [w]):
            k = best_break(current, w) if thai else len(current)
            lines.append(current[:k])
            current = current[k:]
        current.append(w)
    if current:
        lines.append(current)
    return lines


def join_thai(words: list[dict]) -> list[str]:
    """Thai doesn't put spaces between words, only between phrases. A Thai line gets one where Thai,
    numbers and English meet ("5 นาที"), after a polite ending or ๆ, and where the speaker pauses.
    Returns each word with the space before it. Same as joinThai in src/lib/timeline.ts."""
    out, parts = "", []
    for i, w in enumerate(words):
        t = w["text"]
        space = ""
        if i and out and t:
            prev = words[i - 1]
            a, b = char_kind(out[-1]), char_kind(t[0])
            ending = (prev["text"] in THAI_ENDINGS and t not in THAI_ENDINGS) or prev["text"].endswith("ๆ")
            if w.get("space") or (a and b and a != b) or ending or w["start"] - prev["end"] >= THAI_PAUSE * FPS:
                space = " "
        out += space + t
        parts.append(space + t)
    return parts


TWO_ROWS_FROM = 14  # Two lines look: a line with more letters than this is split in two rows


def second_row(texts: list[str]) -> int | None:
    """Where to split a line into two rows: between the words closest to half its letters.
    Same as secondRow in src/lib/timeline.ts."""
    sizes = [thai_letters(t.strip()) for t in texts]
    total = sum(sizes)
    if len(texts) < 2 or total <= TWO_ROWS_FROM:
        return None
    best, before, best_diff = 1, 0, math.inf
    for k in range(1, len(texts)):
        before += sizes[k - 1]
        diff = abs(before - total / 2)
        if diff < best_diff:
            best, best_diff = k, diff
    return best


# Motion: (milliseconds after the start, size in %), straight lines between. Same as src/lib/motion.ts.
POP = [(0, 70), (90, 110), (170, 100)]
BOUNCE = [(0, 100), (60, 125), (120, 150), (200, 145), (300, 110), (370, 97), (440, 100)]
POP_END = POP[-1][0]
BOUNCE_END = BOUNCE[-1][0]
BOUNCE_WORD_GAP = 0.14  # of the text size: room kept between words, so two big words don't cover each other
SIDE_MARGIN = 80  # px kept clear at each side of a subtitle line (MarginL/R, SIDE_MARGIN in PlayerFrame.tsx)


def scale_at(keys: list[tuple[int, int]], ms: float) -> float:
    if ms <= keys[0][0]:
        return keys[0][1]
    for (t0, s0), (t1, s1) in zip(keys, keys[1:]):
        if ms < t1:
            return s0 + (s1 - s0) * (ms - t0) / (t1 - t0)
    return keys[-1][1]


def scale_tags(keys: list[tuple[int, int]], offset: float) -> str:
    """ASS tags that play `keys` from `offset` ms in (where the event starts): the size now, then a \\t
    to each later keyframe. libass draws the letters bigger, so the words around them make room."""
    now = round(scale_at(keys, offset), 1)
    tags, prev = f"\\fscx{now:g}\\fscy{now:g}", offset
    for ms, size in keys:
        if ms > offset:
            tags += f"\\t({js_round(prev - offset)},{js_round(ms - offset)},\\fscx{size}\\fscy{size})"
            prev = ms
    return tags


def word_places(plain: list[str], row2: int | None, style: dict, size: float, spacing: int, video_w: int, bottom: float, row_step: float, row_height: float, cyrillic: bool = False) -> list[tuple[float, float]]:
    """Where the middle of each word of a bouncing line goes, so the line looks the same as when libass lays
    it out by itself: centred, rows going up from `bottom`. A line too wide for the video continues on a
    new row, as it does in the browser."""
    widths = [text_width(p.strip(), style, size, spacing, cyrillic) for p in plain]
    spaces = [max(0.0, text_width(p, style, size, spacing, cyrillic) - w) + size * BOUNCE_WORD_GAP for p, w in zip(plain, widths)]
    room = video_w - 2 * SIDE_MARGIN
    rows, row, used = [], [], 0.0
    for k in range(len(plain)):
        add = widths[k] + (spaces[k] if row else 0)
        if row and (k == row2 or used + add > room):
            rows.append(row)
            row, used, add = [], 0.0, widths[k]
        row.append(k)
        used += add
    rows.append(row)
    places: list[tuple[float, float]] = [(0.0, 0.0)] * len(plain)
    for r, row in enumerate(rows):
        total = sum(widths[k] + (spaces[k] if k != row[0] else 0) for k in row)
        x = (video_w - total) / 2
        y = bottom - row_step * (len(rows) - 1 - r) - row_height / 2
        for k in row:
            if k != row[0]:
                x += spaces[k]
            places[k] = (x + widths[k] / 2, y)
            x += widths[k]
    return places


def bounce_events(line: list[dict], start: float, end: float, words: list[str], places: list[tuple[float, float]], line_font: str, layer: int, highlight: str | None) -> list[str]:
    """Bounce: every word is its own subtitle at a fixed place and jumps around its own middle when it is
    said. It never pushes the other words: \\fscx inside a line does, which made the whole line shake like a
    seizure. The word in mid-jump is drawn on top. Same as motionScale and PlayerFrame.tsx."""
    events = []
    for k, text in enumerate(words):
        said = max(start, line[k]["start"])
        jump_end = said + BOUNCE_END / 1000 * FPS
        colour_end = line[k + 1]["start"] if k + 1 < len(line) else end
        cuts = sorted({start, said, min(jump_end, end), end} | ({min(colour_end, end)} if highlight else set()))
        x, y = places[k]
        for a, b in zip(cuts, cuts[1:]):
            since = (a - said) / FPS * 1000
            jumping = 0 <= since < BOUNCE_END
            tags = f"\\an5\\pos({x:.1f},{y:.1f}){line_font}"
            if highlight and said <= a < colour_end:
                tags += f"\\1c{highlight}"
            if jumping:
                tags += scale_tags(BOUNCE, since)
            events.append(f"Dialogue: {layer + 1 if jumping else layer},{ass_time(a / FPS)},{ass_time(b / FPS)},Default,,0,0,0,,{{{tags}}}{text}")
    return events


def pop_tags(motion: str, since: float) -> str:
    """The line popping in, for an event `since` ms after the line started ("" once it is done)."""
    return f"{{{scale_tags(POP, since)}}}" if motion == "pop" and since < POP_END else ""


def spaced_marks(text: str, spacing: int) -> str:
    """Letter spacing for Thai: libass adds the space after every mark and vowel on top too, which pulls
    them off their letter. So the space goes after the last mark, and none before it."""
    if not spacing:
        return text
    return re.sub(f"(.)({THAI_MARKS.pattern}+)", lambda m: f"{{\\fsp0}}{m[1]}{m[2][:-1]}{{\\fsp{spacing}}}{m[2][-1]}", text)


def ass_text(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def ass_time(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def build_subtitles(words: list[dict], keeps: list[tuple[float, float]], style: dict, banners: list[dict] | None = None) -> str:
    thai = any(is_thai(w["text"]) for w in words)
    # "own": the user's uploaded font, put in the fonts folder next to the subtitles (render()).
    font = str(style.get("ownFamily") or FONTS["kanit"]) if style["font"] == "own" else FONTS.get(style["font"], FONTS["kanit"])
    look = style.get("look", "clean")
    motion = style.get("motion", "none")
    size = int(style["size"])
    outline = int(style["outline"])
    video_w, video_h = FORMATS.get(style.get("format"), (WIDTH, HEIGHT))
    margin_v = js_round(video_h * float(style["position"]))
    limits = LINE_LIMITS.get(look, LINE_LIMITS["normal"])
    per_line = limits["thai_words"] if thai else limits["words"]
    max_seconds = limits["thai_seconds"] if thai else limits["seconds"]

    # Move every kept word onto the new (cut) timeline, counted in frames like the preview does
    # (placeFrame in timeline.ts), so both break lines in the same places.
    segments = frame_segments(keeps)
    placed = []
    for w in words:
        mid = place_frame((w["start"] + w["end"]) / 2, segments)
        if mid is None:
            continue
        half = (w["end"] - w["start"]) / 2 * FPS
        placed.append({"text": fix_thai(w["text"]), "start": max(0.0, mid - half), "end": mid + half, "space": w.get("space")})

    # Group words into short lines.
    gap_frames = LINE_BREAK_GAP * FPS
    # The line's width in letters at the limit's size, shared out among bigger or more spaced-out letters.
    spacing = int(style.get("letterSpacing") or 0)
    max_letters = math.floor(limits["thai_letters"] * limits["size"] * THAI_LETTER_EM / (max(size, limits["size"]) * THAI_LETTER_EM + spacing) + 1e-9)
    # A Split inside a cut part breaks where the video picks up again, or the pieces on either side would join.
    breaks = [f for f in (break_frame(float(s), segments) for s in (style.get("splits") or [])) if f is not None]
    spots = style.get("spots") or []
    lines = group_lines(placed, thai, per_line, max_seconds * FPS, max_letters, gap_frames, breaks)
    if style.get("subtitles") is False:  # turned off: same as the preview (PlayerFrame shows no line)
        lines = []

    brand = style.get("color", "#FFE600")
    highlight = ass_colour(brand)
    own_font = style["font"] == "own"
    events = banner_events(banners or [], video_h, style.get("format", "9:16"), own_font, style)
    # The channel name stays in its corner for the whole video.
    # (A logo picture, if there is one, is put on by FFmpeg instead: logo_filter.)
    logo = "" if style.get("logoUrl") else ass_text(str(style.get("logo") or "")).replace("\n", " ").strip()
    if logo:
        total = sum(frames for _, _, frames in segments) / FPS
        logo_font = font_tag(logo, own_font, LOGO["size"])
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(total)},Logo,,0,0,0,,{{{logo_font}}}{logo}")
    logo_align = {"top-left": 7, "top-right": 9, "bottom-left": 1, "bottom-right": 3}.get(style.get("logoAt"), 7)
    # Round corners: libass's own box is always square, so the box is drawn under the letters instead.
    # Bounce too: each word is its own subtitle, but the line has one box.
    draw_box = look == "box" and (float(style.get("boxRadius") or 0) > 0 or motion == "bounce")
    box_fill = f"\\1c{ass_colour(style.get('boxColor', '#000000'))}\\1a{alpha_of(float(style.get('boxOpacity', 0.75)))}"
    text_layer = 1 if draw_box else 0
    for i, line in enumerate(lines):
        start = line[0]["start"]
        # A piece moved on its own (spots, dragged in the preview): this line's distance from the bottom.
        source = source_at(start, segments)
        spot = next((s for s in spots if source is not None and s["start"] <= source < s["end"]), None)
        line_margin = js_round(video_h * float(spot["position"])) if spot else margin_v
        # Hold each line until the next one starts (if close), so subtitles don't flicker.
        end = line[-1]["end"]
        if i + 1 < len(lines) and lines[i + 1][0]["start"] - end < gap_frames:
            end = lines[i + 1][0]["start"]
        plain = [ass_text(p) for p in (join_thai(line) if thai else [(" " if k else "") + w["text"] for k, w in enumerate(line)])]
        parts = [spaced_marks(p, spacing) for p in plain]
        row2 = second_row(plain) if look == "two" else None
        line_font = font_tag("".join(parts), own_font, size)
        cyrillic_line = bool(line_font)
        letters_height = size * CYRILLIC_SCALE if cyrillic_line else size  # libass makes a font's full height its size
        if row2 is not None:
            # ASS has no line spacing: an empty row as tall as the gap goes between the two rows.
            gap = int(style.get("lineSpacing") or 0)
            back = size * CYRILLIC_SCALE if line_font else size
            spacer = f"\\N{{\\fs{gap}}}\\h\\N{{\\fs{back:g}}}" if gap > 0 else "\\N"
            parts[row2] = spacer + parts[row2].lstrip()
        if draw_box:
            line_font += "\\bord0\\shad0"
            rows = ["".join(plain)] if row2 is None else ["".join(plain[:row2]).strip(), "".join(plain[row2:]).strip()]
            gap = int(style.get("lineSpacing") or 0)
            bottom = video_h - line_margin
            for r, row in enumerate(rows):
                row_bottom = bottom - (size + gap) * (len(rows) - 1 - r)
                # Two rows meet with no space, so a see-through box doesn't get darker where they overlap.
                above = BOX_PADDING if r == 0 else gap
                below = BOX_PADDING if r == len(rows) - 1 else 0
                row_height = size + above + below
                middle = row_bottom - size + (below - above + size) / 2
                box_width = text_width(row, style, size, spacing, cyrillic_line) + 2 * BOX_PADDING
                if motion == "bounce":  # the room kept between its words (word_places)
                    row_words = len(plain) if row2 is None else row2 if r == 0 else len(plain) - row2
                    box_width += (row_words - 1) * size * BOUNCE_WORD_GAP
                box = rounded_box(box_width, row_height, float(style.get("boxRadius") or 0))
                head = f"{{\\an5\\pos({video_w / 2:.0f},{middle:.0f})\\bord0\\shad0{box_fill}"
                events.append(f"Dialogue: 0,{ass_time(start / FPS)},{ass_time(end / FPS)},Default,,0,0,0,,{head}\\p1}}{pop_tags(motion, 0)}{box}{{\\p0}}")
        if motion == "bounce":
            row_step = size + int(style.get("lineSpacing") or 0)
            places = word_places(plain, row2, style, size, spacing, video_w, video_h - line_margin, row_step, letters_height, cyrillic_line)
            words = [spaced_marks(p.strip(), spacing) for p in plain]
            events += bounce_events(line, start, end, words, places, line_font, text_layer, highlight if look == "highlight" else None)
            continue
        line_font = f"{{{line_font}}}" if line_font else ""
        if row2 is not None and int(style.get("lineSpacing") or 0) < 0:
            # Rows closer than usual: ASS can't pull rows together, so each row is its own event, row_step apart like Bounce.
            step = size + int(style.get("lineSpacing") or 0)
            rows = [("".join(parts[:row2]), step), (parts[row2].removeprefix("\\N") + "".join(parts[row2 + 1:]), 0)]
            for row, lift in rows:
                events.append(f"Dialogue: {text_layer},{ass_time(start / FPS)},{ass_time(end / FPS)},Default,,0,0,{line_margin + lift},,{line_font}{pop_tags(motion, 0)}{row}")
            continue
        if look != "highlight":
            events.append(f"Dialogue: {text_layer},{ass_time(start / FPS)},{ass_time(end / FPS)},Default,,0,0,{line_margin},,{line_font}{pop_tags(motion, 0)}{''.join(parts)}")
            continue
        # Highlight: one event per word, that word in the brand colour until the next one starts.
        for k in range(len(line)):
            a = start if k == 0 else line[k]["start"]
            b = line[k + 1]["start"] if k + 1 < len(line) else end
            if b <= a:
                continue
            since = (a - start) / FPS * 1000  # ms since the line started
            text = ""
            for j, p in enumerate(parts):
                coloured = j == k
                on = f"\\1c{highlight}" if coloured else ""
                off = f"\\1c{ass_colour(style.get('textColor', '#FFFFFF'))}" if coloured else ""
                text += f"{{{on}}}{p}{{{off}}}" if on else p
            events.append(f"Dialogue: {text_layer},{ass_time(a / FPS)},{ass_time(b / FPS)},Default,,0,0,{line_margin},,{line_font}{pop_tags(motion, since)}{text}")

    # Box: the outline becomes a dark box behind each line (BorderStyle 3) with no shadow.
    boxed = look == "box"
    border_style, border, shadow = (3, BOX_PADDING, 0) if boxed else (1, outline, 2)
    outline_colour = f"{alpha_of(float(style.get('boxOpacity', 0.75)))[:-1]}{ass_colour(style.get('boxColor', '#000000'))[4:-1]}" if boxed else ass_colour(style.get("outlineColor", "#000000"))[:-1]

    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {video_w}",
            f"PlayResY: {video_h}",
            "WrapStyle: 0",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{font},{size},{ass_colour(style.get('textColor', '#FFFFFF'))[:-1]},&H00FFFFFF,{outline_colour},&H64000000,"
            # Bold stays off: the weight comes from the font name (e.g. "Kanit Medium").
            f"0,0,0,0,100,100,{int(style.get('letterSpacing') or 0)},0,{border_style},{border},{shadow},2,80,80,{margin_v},1",
            f"Style: Banner,{font},{BANNER['size']},{ass_colour(banner_ink(brand))[:-1]},&H00FFFFFF,{ass_colour(brand)[:-1]},&H00000000,"
            f"0,0,0,0,100,100,0,0,3,{BANNER['padding']},0,8,80,80,0,1",
            f"Style: Logo,{font},{LOGO['size']},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,"
            f"0,0,0,0,100,100,0,0,1,{LOGO['outline']},0,{logo_align},{LOGO['side']},{LOGO['side']},{LOGO['top']},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )


def has_audio(path: Path) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
    )
    return bool(out.stdout.strip())


FACE_HEIGHT = 0.4  # a face is placed this far down the frame when there's room to move
FACE_EDGE = 0.15  # zoom never centres closer than this to an edge


def focus_for(faces: dict | None, start: float, end: float) -> tuple[float, float] | None:
    """The face to frame for source seconds [start, end]: the middle of the faces seen then, else of
    all faces in the video, else none. Same as focusFor in src/lib/framing.ts."""
    found = (faces or {}).get("faces") or []
    if not found:
        return None
    inside = [f for f in found if start <= f[0] <= end]
    pick = inside or found

    def median(values: list[float]) -> float:
        values = sorted(values)
        return values[(len(values) - 1) // 2]

    return median([f[1] for f in pick]), median([f[2] for f in pick])


def frame_at_one(
    aspect: float, focus: tuple[float, float] | None, size: tuple[int, int]
) -> tuple[float, float, float, float, float, float]:
    """The picture before any zoom: its size, the crop's corner, and the point zoom grows around."""
    W, H = size
    w0 = max(W, H * aspect)
    h0 = w0 / aspect
    fx, fy = focus if focus else (0.5, 0.5)
    cx = min(max(fx * w0 - W / 2, 0), w0 - W)
    cy = min(max(fy * h0 - (FACE_HEIGHT if focus else 0.5) * H, 0), h0 - H)
    if focus:
        ox = min(max((fx * w0 - cx) / W, FACE_EDGE), 1 - FACE_EDGE) * W
        oy = min(max((fy * h0 - cy) / H, FACE_EDGE), 1 - FACE_EDGE) * H
    else:
        ox, oy = ZOOM_ORIGIN[0] * W, ZOOM_ORIGIN[1] * H
    return w0, h0, cx, cy, ox, oy


def frame_piece(
    aspect: float, focus: tuple[float, float] | None, zoom: float, size: tuple[int, int] = (WIDTH, HEIGHT)
) -> tuple[float, float, float, float]:
    """Where the whole source picture goes in the final video's frame (x, y, w, h): cropped around
    the face, zoomed around it. Same as framePiece in src/lib/framing.ts."""
    w0, h0, cx, cy, ox, oy = frame_at_one(aspect, focus, size)
    return -(cx * zoom + ox * (zoom - 1)), -(cy * zoom + oy * (zoom - 1)), w0 * zoom, h0 * zoom


def piece_filter(aspect: float, focus: tuple[float, float] | None, zoom: float, size: tuple[int, int] = (WIDTH, HEIGHT)) -> str:
    """ffmpeg: scale the picture to its framed size, then cut the final video's window out of it."""
    W, H = size
    x, y, w, h = frame_piece(aspect, focus, zoom, size)
    sw, sh = max(W, round(w / 2) * 2), max(H, round(h / 2) * 2)
    px, py = min(max(round(-x), 0), sw - W), min(max(round(-y), 0), sh - H)
    return f"scale={sw}:{sh},crop={W}:{H}:{px}:{py}"


def no_zoom_frames(segments: list[tuple[int, int, int]], spans: list[dict] | None) -> list[tuple[int, int]]:
    """Parts with zoom turned off (source seconds) as frames of the final video: [from, to), merged
    where they touch. Same as noZoomFrames in src/lib/zoom.ts."""
    ranges = []
    for start, trim, frames in segments:
        for n in spans or []:
            a, b = max(js_round(n["start"] * FPS), trim), min(js_round(n["end"] * FPS), trim + frames)
            if b > a:
                ranges.append((start + a - trim, start + b - trim))
    merged: list[tuple[int, int]] = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def zoom_part_frames(segments: list[tuple[int, int, int]], parts: list[dict] | None) -> list[tuple[int, int, str]]:
    """Zoom parts (source seconds, each with its own kind) as frames of the final video: (from, to, kind).
    A part across a cut is one run, so its zoom carries on over the cut. Same as zoomPartFrames in src/lib/zoom.ts."""
    runs = []
    for n in parts or []:
        if n.get("zoom") not in PART_ZOOMS:
            continue
        run = None
        for start, trim, frames in segments:
            a, b = max(js_round(n["start"] * FPS), trim), min(js_round(n["end"] * FPS), trim + frames)
            if b <= a:
                continue
            lo, hi = start + a - trim, start + b - trim
            if run and lo == run[1]:
                run[1] = hi
            else:
                if run:
                    runs.append(tuple(run))
                run = [lo, hi, n["zoom"]]
        if run:
            runs.append(tuple(run))
    return sorted(runs)


def part_zoom_expr(start: int, run: tuple[int, int, str], amount: float = ZOOM) -> str:
    """A zoom part's zoom as an ffmpeg expression of the frame number (`in` counts from 1) of a shot
    starting at output frame `start`. Same as partZoom in src/lib/zoom.ts."""
    lo, hi, kind = run
    frame = f"(in-1+{start})"
    length = hi - lo
    if kind == "smooth":
        return f"(1+{amount - 1:.4f}*sin(PI*({frame}-{lo})/{length}))"
    x = f"min(1,({frame}-{lo})/{min(length, PART_GLIDE * FPS)})"
    k = f"({x}*{x}*(3-2*{x}))"
    return f"(1+{amount - 1:.4f}*{k if kind == 'in' else f'(1-{k})'})"


def zoom_shots(
    segments: list[tuple[int, int, int]], off: list[tuple[int, int]], zoom: str, amount: float = ZOOM, runs: list[tuple[int, int, str]] | None = None
) -> list[tuple[int, int, int, int, float, tuple[int, int, str] | None]]:
    """The picture's parts: (piece number, output frame, source frame, frame count, zoom, zoom part). A jump
    happens at every other cut, where a no-zoom part starts or ends inside a piece, and at the edges of
    zoom parts. Same levels as the "cuts" mode of zoomTrack in src/lib/zoom.ts. Inside a zoom part
    (runs), the part's own kind decides."""
    shots = []
    for i, (start, trim, frames) in enumerate(segments):
        marks = {0, frames}
        if zoom == "cuts":
            marks |= {min(max(edge - start, 0), frames) for r in off for edge in r}
        marks |= {min(max(edge - start, 0), frames) for r in runs or [] for edge in r[:2]}
        ordered = sorted(marks)
        for a, b in zip(ordered, ordered[1:]):
            run = next((r for r in runs or [] if r[0] <= start + a and start + b <= r[1]), None)
            inside = any(x <= start + a and start + b <= y for x, y in off)
            level = amount if (run and run[2] == "cuts") or (not run and zoom == "cuts" and i % 2 == 1 and not inside) else 1.0
            shots.append((i, start + a, trim + a, b - a, level, run))
    return shots


def zoom_ramps(segments: list[tuple[int, int, int]], period: float) -> list[int]:
    """Zoom in and out: the frame each kept piece's glide started on. A new glide starts at the first cut
    after the last one finished, so the jump back is hidden by a cut. Same as zoomRamps in src/lib/zoom.ts."""
    ramp, ramps = 0, []
    for start, _, _ in segments:
        if start - ramp >= period * FPS:
            ramp = start
        ramps.append(ramp)
    return ramps


def smooth_zoom_expr(start: int, frames: int, off: list[tuple[int, int]], amount: float = ZOOM, period: float = SMOOTH_PERIOD, mode: str = "smooth", ramp: int = 0) -> str:
    """The zoom of a piece as an ffmpeg expression of its frame number (`in` counts from 1). Same as
    the "smooth", "in" and "out" modes of zoomTrack in src/lib/zoom.ts. ramp: where this piece's glide started."""
    frame = f"(in-1+{start})"
    fade = SMOOTH_FADE * FPS
    glide = f"min(1,({frame}-{ramp})/{period * FPS})"
    k = {"in": f"({glide})", "out": f"(1-{glide})"}.get(mode, f"(0.5-0.5*cos(2*PI*{frame}/{period * FPS}))")
    for a, b in off:
        if a - fade <= start + frames and b + fade >= start:  # only the parts near this piece
            x = f"clip(max(max({a}-{frame},{frame}-{b}),0)/{fade},0,1)"
            k += f"*({x}*{x}*(3-2*{x}))"
    return f"(1+{amount - 1:.4f}*{k})"


def smooth_filter(aspect: float, focus: tuple[float, float] | None, zoom_expr: str, size: tuple[int, int], amount: float = ZOOM) -> str:
    """ffmpeg: the piece with its zoom changing every frame. Scale and crop only move in whole pixels,
    which shakes a slow zoom, so `perspective` does the zoom instead (it places the picture between
    pixels). It works on a copy as big as the closest zoom, so a sharp source stays sharp, then shrinks."""
    W, H = size
    w0, h0, cx, cy, ox, oy = frame_at_one(aspect, focus, size)
    bw, bh = round(W * amount / 2) * 2, round(H * amount / 2) * 2
    kx, ky = bw / W, bh / H
    sw, sh = max(bw, round(w0 * kx / 2) * 2), max(bh, round(h0 * ky / 2) * 2)
    px, py = min(max(round(cx * kx), 0), sw - bw), min(max(round(cy * ky), 0), sh - bh)
    ox, oy = ox * kx, oy * ky
    corner = lambda p, o: f"(({p}+{o:.3f}*({zoom_expr}-1))/{zoom_expr})"
    left, right, top, bottom = corner(0, ox), corner(bw, ox), corner(0, oy), corner(bh, oy)
    return (
        f"scale={sw}:{sh},crop={bw}:{bh}:{px}:{py},"
        f"perspective=x0='{left}':y0='{top}':x1='{right}':y1='{top}':x2='{left}':y2='{bottom}':x3='{right}':y3='{bottom}'"
        f":interpolation=linear:eval=frame,scale={W}:{H}"
    )


def display_aspect(path: Path) -> float:
    """Width / height as the video is shown (phones store some videos sideways with a rotate flag)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", str(path)],
        capture_output=True,
        text=True,
    )
    stream = (json.loads(out.stdout or "{}").get("streams") or [{}])[0]
    w, h = stream.get("width") or 16, stream.get("height") or 9
    rotation = stream.get("tags", {}).get("rotate") or next((d.get("rotation") for d in stream.get("side_data_list", []) if "rotation" in d), 0)
    return h / w if abs(int(float(rotation))) % 180 == 90 else w / h


def cut_sound_parts(pieces: list[tuple[int, int, int]]) -> list[str]:
    """The sound of the pieces (frame_segments), joined as [ca]. Shared by the final video and cut_sound,
    so the sound polished next to the picture is cut sample for sample like the picture's own."""
    parts, labels = [], []
    for i, (_, trim, frames) in enumerate(pieces):
        a, b, length = trim / FPS, (trim + frames) / FPS, frames / FPS
        # A few ms fade in and out at every cut, so the sound doesn't click (FADE_SAMPLES in the preview).
        parts.append(
            f"[0:a]atrim=start={a:.6f}:end={b:.6f},asetpts=PTS-STARTPTS,apad=whole_dur={length:.6f},atrim=end={length:.6f},"
            f"afade=t=in:d={CUT_FADE},afade=t=out:st={max(0.0, length - CUT_FADE):.6f}:d={CUT_FADE}[a{i}]"
        )
        labels.append(f"[a{i}]")
    return parts + [f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1[ca]"]


def ffmpeg_command(
    src: Path,
    subs: Path,
    out: Path,
    keeps: list[tuple[float, float]],
    audio: bool,
    zoom: str = "off",
    fonts_dir: str | None = None,
    faces: dict | None = None,
    size: tuple[int, int] = (WIDTH, HEIGHT),
    logo: dict | None = None,
    no_zoom: list[dict] | None = None,
    zoom_amount: float = ZOOM,
    zoom_period: float = SMOOTH_PERIOD,
    zoom_parts: list[dict] | None = None,
    cutout: dict | None = None,
    banner_files: list[dict] | None = None,
    part: tuple[int, int] | None = None,
    frames: list[dict] | None = None,
    layouts: list[dict] | None = None,
) -> list[str]:
    """part: only these frames of the final video [from, to), without sound, for picture_parts (made side
    by side, then joined). Every layer goes by the time on the picture, so the part is moved to its place
    in the whole video and comes out exactly like that stretch of the whole one.
    logo: {"path", "size", "opacity", "at"}: a picture put in a corner under the subtitles.
    no_zoom: parts with Auto zoom turned off (source seconds). zoom_parts: parts with their own kind of zoom.
    cutout: {"behind": subtitles file, "matte": path, "inserts": [{"path", "kind", "start", ...}]} (cutout_filters).
    banner_files: uploaded banners, each a banner with "path" (banner_file_filters).
    frames: Frame Me, each with "art" (frame_art) and, for a picture or clip background, "path" (frame_filters).
    layouts: Layout, each with "path" when the other part is a picture or clip (layout_filters)."""
    banner_files = banner_files or []
    # A part only reads the frames that show in it: the others' mask and background would be read for nothing.
    framed = [f for f in frames or [] if not part or (float(f["start"]) * FPS < part[1] and float(f["end"]) * FPS > part[0])]
    # The same for layouts, with their flash's reach past each edge (layout_flashes).
    reach = LAYOUT_FLASH * FPS
    split_up = [l for l in layouts or [] if not part or (float(l["start"]) * FPS - reach < part[1] and float(l["end"]) * FPS + reach > part[0])]
    showing = [l for l in split_up if not part or (float(l["start"]) * FPS < part[1] and float(l["end"]) * FPS > part[0])]
    aspect = display_aspect(src)
    # The pieces in whole frames of the final video, as the preview has them (StudioPlayer): each piece's
    # picture and sound are exactly `frames` / FPS long, so nothing is held or skipped at the joins.
    pieces = frame_segments(keeps)
    off = no_zoom_frames(pieces, no_zoom)
    ramps = zoom_ramps(pieces, zoom_period)
    runs = zoom_part_frames(pieces, zoom_parts)
    parts, video_labels = [], []
    inputs: dict = {}
    extra = 1 + (1 if logo else 0)
    if cutout and cutout.get("matte"):
        inputs["matte"] = extra
        extra += 1
    if cutout:
        inputs["inserts"] = list(range(extra, extra + len(cutout.get("inserts") or [])))
        extra += len(cutout.get("inserts") or [])
    inputs["banners"] = list(range(extra, extra + len(banner_files)))
    extra += len(banner_files)
    inputs["frames"] = []
    for f in framed:
        reads = {"mask": extra, "border": None, "file": None}
        extra += 1
        if f["art"].get("border"):
            reads["border"] = extra
            extra += 1
        if f.get("back") == "file" and f.get("path"):
            reads["file"] = extra
            extra += 1
        inputs["frames"].append(reads)
    inputs["layouts"] = []
    for l in showing:
        inputs["layouts"].append(extra if l.get("path") else None)
        extra += 1 if l.get("path") else 0
    matte_labels = []
    # The picture may have more parts than the pieces (a no-zoom part can start inside a piece), so
    # picture and sound are joined separately. Both add up to the same whole frames.
    shots = zoom_shots(pieces, off, zoom, zoom_amount, runs)
    if part:
        # The shots inside the part, the ones at its edges shortened. A zoom goes by the frame number in the
        # whole video (out_frame), so a shortened shot zooms exactly as that stretch of the whole one.
        lo, hi = part
        shots = [(i, max(o, lo), t + max(o, lo) - o, min(o + n, hi) - max(o, lo), lv, rn) for i, o, t, n, lv, rn in shots if o < hi and o + n > lo]
        audio = False
    # A part jumps to a second before its first frame (-ss on the video and the matte): read from the start, a part
    # decoded the whole video before it only to throw it away, 16 s of a 3 min video's 1.2 s (12 Nov). Timestamps then
    # start at `seek`, so every trim is moved back by it; the second's margin keeps the cut away from where it lands.
    seek = max(0, math.floor(min(t for _, _, t, *_ in shots) / FPS) - 1) if part and shots else 0
    for k, (i, out_frame, trim, frames, level, run) in enumerate(shots):
        a, b = trim / FPS - seek, (trim + frames) / FPS - seek
        # Framed on its own (face crop, Auto zoom), so parts can differ before they are joined. The face
        # is found per whole piece, so it doesn't move at a no-zoom edge.
        piece_trim, piece_frames = pieces[i][1], pieces[i][2]
        focus = focus_for(faces, piece_trim / FPS, (piece_trim + piece_frames) / FPS)  # source seconds, not moved by seek
        if run and run[2] != "cuts":
            framing = smooth_filter(aspect, focus, part_zoom_expr(out_frame, run, zoom_amount), size, zoom_amount)
        elif not run and zoom in ("smooth", "in", "out"):
            framing = smooth_filter(aspect, focus, smooth_zoom_expr(out_frame, frames, off, zoom_amount, zoom_period, zoom, ramps[i]), size, zoom_amount)
        else:
            framing = piece_filter(aspect, focus, level, size)
        parts.append(
            f"[0:v]trim=start={a:.6f}:end={b:.6f},setpts=PTS-STARTPTS,fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration=1,trim=end_frame={frames},setpts=PTS-STARTPTS,"
            f"{framing},setsar=1[v{k}]"
        )
        video_labels.append(f"[v{k}]")
        if "matte" in inputs:
            # The speaker's matte (30 fps from 0, like the source) cut and framed exactly like the picture.
            parts.append(
                f"[{inputs['matte']}:v]format=yuv420p,trim=start={a:.6f}:end={b:.6f},setpts=PTS-STARTPTS,fps={FPS},"
                f"tpad=stop_mode=clone:stop_duration=1,trim=end_frame={frames},setpts=PTS-STARTPTS,"
                f"{framing},setsar=1[m{k}]"
            )
            matte_labels.append(f"[m{k}]")
    if audio:
        parts += cut_sound_parts(pieces)
    # A part starts at its own time in the whole video, so subtitles, banners and cutout layers land where they do there.
    # One spare frame at the end, cut off by -frames:v: an overlay of an uploaded banner or a cutout picture drops
    # the last frame, so the video came out a frame short, and in parts the sound slid a frame per part (11 Nov).
    # Counted in whole frames (1/FPS), not microseconds: 1/30 s rounded to microseconds put every third frame of a
    # fading cutout picture next to the neighbouring frame of the picture, and a part's start made it a different one.
    shift = f",settb=1/{FPS}" + (f",setpts=PTS+{part[0]}" if part and part[0] else "") + ",tpad=stop=1:stop_mode=clone"
    parts.append(f"{''.join(video_labels)}concat=n={len(video_labels)}:v=1:a=0{shift}[cv]")
    base = "[cv]"
    if matte_labels:
        parts.append(f"{''.join(matte_labels)}concat=n={len(matte_labels)}:v=1:a=0{shift}[cm]")
    plain = None
    if cutout and framed:
        # Frame Me's Blur blurs the picture without the Cutout layers, as the preview does (frame_filters).
        parts.append(f"{base}split=2[cvc][cvf]")
        base, plain = "[cvc]", "[cvf]"
    if cutout:
        base = cutout_filters(parts, base, size, cutout, inputs)
    if showing:
        # Only the layouts that show in this part; a part may hold just a flash's tail (split_up), drawn below.
        base = layout_filters(parts, base, size, showing, inputs["layouts"])
    if split_up:
        base = layout_flashes(parts, base, layout_flash_windows(split_up))
    if framed:
        base = frame_filters(parts, base, size, framed, inputs["frames"], plain)
    if banner_files:
        base = banner_file_filters(parts, base, size, banner_files, inputs["banners"])
    if logo:
        # Same place as the preview (PlayerFrame): LOGO side / top px from its corner, size px wide.
        side, edge = LOGO["side"], LOGO["top"]
        x = f"main_w-overlay_w-{side}" if str(logo["at"]).endswith("right") else str(side)
        y = f"main_h-overlay_h-{edge}" if str(logo["at"]).startswith("bottom") else str(edge)
        opacity = min(1.0, max(0.2, float(logo["opacity"])))
        parts.append(f"[1:v]scale={int(logo['size'])}:-1,format=rgba,colorchannelmixer=aa={opacity:.2f}[lg]")
        parts.append(f"{base}[lg]overlay={x}:{y}:format=auto[cl]")
        base = "[cl]"
    parts.append(
        f"{base}fps={FPS},"
        # shaping=complex: Thai tone marks sit above the vowels (simple shaping draws them on top of each other).
        f"ass={subs.name}:shaping=complex{f':fontsdir={fonts_dir}' if fonts_dir else ''}{',setpts=PTS-STARTPTS' if part else ''}[outv]"
    )

    jump = ["-ss", str(seek)] if seek else []
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *jump, "-i", str(src)]
    if logo:
        cmd += ["-i", str(logo["path"])]
    if cutout:
        if cutout.get("matte"):
            cmd += [*jump, "-i", str(cutout["matte"])]
        for ins in cutout.get("inserts") or []:
            # A picture is one frame: repeated for as long as it shows (trimmed in cutout_filters).
            # A GIF has its own frames: played as its file says. -stream_loop froze it on the first frame (test 11 Nov).
            still = ["-ignore_loop", "0"] if str(ins.get("file", "")).endswith(".gif") else ["-loop", "1", "-framerate", str(FPS)]
            cmd += (still if ins.get("kind") == "image" else []) + ["-i", str(ins["path"])]
    for b in banner_files:
        cmd += banner_file_input(b)
    still = ["-loop", "1", "-framerate", str(FPS)]
    for f in framed:
        cmd += [*still, "-i", str(f["art"]["mask"])]
        if f["art"].get("border"):
            cmd += [*still, "-i", str(f["art"]["border"])]
        if f.get("back") == "file" and f.get("path"):
            cmd += banner_file_input({"path": f["path"], "file": f.get("file", ""), "media": f.get("media")})
    for l in showing:
        if l.get("path"):
            cmd += banner_file_input({"path": l["path"], "file": l.get("file", ""), "media": l.get("media")})
    cmd += ["-filter_complex", ";".join(parts), "-map", "[outv]"]
    if audio:
        # The sound people get when Audio optimization is off or polish_sound failed.
        cmd += ["-map", "[ca]", "-c:a", "aac", "-b:a", "320k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
    # The last fps filter can add a frame at the very end: exactly as many frames as the pieces have.
    cmd += ["-frames:v", str(part[1] - part[0] if part else sum(frames for _, _, frames in pieces))]
    if part:
        # The parts share the machine: each encoder on its own share of it, not on every CPU (each one held ~1.9 GB).
        cmd += ["-threads", str(PART_THREADS)]
    cmd += ["-movflags", "+faststart", str(out)]
    return cmd


def put(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": content_type})
    with urllib.request.urlopen(req) as res:
        if res.status >= 300:
            raise RuntimeError(f"upload failed ({res.status})")


PROGRESS_EVERY = 3  # seconds between reports: the page looks about this often
# Share of the whole job (percent) each step ends at. The picture is by far the longest part.
PROGRESS_READY, PROGRESS_PICTURE, PROGRESS_SOUND = 10, 88, 96


def progress_reporter(url: str | None):
    """A function that tells the page how far the job is (0-99). It only ever goes up, and a report that
    can't be sent is skipped: showing a number must never be what makes a video fail."""
    last = {"at": 0.0, "percent": -1}
    turn = threading.Lock()  # the picture's parts report at the same time: one at a time, so it never goes back

    def report(percent: float, force: bool = False) -> None:
        value = min(99, int(percent))
        if not url:
            return
        with turn:
            now = time.monotonic()
            if value <= last["percent"] or (not force and now - last["at"] < PROGRESS_EVERY):
                return
            last.update(at=now, percent=value)
            send(value)  # inside the lock: two sends could otherwise arrive in the wrong order

    def send(value: int) -> None:
        try:
            request = urllib.request.Request(url, data=json.dumps({"percent": value}).encode(), method="PUT", headers={"Content-Type": "application/json"})
            urllib.request.urlopen(request, timeout=5).close()
        except Exception as err:
            print("progress report skipped:", err)

    return report


def run_counting_frames(cmd: list[str], cwd: Path, frames: int, on_part) -> tuple[int, str]:
    """Runs ffmpeg and calls on_part(0-1) as it makes the picture. Returns its exit code and error text.
    The errors go to a file: nothing reads them while it runs, and a full pipe would stop ffmpeg."""
    with tempfile.TemporaryFile("w+") as errors:
        job = subprocess.Popen([cmd[0], "-progress", "pipe:1", "-nostats", *cmd[1:]], cwd=cwd, stdout=subprocess.PIPE, stderr=errors, text=True)
        for line in job.stdout:
            if line.startswith("frame="):
                done = line[6:].strip()
                if done.isdigit():
                    on_part(int(done) / max(1, frames))
        job.wait()
        errors.seek(0)
        return job.returncode, errors.read()


# Studio sound on the final video, in this order: noise reduction (85%, all of it can sound hollow), cut the
# low rumble and the muddy 250 Hz, lift the clarity at 3.5 kHz, soften the s sounds, even out quiet and loud
# moments. Picked by ear on 9 Nov from five versions of a real clip.
VOICE_CHAIN = (
    # arnndn comes out exactly 480 samples (10 ms) late, measured. The slider mixes this with the sound as
    # recorded, and 10 ms apart the two cancel each other out, so the delay is taken out here. By samples,
    # not seconds: phone files start a little after 0 (21 ms on our test clip) and start=0.01 cut nothing.
    "aresample=48000,arnndn=m=/opt/rnnoise/cb.rnnn:mix=0.85,atrim=start_sample=480,asetpts=PTS-STARTPTS,apad=pad_len=480,"
    "highpass=f=80,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3500:t=q:w=1.0:g=2,"
    "deesser=i=0.3:m=0.5:f=0.5:s=o,acompressor=threshold=-22dB:ratio=2.5:attack=15:release=180:makeup=2"
)
TARGET_LUFS, PEAK_LIMIT_DB = -14.0, -1.5  # what the big platforms play at, with room for their own encoding
LOUDNESS = f"I={TARGET_LUFS}:TP={PEAK_LIMIT_DB}:LRA=11"  # for measuring
MAX_GAIN_DB = 20  # a very quiet recording is brought up this much at most, or its noise comes up with it
DEAD_SIDE_DB = 30  # one side this much quieter than the other: the mic only recorded on one side


def both_speakers(video: Path) -> str:
    """Audio optimization always plays on both speakers: a mono file or a clip-on mic that recorded on one
    side would otherwise come out of one ear. The ffmpeg filter that does it, ending in a comma."""
    stats = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(video), "-vn", "-af", "astats=measure_perchannel=RMS_level:measure_overall=none", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    levels = [float(x) for x in re.findall(r"RMS level dB: (\S+)", stats)]
    if len(levels) == 1:
        return "pan=stereo|c0=c0|c1=c0,"
    if len(levels) == 2 and abs(levels[0] - levels[1]) >= DEAD_SIDE_DB:
        live = 0 if levels[0] > levels[1] else 1
        return f"pan=stereo|c0=c{live}|c1=c{live},"
    return "aformat=channel_layouts=stereo,"


def voice_filter(media: Path, before: str = "") -> str | None:
    """VOICE_CHAIN and the loudness of this file, as one ffmpeg filter. None when it is silent from start to end."""
    # Measured once, then one fixed gain for the whole file. Not loudnorm itself: it changes its gain as the
    # sound changes when loud and quiet parts differ a lot, so the cut video came out 4 dB off the preview.
    probe = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(media), "-vn", "-af", f"{before}{VOICE_CHAIN},loudnorm={LOUDNESS}:print_format=json", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    m = json.loads(probe[probe.rindex("{") : probe.rindex("}") + 1])
    if not math.isfinite(float(m["input_i"])):
        return None
    # The limiter only touches the highest peaks. latency=1: without it the sound comes out late, and the slider mixes badly.
    gain = min(MAX_GAIN_DB, TARGET_LUFS - float(m["input_i"]))
    limit = 10 ** (PEAK_LIMIT_DB / 20)
    return f"{VOICE_CHAIN},volume={gain:.2f}dB,alimiter=limit={limit:.4f}:attack=5:release=50:level=false:latency=1,aresample=48000"


def polish_sound(source: Path, keeps: list[tuple[float, float]], sound: Path, amount: float = 1) -> Path | None:
    """Audio optimization of the cut video's sound, made from the uncut source while the picture is being
    made (render runs this next to it; it used to wait for the picture, ~45 s of a 5 min clip, measured 11 Nov).
    Cut by cut_sound_parts, exactly like the picture's own sound. Written to `sound` (AAC), None when there is
    nothing to polish; add_sound puts it on the video.
    amount: 0 = as recorded (on both speakers) .. 1 = fully optimized, in between the two are mixed, the same
    way the editor's preview mixes them (setSound in lib/player/engine.ts). The uncut source's loudness and
    sides are the ones used, like the preview (clean_preview), which can't know the cuts: measured after
    cutting, the video came out at another level than the slider had let them hear.
    A video with its plain sound beats no video, so a failure here only logs."""
    try:
        if not has_audio(source):
            return None
        amount = min(1.0, max(0.0, amount))
        stereo = both_speakers(source)
        voice = voice_filter(source, stereo) if amount > 0 else None
        if amount > 0 and voice is None:  # silent from start to end: nothing to bring up
            return None
        cut = ";".join(cut_sound_parts(frame_segments(keeps)))
        recorded = f"{stereo}aresample=48000,asetpts=PTS-STARTPTS"  # starts at 0, like the optimized sound does
        if voice is None:
            graph = f"{cut};[ca]{recorded}[s]"
        elif amount >= 1:
            graph = f"{cut};[ca]{stereo}{voice}[s]"
        else:
            graph = (
                f"{cut};[ca]{recorded},asplit=2[d][w];[d]volume={1 - amount:.3f}[dry];[w]{voice},volume={amount:.3f}[wet];"
                "[dry][wet]amix=inputs=2:normalize=0:duration=longest[s]"
            )
        result = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-filter_complex", graph, "-map", "[s]", "-vn"]
            + ["-c:a", "aac", "-b:a", "192k", str(sound)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-600:])
        return sound
    except Exception as err:
        print(f"sound not polished: {err}")
        return None


def plain_sound(source: Path, keeps: list[tuple[float, float]], sound: Path) -> Path | None:
    """The cut video's sound as recorded, for a picture made in parts (they have none). The same sound and
    bitrate the whole picture's own pass gives it (ffmpeg_command). None when the source has no sound."""
    if not has_audio(source):
        return None
    result = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-filter_complex", ";".join(cut_sound_parts(frame_segments(keeps)))]
        + ["-map", "[ca]", "-vn", "-c:a", "aac", "-b:a", "320k", str(sound)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on the sound: {result.stderr[-600:]}")
    return sound


def parts_sound(source: Path, keeps: list[tuple[float, float]], folder: Path, polish: bool, amount: float) -> tuple[Path | None, bool]:
    """The sound for a picture made in parts: polished (polish_sound) or, when it is off or failed, as recorded."""
    polished = polish_sound(source, keeps, folder / "sound.m4a", amount) if polish else None
    if polished:
        return polished, True
    return plain_sound(source, keeps, folder / "plain.m4a"), False


# Made in parts side by side: one ffmpeg makes the picture on about one CPU (Auto zoom's perspective most of all,
# 8 CPUs were no faster than 4), so a 60 s clip with Auto zoom took 27 s. Parts shorter than this aren't worth it.
PICTURE_PARTS = 4
PART_MIN_SECONDS = 15
PART_THREADS = 2


# A frame with cutout layers costs about this many plain frames: the matte is read, framed (Auto zoom's perspective)
# and laid on the picture. The matte was worked on for every frame of the video as soon as one layer was there, so a
# 5 min video took ~4 min to make instead of ~2 (coach, 12 Nov). Now only the parts with a layer have it (picture_parts).
CUTOUT_COST = 1.7  # 3 min test video with Auto zoom on Modal: 27.9 s with the matte on every frame, 16.4 s without (12 Nov)
BUSY_GAP_SECONDS = 10  # layers closer than this share one part: a part of its own costs a new ffmpeg reading the video
MOST_PARTS = 12


def cutout_busy(cutout: dict | None, frames: int) -> list[tuple[int, int]]:
    """The final video's frames [from, to) where a cutout layer shows (a text behind, a picture or clip), merged."""
    if not cutout:
        return []
    spans = sorted(
        (max(0, math.floor(float(x["start"]) * FPS) - 1), min(frames, math.ceil(float(x["end"]) * FPS) + 1))
        for x in [*(cutout.get("texts") or []), *(cutout.get("inserts") or [])]
    )
    busy: list[list[int]] = []
    for a, b in spans:
        if b <= a:
            continue
        if busy and a <= busy[-1][1]:
            busy[-1][1] = max(busy[-1][1], b)
        else:
            busy.append([a, b])
    return [(a, b) for a, b in busy]


def picture_parts(frames: int, busy: list[tuple[int, int]] | None = None) -> list[tuple[int, int, bool]]:
    """The final video's frames split into parts [from, to) made side by side, and whether each one has cutout layers.
    Without layers: nearly equal parts. With them: the parts start and end where the layers do, so the parts without
    one skip the matte, and the work is shared by how much each frame costs (CUTOUT_COST), not by its length."""
    count = max(1, min(PICTURE_PARTS, frames // (PART_MIN_SECONDS * FPS)))
    if not busy:
        edges = [round(frames * n / count) for n in range(count + 1)]
        return [(a, b, False) for a, b in zip(edges, edges[1:])]
    if count == 1:
        return [(0, frames, True)]
    gap = BUSY_GAP_SECONDS * FPS
    while True:
        # Layers close together are one busy stretch: the frames between them are cheaper made with them than apart.
        merged: list[list[int]] = []
        for a, b in busy:
            if merged and a - merged[-1][1] < gap:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        runs, at = [], 0
        for a, b in merged:
            if a - at >= 1:
                runs.append((at, a, False))
            runs.append((a, b, True))
            at = b
        if frames - at >= 1:
            runs.append((at, frames, False))
        if len(runs) <= MOST_PARTS or gap >= frames:
            break
        gap *= 2
    cost = lambda a, b, on: (b - a) * (CUTOUT_COST if on else 1)
    # Pieces of about half a CPU's share: the busy runs make them uneven, smaller ones even out on PICTURE_PARTS CPUs.
    share = sum(cost(*r) for r in runs) / (2 * count)
    parts = []
    for a, b, on in runs:
        n = max(1, min(2 * count, math.ceil(cost(a, b, on) / share - 0.05)))
        edges = [a + round((b - a) * k / n) for k in range(n + 1)]
        parts += [(x, y, on) for x, y in zip(edges, edges[1:]) if y > x]
    return parts


def run_parts(cmds: list[list[str]], cwd: Path, frames: list[int], on_part, costs: list[float] | None = None) -> tuple[int, str]:
    """Runs the parts' ffmpegs at the same time, on_part(0-1) for all of them together. Returns the first
    failure's exit code and error text (0, "" when all made it)."""
    done = [0.0] * len(cmds)

    def one(n: int) -> tuple[int, str]:
        def seen(share: float) -> None:
            done[n] = share * frames[n]
            on_part(sum(done) / max(1, sum(frames)))

        return run_counting_frames(cmds[n], cwd, frames[n], seen)

    # At most PICTURE_PARTS at a time (each holds ~1.9 GB), the costliest first so the last one to start is a short one.
    order = sorted(range(len(cmds)), key=lambda n: -(costs[n] if costs else frames[n]))
    with ThreadPoolExecutor(max_workers=min(len(cmds), PICTURE_PARTS)) as pool:
        results = list(pool.map(one, order))
    return next((r for r in results if r[0] != 0), (0, ""))


def join_parts(parts: list[Path], sound: Path | None, out: Path, frames: int) -> None:
    """The parts one after the other, and the sound, into the final video. Copied: nothing is encoded again."""
    listing = out.with_name("parts.txt")
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing)]
    if sound:
        cmd += ["-i", str(sound), "-map", "0:v:0", "-map", "1:a:0"]
    cmd += ["-c", "copy", "-movflags", "+faststart", str(out)]
    result = subprocess.run(cmd, cwd=out.parent, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed joining the parts: {result.stderr[-600:]}")
    if abs(duration_of(out) - frames / FPS) > 0.1:
        raise RuntimeError("the joined video came out at another length")


CLIP_SOUND_FADE = 0.25  # CLIP_SOUND.fade in lib/clip-sound.ts


def clip_sounds(cutout: dict | None, banner_files: list[dict], frames: list[dict] | None = None, layouts: list[dict] | None = None) -> list[dict]:
    """The uploaded clips that sound (a volume, Mute not ticked: lib/clip-sound.ts): Pic/Clip inserts, clip banners,
    Frame Me clip backgrounds and Layout clips."""
    clips = [i for i in (cutout or {}).get("inserts") or [] if i.get("kind") == "video"]
    clips += [b for b in banner_files if b.get("media") == "video"]
    clips += [f for f in frames or [] if f.get("back") == "file" and f.get("media") == "video" and f.get("path")]
    clips += [l for l in layouts or [] if l.get("media") == "video" and l.get("path")]
    return [c for c in clips if not c.get("muted") and float(c.get("volume") or 0) > 0 and has_audio(c["path"])]


def mix_clip_sounds(video: Path, clips: list[dict]) -> None:
    """Lays each clip's sound under the finished video's own, from when the clip shows until it goes or its sound ends,
    faded in and out like the preview (clipGain). Only the sound is made again; the picture is copied."""
    total = duration_of(video)
    own = has_audio(video)
    # The video's own sound padded with silence to the picture's length: amix stops with it (duration=first), and a sound
    # that ends early would cut off a clip that still shows (Codex review 12 Nov).
    parts = [f"[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur={total:.3f}[m]" if own else f"anullsrc=r=48000:cl=stereo,atrim=duration={total:.3f}[m]"]
    for k, c in enumerate(clips):
        a, b = float(c["start"]), float(c["end"])
        d, v = b - a, min(1.0, float(c["volume"]))
        parts.append(
            f"[{k + 1}:a]atrim=duration={d:.3f},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume={v:.2f},"
            f"afade=t=in:st=0:d={CLIP_SOUND_FADE},afade=t=out:st={max(0.0, d - CLIP_SOUND_FADE):.3f}:d={CLIP_SOUND_FADE},adelay=delays={round(a * 1000)}:all=1[c{k}]"
        )
    # normalize=0: each sound keeps its own level (amix would otherwise lower all of them); duration=first: the video's length.
    parts.append(f"[m]{''.join(f'[c{k}]' for k in range(len(clips)))}amix=inputs={len(clips) + 1}:normalize=0:duration=first:dropout_transition=0[a]")
    mixed = video.with_name("mixed.mp4")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video)]
    for c in clips:
        cmd += ["-i", str(c["path"])]
    cmd += ["-filter_complex", ";".join(parts), "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", str(mixed)]
    result = subprocess.run(cmd, cwd=video.parent, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed mixing the clips' sound: {result.stderr[-600:]}")
    if abs(duration_of(mixed) - total) > 0.1:
        raise RuntimeError("the video changed length when the clips' sound was mixed in")
    mixed.replace(video)


def add_sound(video: Path, sound: Path) -> bool:
    """Puts polish_sound's sound on the finished video in place of its plain one. Nothing is encoded again."""
    try:
        polished = video.with_name("polished.mp4")
        result = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video), "-i", str(sound), "-map", "0:v:0", "-map", "1:a:0"]
            + ["-c", "copy", "-movflags", "+faststart", str(polished)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-600:])
        if abs(duration_of(polished) - duration_of(video)) > 0.1:
            raise RuntimeError("the polished video changed length")
        polished.replace(video)
        return True
    except Exception as err:
        print(f"sound not polished: {err}")
        return False


# 8 GB: the picture is made in parts side by side (picture_parts), ~4 GB together on a 5 min clip, more with cutout pictures.
@app.function(image=image, cpu=4, memory=8192, timeout=30 * 60)
def render(video_url: str, edit: dict, output_url: str, error_url: str | None = None, style: dict | None = None, progress_url: str | None = None) -> dict:
    style = {**DEFAULT_STYLE, **(style or {})}
    sound_worker = ThreadPoolExecutor(max_workers=1)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            src, subs, out = workdir / "source", workdir / "subs.ass", workdir / "final.mp4"
            report = progress_reporter(progress_url)
            report(1, force=True)

            urllib.request.urlretrieve(video_url, src)

            keeps = keep_segments(edit["duration"], edit.get("cuts", []))
            if not keeps:
                raise RuntimeError("nothing left after cutting")
            # The sound is polished next to the picture: it only needs the source and the cuts. The picture
            # uses most of the machine but not all of it (8 CPUs made it no faster than 4, measured 11 Nov).
            frames = sum(count for _, _, count in frame_segments(keeps))
            spans = picture_parts(frames)  # made again below with the cutout layers: the same count, 1 or more
            amount, polish = float(style.get("audioAmount", 1)), bool(style.get("audio", True))
            polishing = None
            if len(spans) > 1:  # the parts have no sound: this makes it, polished or not
                polishing = sound_worker.submit(parts_sound, src, keeps, workdir, polish, amount)
            elif polish:
                polishing = sound_worker.submit(polish_sound, src, keeps, workdir / "sound.m4a", amount)

            # The user's own font: libass also looks in this folder. Sent for the subtitles or a banner's font.
            fonts_dir = None
            if style.get("fontUrl"):
                (workdir / "fonts").mkdir()
                urllib.request.urlretrieve(style["fontUrl"], workdir / "fonts" / "own.ttf")
                fonts_dir = "fonts"
                style["_ownFontPath"] = str(workdir / "fonts" / "own.ttf")
            subs.write_text(build_subtitles(edit.get("words", []), keeps, style, edit.get("banners")), encoding="utf-8")

            # Cutout layers (behind.ts): sent by the app with links to the matte and each picture or clip.
            cutout = None
            layers = edit.get("cutout") or {}
            if layers.get("texts") or layers.get("inserts"):
                cutout = {"fontsdir": fonts_dir, "inserts": [], "texts": layers.get("texts") or []}
                if layers.get("texts"):
                    (workdir / "behind.ass").write_text(build_behind(layers["texts"], style.get("format", "9:16")), encoding="utf-8")
                    cutout["behind"] = "behind.ass"
                if layers.get("matteUrl"):
                    urllib.request.urlretrieve(layers["matteUrl"], workdir / "matte.mp4")
                    cutout["matte"] = workdir / "matte.mp4"
                for n, ins in enumerate(layers.get("inserts") or []):
                    link = (layers.get("files") or {}).get(ins.get("file"))
                    if not link:
                        continue
                    path = workdir / f"insert-{n}"
                    urllib.request.urlretrieve(link, path)
                    cutout["inserts"].append({**ins, "path": path})

            # Uploaded banners (kind "file"): the app sends a link to each one's file (bannerFiles).
            banner_files = []
            links = edit.get("bannerFiles") or {}
            for n, b in enumerate(edit.get("banners") or []):
                link = links.get(b.get("file")) if b.get("kind") == "file" else None
                if not link:
                    continue
                path = workdir / f"banner-{n}"
                urllib.request.urlretrieve(link, path)
                banner_files.append({**b, "path": path})

            # Frame Me (frame-me.ts): each one's shape and border drawn once, and a link to a picture or clip background.
            # Not "frames": that is the video's frame count above, and a list there broke every Make video (13 Nov).
            frame_list = []
            frame_links = edit.get("frameFiles") or {}
            for n, f in enumerate(edit.get("frames") or []):
                f = {**f, "art": frame_art(f, FORMATS.get(style.get("format"), (WIDTH, HEIGHT)), workdir, n)}
                link = frame_links.get(f.get("file")) if f.get("back") == "file" else None
                if link:
                    f["path"] = workdir / f"frame-back-{n}"
                    urllib.request.urlretrieve(link, f["path"])
                elif f.get("back") == "file":
                    f["back"] = "blur"  # its file is gone: the blurred video, rather than no video
                frame_list.append(f)

            # Layout (layout.ts): a link to each one's picture or clip comes with Frame Me's (frameFiles, by file name).
            layout_list = []
            for n, l in enumerate(edit.get("layouts") or []):
                link = frame_links.get(l.get("file")) if l.get("file") else None
                if link:
                    l = {**l, "path": workdir / f"layout-file-{n}"}
                    urllib.request.urlretrieve(link, l["path"])
                else:
                    l = {k: v for k, v in l.items() if k not in ("file", "media")}  # its file is gone: its colour instead
                layout_list.append(l)

            # The user's logo picture, if this look shows it.
            logo = None
            if style.get("logoUrl"):
                logo_path = workdir / "logo"
                urllib.request.urlretrieve(style["logoUrl"], logo_path)
                logo = {"path": logo_path, "size": style.get("logoSize", 180), "opacity": style.get("logoOpacity", 1), "at": style.get("logoAt", "top-left")}

            report(PROGRESS_READY, force=True)
            command = lambda path, part=None, cut=cutout: ffmpeg_command(
                src,
                subs,
                path,
                keeps,
                has_audio(src),
                style.get("zoom", "off"),
                fonts_dir,
                edit.get("faces"),
                FORMATS.get(style.get("format"), (WIDTH, HEIGHT)),
                logo,
                edit.get("noZoom"),
                float(style.get("zoomAmount") or ZOOM),
                float(style.get("zoomPeriod") or SMOOTH_PERIOD),
                edit.get("zoomParts"),
                cut,
                banner_files,
                part,
                frame_list,
                layout_list,
            )
            picture = lambda part: report(PROGRESS_READY + min(1.0, part) * (PROGRESS_PICTURE - PROGRESS_READY))
            if len(spans) > 1:
                # A part without a cutout layer is made without the matte: the same picture there, much faster.
                spans = picture_parts(frames, cutout_busy(cutout, frames))
                files = [workdir / f"part-{n}.mp4" for n in range(len(spans))]
                code, errors = run_parts(
                    [command(f, (a, b), cutout if on else None) for f, (a, b, on) in zip(files, spans)],
                    workdir,
                    [b - a for a, b, _ in spans],
                    picture,
                    [(b - a) * (CUTOUT_COST if on else 1) for a, b, on in spans],
                )
            else:
                code, errors = run_counting_frames(command(out), workdir, frames, picture)
            if code != 0:
                raise RuntimeError(f"ffmpeg failed: {errors[-1500:]}")

            report(PROGRESS_PICTURE, force=True)
            if len(spans) > 1:
                track, sound = polishing.result()
                join_parts(files, track, out, frames)
            else:
                polished = polishing.result() if polishing else None
                sound = add_sound(out, polished) if polished else False
            clips = clip_sounds(cutout, banner_files, frame_list, layout_list)
            if clips:
                mix_clip_sounds(out, clips)
            report(PROGRESS_SOUND, force=True)
            put(output_url, out.read_bytes(), "video/mp4")
            return {"ok": True, "seconds": round(sum(b - a for a, b in keeps), 2), "bytes": out.stat().st_size, "sound": sound}
    except Exception as err:
        if error_url:
            put(error_url, json.dumps({"error": str(err)}).encode(), "application/json")
        raise
    finally:
        # A failed video's sound is let finish (a minute at most), after its error was saved for the page: left
        # running, its ffmpeg would take the machine's CPU from the next video Modal gives this container.
        sound_worker.shutdown(wait=True, cancel_futures=True)


PROXY_SIDE = 540  # px, the short side; the preview is at most ~440px wide on screen
PROXY_KEYFRAME_FRAMES = 15  # a full picture every half second at 30 fps
PROXY_AUDIO_RATE = 24000  # Hz, mono, 16-bit: plenty for speech, and no codec to decode in the browser


def duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip() or 0)


SOUND_ON_PICTURE_CLOCK = "aresample=async=1:first_pts=0"  # adds silence for a late start, drops an early one


def proxy_command(src: Path, out: Path, pcm: Path, audio: bool) -> list[str]:
    # Camera files store a full picture only every 1-2 s, so jumping to a cut means decoding up to
    # 2 s of video first: that was the stutter at every cut in the browser preview. This copy is
    # small, has a full picture every half second, and skips the decoding tricks that cost time.
    # No B-frames (-bf 0): frames come out of the decoder in the order they are shown, which the
    # editor's own player relies on.
    # The sound also goes out as raw samples (pcm): the player cuts and joins it sample-exact.
    side = PROXY_SIDE
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if not audio:
        # Silence as long as the video, so every video has a sound file to keep time with.
        cmd += ["-f", "lavfi", "-t", f"{duration_of(src):.3f}", "-i", f"anullsrc=r={PROXY_AUDIO_RATE}:cl=mono"]
    sound = "0:a:0" if audio else "1:a:0"
    cmd += ["-map", "0:v:0", "-map", sound, "-c:a", "aac", "-b:a", "128k"]
    cmd += ["-vf", f"scale='if(gt(iw,ih),-2,{side})':'if(gt(iw,ih),{side},-2)',fps={FPS},format=yuv420p"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-tune", "fastdecode", "-bf", "0"]
    cmd += ["-g", str(PROXY_KEYFRAME_FRAMES), "-keyint_min", str(PROXY_KEYFRAME_FRAMES), "-sc_threshold", "0"]
    cmd += ["-movflags", "+faststart", str(out)]
    # On the picture's clock: phone files often start their sound after the picture (122 ms on a real clip),
    # and raw samples have no timestamps, so without this the preview played that much ahead of the picture.
    cmd += ["-map", sound, "-af", SOUND_ON_PICTURE_CLOCK, "-ac", "1", "-ar", str(PROXY_AUDIO_RATE), "-f", "s16le", str(pcm)]
    return cmd


FACES_PER_SECOND = 2
FACE_SCAN_SIDE = 360  # px, the short side faces are looked for at


def detect_faces(path: Path) -> dict:
    """Where the speaker's face is, twice a second: [seconds, centre x, centre y, width] (0..1 of the
    picture), the biggest face only. Uses OpenCV's built-in face finder: no model to download.
    Read by focusFor in src/lib/framing.ts."""
    import cv2

    finder = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    video = cv2.VideoCapture(str(path))
    fps = video.get(cv2.CAP_PROP_FPS) or FPS
    step = max(1, round(fps / FACES_PER_SECOND))
    width = height = 0
    faces, index = [], 0
    while video.grab():
        if index % step == 0:
            ok, frame = video.retrieve()
            if ok:
                height, width = frame.shape[:2]
                scale = FACE_SCAN_SIDE / min(width, height)
                small = cv2.cvtColor(cv2.resize(frame, (round(width * scale), round(height * scale))), cv2.COLOR_BGR2GRAY)
                side = min(small.shape[:2])
                found = finder.detectMultiScale(small, scaleFactor=1.1, minNeighbors=5, minSize=(side // 10, side // 10))
                if len(found):
                    x, y, w, h = max(found, key=lambda f: f[2] * f[3])
                    sw, sh = small.shape[1], small.shape[0]
                    faces.append([round(index / fps, 2), round((x + w / 2) / sw, 3), round((y + h / 2) / sh, 3), round(w / sw, 3)])
        index += 1
    video.release()
    return {"width": width, "height": height, "faces": faces}


THUMB_WIDTH = 270  # px, the picture for My projects


def make_thumb(video: Path, thumb: Path) -> None:
    """One picture from a second in (or the middle of a short video), for My projects."""
    at = min(1.0, duration_of(video) / 2)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2", "-q:v", "4", str(thumb)],
        check=True,
    )


@app.function(image=image, cpu=2, memory=2048, timeout=30 * 60)
def faces(video_url: str, faces_url: str, thumb_url: str | None = None) -> dict:
    """Where the face is (and the My projects picture), for a preview copy made before these existed."""
    with tempfile.TemporaryDirectory() as tmp:
        src, thumb = Path(tmp) / "proxy.mp4", Path(tmp) / "thumb.jpg"
        urllib.request.urlretrieve(video_url, src)
        if thumb_url:
            make_thumb(src, thumb)
            put(thumb_url, thumb.read_bytes(), "image/jpeg")
        found = detect_faces(src)
        put(faces_url, json.dumps(found).encode(), "application/json")
        return {"ok": True, "faces": len(found["faces"])}


def clean_preview(src: Path, pcm: Path, clean: Path) -> bytes:
    """The fully optimized sound for the editor's slider, sample for sample as long as the sound as recorded
    (pcm), so the player can mix the two. If it can't be made, the sound as recorded: never lose the preview."""
    plain = pcm.read_bytes()
    try:
        stereo = both_speakers(src) if has_audio(src) else ""  # as in polish_sound: same loudness from a one-sided mic
        voice = voice_filter(src, stereo) if has_audio(src) else None
        if voice is None:
            return plain
        result = subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vn", "-af", f"{SOUND_ON_PICTURE_CLOCK},{stereo}{voice},aresample={PROXY_AUDIO_RATE}", "-ac", "1", "-f", "s16le", str(clean)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-600:])
        return clean.read_bytes()[: len(plain)].ljust(len(plain), b"\0")
    except Exception as err:
        print(f"clean preview failed: {err}")
        return plain


@app.function(image=image, cpu=4, memory=4096, timeout=30 * 60)
def proxy(
    video_url: str,
    output_url: str,
    error_url: str | None = None,
    audio_url: str | None = None,
    faces_url: str | None = None,
    thumb_url: str | None = None,
    clean_audio_url: str | None = None,
) -> dict:
    """The editor's preview copy: same timing as the original, just smaller and quick to jump around in."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            src, out, pcm = workdir / "source", workdir / "proxy.mp4", workdir / "proxy-audio.pcm"
            urllib.request.urlretrieve(video_url, src)
            result = subprocess.run(proxy_command(src, out, pcm, has_audio(src)), capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr[-1500:]}")
            # Where the face is, from the small copy (quick). Without it the video is framed in the middle.
            if faces_url:
                try:
                    put(faces_url, json.dumps(detect_faces(out)).encode(), "application/json")
                except Exception as err:  # never lose the preview copy over this
                    print("faces failed:", err)
            if thumb_url:
                try:
                    make_thumb(out, workdir / "thumb.jpg")
                    put(thumb_url, (workdir / "thumb.jpg").read_bytes(), "image/jpeg")
                except Exception as err:
                    print("thumb failed:", err)
            # Sound first: the website takes proxy.mp4 existing to mean everything is there.
            if clean_audio_url:
                put(clean_audio_url, clean_preview(src, pcm, workdir / "proxy-audio-clean.pcm"), "application/octet-stream")
            if audio_url:
                put(audio_url, pcm.read_bytes(), "application/octet-stream")
            put(output_url, out.read_bytes(), "video/mp4")
            return {"ok": True, "bytes": out.stat().st_size, "audioBytes": pcm.stat().st_size}
    except Exception as err:
        if error_url:
            put(error_url, json.dumps({"error": str(err)}).encode(), "application/json")
        raise


@app.function(image=image, secrets=[modal.Secret.from_name("komoray-render")])
@modal.fastapi_endpoint(method="POST")
def start(body: dict) -> dict:
    """Called by komoray.com. Starts a render (or, with kind "proxy", a preview copy) in the background."""
    if not hmac.compare_digest(str(body.get("token", "")), os.environ["RENDER_TOKEN"]):
        return {"error": "unauthorized"}
    if body.get("kind") == "proxy":
        call = proxy.spawn(body["videoUrl"], body["outputUrl"], body.get("errorUrl"), body.get("audioUrl"), body.get("facesUrl"), body.get("thumbUrl"), body.get("cleanAudioUrl"))
    elif body.get("kind") == "faces":
        call = faces.spawn(body["videoUrl"], body["facesUrl"], body.get("thumbUrl"))
    else:
        call = render.spawn(body["videoUrl"], body["edit"], body["outputUrl"], body.get("errorUrl"), body.get("style"), body.get("progressUrl"))
    return {"callId": call.object_id}


@app.local_entrypoint()
def main(job: str):
    """Manual test: python -m modal run modal_app/render.py --job job.json (a job without "edit" makes a proxy)"""
    spec = json.loads(Path(job).read_text(encoding="utf-8"))
    if "edit" not in spec:
        print(proxy.remote(spec["videoUrl"], spec["outputUrl"], spec.get("errorUrl"), spec.get("audioUrl")))
        return
    print(render.remote(spec["videoUrl"], spec["edit"], spec["outputUrl"], spec.get("errorUrl"), spec.get("style")))
