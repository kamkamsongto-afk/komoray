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
import urllib.request
from pathlib import Path

import modal

app = modal.App("komoray-render")

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
                ("firasans", "FiraSans-Medium.ttf"),
            ]
        ],
        "fc-cache -f",
    )
    .pip_install("fastapi[standard]", "opencv-python-headless==4.10.0.84", "numpy<2.3")
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
}
# None of FONTS has Russian-style letters: text with them uses this one, or libass picks a system font
# (too big, words nearly touching). Same as CYRILLIC_FONT in src/lib/subtitle-style.ts.
# libass makes a font's full height the font size: Kanit's is 1.58 ems, this one's 1.2, so this one is
# asked for smaller to draw letters as big as Kanit's.
CYRILLIC_FONT = "Fira Sans Medium"
CYRILLIC_SCALE = 1.2 / 1.58
BOX_PADDING = 20  # the Box look: space around the letters, px
LOGO = {"size": 52, "outline": 4, "side": 60, "top": 110}  # the channel name in a corner (LOGO in PlayerFrame.tsx)


# Banners (src/lib/banners.ts): sizes in px, fade in seconds, top of each place.
BANNER = {"size": 72, "sub_size": 44, "padding": 28, "fade": 0.25}
BANNER_SCALE = (0.5, 2.5)  # smallest and biggest size (BANNER_SCALE in banners.ts)
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


def banner_events(banners: list[dict], height: int = HEIGHT, shape: str = "9:16", own_font: bool = False) -> list[str]:
    """One event per banner, faded in and out, in its place, or with its middle where it was dragged
    (x, y: share of the width / height), at its size (scale). Text was checked by the app (readBanners)."""
    events = []
    fade = int(BANNER["fade"] * 1000)
    width = FORMATS.get(shape, (WIDTH, HEIGHT))[0]
    for b in banners:
        start, end = float(b.get("start", 0)), float(b.get("end", 0))
        text = ass_text(str(b.get("text", ""))).strip()
        if end <= start or not text:
            continue
        size = min(BANNER_SCALE[1], max(BANNER_SCALE[0], float(b.get("scale") or 1)))
        pad_x, pad_y = js_round(BANNER["padding"] * size), js_round(BANNER["padding"] / 2 * size)
        x, y = b.get("x"), b.get("y")
        spot = f"\\an5\\pos({js_round(float(x) * width)},{js_round(float(y) * height)})" if x is not None and y is not None else ""
        scale = f"\\fscx{size * 100:g}\\fscy{size * 100:g}" if size != 1 else ""
        sub = ass_text(str(b.get("sub", ""))).strip()
        font = font_tag(text + sub, own_font, BANNER["size"])
        sub_size = BANNER["sub_size"] * (CYRILLIC_SCALE if font else 1)
        body = f"{{{spot}{font}\\fad({fade},{fade})\\xbord{pad_x}\\ybord{pad_y}{scale}}}{text}" + (f"\\N{{\\fs{sub_size:g}}}{sub}" if sub else "")
        places = BANNER_TOP.get(shape, BANNER_TOP["9:16"])
        top = js_round(places.get(b.get("place"), places["top"]) * height)
        events.append(f"Dialogue: 2,{ass_time(start)},{ass_time(end)},Banner,,0,0,{top},,{body}")
    return events


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
    "letterSpacing": 0,  # px between letters
    "lineSpacing": 0,  # px added between the rows of the Two lines look
    "color": "#FFE600",  # brand colour: the Highlight look's word
    "logo": "",  # channel name in a corner, "" = none
    "logoAt": "top-left",  # or top-right, bottom-left, bottom-right
    "logoSize": 180,  # the logo picture's width, px (logoUrl: a link to the picture, sent by the app)
    "logoOpacity": 1,
    "zoom": "off",  # Auto zoom: "cuts" = every other kept piece a little closer, "smooth" = a slow glide
    "motion": "none",  # none | pop (lines pop in) | bounce (and every word bounces as it is said)
}
# Auto zoom: how close it gets, seconds to glide in and out (both picked by the user: zoomAmount and
# zoomPeriod in src/lib/subtitle-style.ts), seconds to settle around a no-zoom part (src/lib/zoom.ts).
ZOOM = 1.12
SMOOTH_PERIOD = 12
SMOOTH_FADE = 0.75
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


def group_lines(placed: list[dict], thai: bool, per_line: int, max_frames: float, max_letters: int, gap_frames: float) -> list[list[dict]]:
    """Words into short subtitle lines. Same as the grouping in subtitleLines (timeline.ts)."""
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
        if current and w["start"] - current[-1]["end"] > gap_frames:
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
            if (a and b and a != b) or ending or w["start"] - prev["end"] >= THAI_PAUSE * FPS:
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
BOUNCE = [(0, 100), (80, 125), (200, 100)]
POP_END = POP[-1][0]


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


def pop_tags(motion: str, since: float) -> str:
    """The line popping in, for an event `since` ms after the line started ("" once it is done)."""
    return f"{{{scale_tags(POP, since)}}}" if motion in ("pop", "bounce") and since < POP_END else ""


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
        placed.append({"text": fix_thai(w["text"]), "start": max(0.0, mid - half), "end": mid + half})

    # Group words into short lines.
    gap_frames = LINE_BREAK_GAP * FPS
    max_letters = math.floor(limits["thai_letters"] * min(1, limits["size"] / size))
    lines = group_lines(placed, thai, per_line, max_seconds * FPS, max_letters, gap_frames)

    brand = style.get("color", "#FFE600")
    highlight = ass_colour(brand)
    own_font = style["font"] == "own"
    events = banner_events(banners or [], video_h, style.get("format", "9:16"), own_font)
    # The channel name stays in its corner for the whole video.
    # (A logo picture, if there is one, is put on by FFmpeg instead: logo_filter.)
    logo = "" if style.get("logoUrl") else ass_text(str(style.get("logo") or "")).replace("\n", " ").strip()
    if logo:
        total = sum(frames for _, _, frames in segments) / FPS
        logo_font = font_tag(logo, own_font, LOGO["size"])
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(total)},Logo,,0,0,0,,{{{logo_font}}}{logo}")
    logo_align = {"top-left": 7, "top-right": 9, "bottom-left": 1, "bottom-right": 3}.get(style.get("logoAt"), 7)
    for i, line in enumerate(lines):
        start = line[0]["start"]
        # Hold each line until the next one starts (if close), so subtitles don't flicker.
        end = line[-1]["end"]
        if i + 1 < len(lines) and lines[i + 1][0]["start"] - end < gap_frames:
            end = lines[i + 1][0]["start"]
        parts = [ass_text(p) for p in (join_thai(line) if thai else [(" " if k else "") + w["text"] for k, w in enumerate(line)])]
        row2 = second_row(parts) if look == "two" else None
        line_font = font_tag("".join(parts), own_font, size)
        if row2 is not None:
            # ASS has no line spacing: an empty row as tall as the gap goes between the two rows.
            gap = int(style.get("lineSpacing") or 0)
            back = size * CYRILLIC_SCALE if line_font else size
            spacer = f"\\N{{\\fs{gap}}}\\h\\N{{\\fs{back:g}}}" if gap > 0 else "\\N"
            parts[row2] = spacer + parts[row2].lstrip()
        line_font = f"{{{line_font}}}" if line_font else ""
        if look != "highlight" and motion != "bounce":
            events.append(f"Dialogue: 0,{ass_time(start / FPS)},{ass_time(end / FPS)},Default,,0,0,0,,{line_font}{pop_tags(motion, 0)}{''.join(parts)}")
            continue
        # Highlight / Bounce: one event per word, that word yellow (or bouncing) until the next one starts.
        for k in range(len(line)):
            a = start if k == 0 else line[k]["start"]
            b = line[k + 1]["start"] if k + 1 < len(line) else end
            if b <= a:
                continue
            since = (a - start) / FPS * 1000  # ms since the line started
            # A word bounces once the line has finished popping in (the first word rides the pop).
            bounce = motion == "bounce" and k > 0 and since >= POP_END
            on = (f"\\1c{highlight}" if look == "highlight" else "") + (scale_tags(BOUNCE, 0) if bounce else "")
            off = (f"\\1c{ass_colour(style.get('textColor', '#FFFFFF'))}" if look == "highlight" else "") + ("\\fscx100\\fscy100" if bounce else "")
            text = "".join(f"{{{on}}}{p}{{{off}}}" if j == k and on else p for j, p in enumerate(parts))
            events.append(f"Dialogue: 0,{ass_time(a / FPS)},{ass_time(b / FPS)},Default,,0,0,0,,{line_font}{pop_tags(motion, since)}{text}")

    # Box: the outline becomes a dark box behind each line (BorderStyle 3) with no shadow.
    # Letter spacing stays off for Thai below: libass spaces every mark too, which pulls them off their letters.
    boxed = look == "box"
    border_style, border, shadow = (3, BOX_PADDING, 0) if boxed else (1, outline, 2)
    outline_colour = "&H40000000" if boxed else "&H00000000"

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
            f"0,0,0,0,100,100,{0 if thai else int(style.get('letterSpacing') or 0)},0,{border_style},{border},{shadow},2,80,80,{margin_v},1",
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


def zoom_shots(segments: list[tuple[int, int, int]], off: list[tuple[int, int]], zoom: str, amount: float = ZOOM) -> list[tuple[int, int, int, int, float]]:
    """The picture's parts: (piece number, output frame, source frame, frame count, zoom). A jump
    happens at every other cut, and also where a no-zoom part starts or ends inside a piece. Same
    levels as the "cuts" mode of zoomTrack in src/lib/zoom.ts."""
    shots = []
    for i, (start, trim, frames) in enumerate(segments):
        marks = {0, frames}
        if zoom == "cuts":
            marks |= {min(max(edge - start, 0), frames) for r in off for edge in r}
        ordered = sorted(marks)
        for a, b in zip(ordered, ordered[1:]):
            inside = any(x <= start + a and start + b <= y for x, y in off)
            level = amount if zoom == "cuts" and i % 2 == 1 and not inside else 1.0
            shots.append((i, start + a, trim + a, b - a, level))
    return shots


def smooth_zoom_expr(start: int, frames: int, off: list[tuple[int, int]], amount: float = ZOOM, period: float = SMOOTH_PERIOD) -> str:
    """The zoom of a piece as an ffmpeg expression of its frame number (`in` counts from 1). Same as
    the "smooth" mode of zoomTrack in src/lib/zoom.ts."""
    frame = f"(in-1+{start})"
    fade = SMOOTH_FADE * FPS
    k = f"(0.5-0.5*cos(2*PI*{frame}/{period * FPS}))"
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
) -> list[str]:
    """logo: {"path", "size", "opacity", "at"}: a picture put in a corner under the subtitles.
    no_zoom: parts with Auto zoom turned off (source seconds)."""
    aspect = display_aspect(src)
    # The pieces in whole frames of the final video, as the preview has them (StudioPlayer): each piece's
    # picture and sound are exactly `frames` / FPS long, so nothing is held or skipped at the joins.
    pieces = frame_segments(keeps)
    off = no_zoom_frames(pieces, no_zoom)
    parts, video_labels, audio_labels = [], [], []
    # The picture may have more parts than the pieces (a no-zoom part can start inside a piece), so
    # picture and sound are joined separately. Both add up to the same whole frames.
    for k, (i, out_frame, trim, frames, level) in enumerate(zoom_shots(pieces, off, zoom, zoom_amount)):
        a, b = trim / FPS, (trim + frames) / FPS
        # Framed on its own (face crop, Auto zoom), so parts can differ before they are joined. The face
        # is found per whole piece, so it doesn't move at a no-zoom edge.
        piece_trim, piece_frames = pieces[i][1], pieces[i][2]
        focus = focus_for(faces, piece_trim / FPS, (piece_trim + piece_frames) / FPS)
        framing = (
            smooth_filter(aspect, focus, smooth_zoom_expr(out_frame, frames, off, zoom_amount, zoom_period), size, zoom_amount)
            if zoom == "smooth"
            else piece_filter(aspect, focus, level, size)
        )
        parts.append(
            f"[0:v]trim=start={a:.6f}:end={b:.6f},setpts=PTS-STARTPTS,fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration=1,trim=end_frame={frames},setpts=PTS-STARTPTS,"
            f"{framing},setsar=1[v{k}]"
        )
        video_labels.append(f"[v{k}]")
    if audio:
        for i, (_, trim, frames) in enumerate(pieces):
            a, b, length = trim / FPS, (trim + frames) / FPS, frames / FPS
            # A few ms fade in and out at every cut, so the sound doesn't click (FADE_SAMPLES in the preview).
            parts.append(
                f"[0:a]atrim=start={a:.6f}:end={b:.6f},asetpts=PTS-STARTPTS,apad=whole_dur={length:.6f},atrim=end={length:.6f},"
                f"afade=t=in:d={CUT_FADE},afade=t=out:st={max(0.0, length - CUT_FADE):.6f}:d={CUT_FADE}[a{i}]"
            )
            audio_labels.append(f"[a{i}]")
        parts.append(f"{''.join(audio_labels)}concat=n={len(audio_labels)}:v=0:a=1[ca]")
    parts.append(f"{''.join(video_labels)}concat=n={len(video_labels)}:v=1:a=0[cv]")
    base = "[cv]"
    if logo:
        # Same place as the preview (PlayerFrame): LOGO side / top px from its corner, size px wide.
        side, edge = LOGO["side"], LOGO["top"]
        x = f"main_w-overlay_w-{side}" if str(logo["at"]).endswith("right") else str(side)
        y = f"main_h-overlay_h-{edge}" if str(logo["at"]).startswith("bottom") else str(edge)
        opacity = min(1.0, max(0.2, float(logo["opacity"])))
        parts.append(f"[1:v]scale={int(logo['size'])}:-1,format=rgba,colorchannelmixer=aa={opacity:.2f}[lg]")
        parts.append(f"[cv][lg]overlay={x}:{y}:format=auto[cl]")
        base = "[cl]"
    parts.append(
        f"{base}fps={FPS},"
        # shaping=complex: Thai tone marks sit above the vowels (simple shaping draws them on top of each other).
        f"ass={subs.name}:shaping=complex{f':fontsdir={fonts_dir}' if fonts_dir else ''}[outv]"
    )

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if logo:
        cmd += ["-i", str(logo["path"])]
    cmd += ["-filter_complex", ";".join(parts), "-map", "[outv]"]
    if audio:
        cmd += ["-map", "[ca]", "-c:a", "aac", "-b:a", "160k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
    # The last fps filter can add a frame at the very end: exactly as many frames as the pieces have.
    cmd += ["-frames:v", str(sum(frames for _, _, frames in pieces))]
    cmd += ["-movflags", "+faststart", str(out)]
    return cmd


def put(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": content_type})
    with urllib.request.urlopen(req) as res:
        if res.status >= 300:
            raise RuntimeError(f"upload failed ({res.status})")


@app.function(image=image, cpu=4, memory=4096, timeout=30 * 60)
def render(video_url: str, edit: dict, output_url: str, error_url: str | None = None, style: dict | None = None) -> dict:
    style = {**DEFAULT_STYLE, **(style or {})}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            src, subs, out = workdir / "source", workdir / "subs.ass", workdir / "final.mp4"

            urllib.request.urlretrieve(video_url, src)

            keeps = keep_segments(edit["duration"], edit.get("cuts", []))
            if not keeps:
                raise RuntimeError("nothing left after cutting")
            subs.write_text(build_subtitles(edit.get("words", []), keeps, style, edit.get("banners")), encoding="utf-8")

            # The user's own font: libass also looks in this folder.
            fonts_dir = None
            if style.get("font") == "own" and style.get("fontUrl"):
                (workdir / "fonts").mkdir()
                urllib.request.urlretrieve(style["fontUrl"], workdir / "fonts" / "own.ttf")
                fonts_dir = "fonts"

            # The user's logo picture, if this look shows it.
            logo = None
            if style.get("logoUrl"):
                logo_path = workdir / "logo"
                urllib.request.urlretrieve(style["logoUrl"], logo_path)
                logo = {"path": logo_path, "size": style.get("logoSize", 180), "opacity": style.get("logoOpacity", 1), "at": style.get("logoAt", "top-left")}

            result = subprocess.run(
                ffmpeg_command(
                    src,
                    subs,
                    out,
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
                ),
                cwd=workdir,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr[-1500:]}")

            put(output_url, out.read_bytes(), "video/mp4")
            return {"ok": True, "seconds": round(sum(b - a for a, b in keeps), 2), "bytes": out.stat().st_size}
    except Exception as err:
        if error_url:
            put(error_url, json.dumps({"error": str(err)}).encode(), "application/json")
        raise


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
    cmd += ["-map", sound, "-ac", "1", "-ar", str(PROXY_AUDIO_RATE), "-f", "s16le", str(pcm)]
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


@app.function(image=image, cpu=4, memory=4096, timeout=30 * 60)
def proxy(
    video_url: str,
    output_url: str,
    error_url: str | None = None,
    audio_url: str | None = None,
    faces_url: str | None = None,
    thumb_url: str | None = None,
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
        call = proxy.spawn(body["videoUrl"], body["outputUrl"], body.get("errorUrl"), body.get("audioUrl"), body.get("facesUrl"), body.get("thumbUrl"))
    elif body.get("kind") == "faces":
        call = faces.spawn(body["videoUrl"], body["facesUrl"], body.get("thumbUrl"))
    else:
        call = render.spawn(body["videoUrl"], body["edit"], body["outputUrl"], body.get("errorUrl"), body.get("style"))
    return {"callId": call.object_id}


@app.local_entrypoint()
def main(job: str):
    """Manual test: python -m modal run modal_app/render.py --job job.json (a job without "edit" makes a proxy)"""
    spec = json.loads(Path(job).read_text(encoding="utf-8"))
    if "edit" not in spec:
        print(proxy.remote(spec["videoUrl"], spec["outputUrl"], spec.get("errorUrl"), spec.get("audioUrl")))
        return
    print(render.remote(spec["videoUrl"], spec["edit"], spec["outputUrl"], spec.get("errorUrl"), spec.get("style")))
