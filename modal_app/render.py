"""Komoray render worker on Modal.

Takes a raw video + its edit.json, then with FFmpeg:
cuts out the silences, reframes to vertical 1080x1920, burns in subtitles, adds a watermark.

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
            ]
        ],
        "fc-cache -f",
    )
    .pip_install("fastapi[standard]", "opencv-python-headless==4.10.0.84", "numpy<2.3")
)

WIDTH, HEIGHT, FPS = 1080, 1920, 30
# How long a subtitle line may get, per look. Thai letters don't count marks above and below.
# Same as LINE_LIMITS in src/lib/timeline.ts.
LINE_LIMITS = {
    "normal": {"words": 3, "seconds": 1.6, "thai_words": 6, "thai_letters": 16, "thai_seconds": 2.2},
    "big": {"words": 2, "seconds": 1.2, "thai_words": 4, "thai_letters": 10, "thai_seconds": 1.6},
    "two": {"words": 7, "seconds": 3.0, "thai_words": 12, "thai_letters": 30, "thai_seconds": 3.6},
}
THAI_PAUSE = 0.15  # a pause this long inside a Thai line gets a space
LINE_BREAK_GAP = 0.5  # a pause this long starts a new subtitle line
WATERMARK = "komoray.com"

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
BOX_PADDING = 20  # the Box look: space around the letters, px
LOGO = {"size": 52, "outline": 4, "side": 60, "top": 110}  # the channel name in a corner (LOGO in PlayerFrame.tsx)


# Banners (src/lib/banners.ts): sizes in px, fade in seconds, top of each place.
BANNER = {"size": 72, "sub_size": 44, "padding": 28, "fade": 0.25}
# Where each banner place starts, share of the video's height, per shape (BANNER_TOP in banners.ts).
BANNER_TOP = {
    "9:16": {"top": 0.135, "middle": 0.448, "bottom": 0.78},
    "1:1": {"top": 0.08, "middle": 0.35, "bottom": 0.55},
    "16:9": {"top": 0.08, "middle": 0.35, "bottom": 0.62},
}
WATERMARK_BOTTOM = 0.135  # the watermark's gap to the bottom edge, share of the height (260 px of 1920)
# The final video's shape (FORMATS in src/lib/subtitle-style.ts): width, height.
FORMATS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


def banner_ink(hex_colour: str) -> str:
    """Dark letters on a light brand colour, white on a dark one. Same as bannerInk in banners.ts."""
    n = int(hex_colour.lstrip("#"), 16) if re.fullmatch(r"#[0-9a-fA-F]{6}", hex_colour or "") else 0xFFE600
    r, g, b = (n >> 16) & 255, (n >> 8) & 255, n & 255
    return "#111111" if 0.299 * r + 0.587 * g + 0.114 * b > 160 else "#FFFFFF"


def banner_events(banners: list[dict], height: int = HEIGHT, shape: str = "9:16") -> list[str]:
    """One event per banner, faded in and out, in its place. Text was checked by the app (readBanners)."""
    events = []
    fade = int(BANNER["fade"] * 1000)
    pad_x, pad_y = BANNER["padding"], BANNER["padding"] // 2
    for b in banners:
        start, end = float(b.get("start", 0)), float(b.get("end", 0))
        text = ass_text(str(b.get("text", ""))).strip()
        if end <= start or not text:
            continue
        sub = ass_text(str(b.get("sub", ""))).strip()
        body = f"{{\\fad({fade},{fade})\\xbord{pad_x}\\ybord{pad_y}}}{text}" + (f"\\N{{\\fs{BANNER['sub_size']}}}{sub}" if sub else "")
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
    "color": "#FFE600",  # brand colour: the Highlight look's word
    "logo": "",  # channel name in a corner, "" = none
    "logoAt": "top-left",  # or "top-right"
    "zoom": "off",  # Auto zoom: "cuts" = every other kept piece a little closer
}
ZOOM = 1.12  # Auto zoom (ZOOM in src/lib/timeline.ts)
ZOOM_ORIGIN = (0.5, 0.4)  # zoomed around this point of the frame: a little above the middle, where faces are
BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


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
    lines, current, letters = [], [], 0
    for w in placed:
        if current and (
            len(current) >= per_line
            or w["start"] - current[-1]["end"] > gap_frames
            or w["end"] - current[0]["start"] > max_seconds * FPS
            or (thai and letters + thai_letters(w["text"]) > limits["thai_letters"])
        ):
            lines.append(current)
            current, letters = [], 0
        current.append(w)
        letters += thai_letters(w["text"])
    if current:
        lines.append(current)

    brand = style.get("color", "#FFE600")
    highlight = ass_colour(brand)
    events = banner_events(banners or [], video_h, style.get("format", "9:16"))
    # The channel name stays in its corner for the whole video.
    logo = ass_text(str(style.get("logo") or "")).replace("\n", " ").strip()
    if logo:
        total = sum(frames for _, _, frames in segments) / FPS
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(total)},Logo,,0,0,0,,{logo}")
    logo_align = 9 if style.get("logoAt") == "top-right" else 7
    for i, line in enumerate(lines):
        start = line[0]["start"]
        # Hold each line until the next one starts (if close), so subtitles don't flicker.
        end = line[-1]["end"]
        if i + 1 < len(lines) and lines[i + 1][0]["start"] - end < gap_frames:
            end = lines[i + 1][0]["start"]
        parts = [ass_text(p) for p in (join_thai(line) if thai else [(" " if k else "") + w["text"] for k, w in enumerate(line)])]
        row2 = second_row(parts) if look == "two" else None
        if row2 is not None:
            parts[row2] = "\\N" + parts[row2].lstrip()
        if look != "highlight":
            events.append(f"Dialogue: 0,{ass_time(start / FPS)},{ass_time(end / FPS)},Default,,0,0,0,,{''.join(parts)}")
            continue
        # Highlight: one event per word, that word yellow until the next one starts.
        for k in range(len(line)):
            a = start if k == 0 else line[k]["start"]
            b = line[k + 1]["start"] if k + 1 < len(line) else end
            if b <= a:
                continue
            text = "".join(f"{{\\1c{highlight}}}{p}{{\\1c&H00FFFFFF&}}" if j == k else p for j, p in enumerate(parts))
            events.append(f"Dialogue: 0,{ass_time(a / FPS)},{ass_time(b / FPS)},Default,,0,0,0,,{text}")

    # Box: the outline becomes a dark box behind each line (BorderStyle 3) with no shadow.
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
            f"Style: Default,{font},{size},&H00FFFFFF,&H00FFFFFF,{outline_colour},&H64000000,"
            # Bold stays off: the weight comes from the font name (e.g. "Kanit Medium").
            f"0,0,0,0,100,100,0,0,{border_style},{border},{shadow},2,80,80,{margin_v},1",
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


def frame_piece(
    aspect: float, focus: tuple[float, float] | None, zoom: float, size: tuple[int, int] = (WIDTH, HEIGHT)
) -> tuple[float, float, float, float]:
    """Where the whole source picture goes in the final video's frame (x, y, w, h): cropped around
    the face, zoomed around it. Same as framePiece in src/lib/framing.ts."""
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
    return -(cx * zoom + ox * (zoom - 1)), -(cy * zoom + oy * (zoom - 1)), w0 * zoom, h0 * zoom


def piece_filter(aspect: float, focus: tuple[float, float] | None, zoom: float, size: tuple[int, int] = (WIDTH, HEIGHT)) -> str:
    """ffmpeg: scale the picture to its framed size, then cut the final video's window out of it."""
    W, H = size
    x, y, w, h = frame_piece(aspect, focus, zoom, size)
    sw, sh = max(W, round(w / 2) * 2), max(H, round(h / 2) * 2)
    px, py = min(max(round(-x), 0), sw - W), min(max(round(-y), 0), sh - H)
    return f"scale={sw}:{sh},crop={W}:{H}:{px}:{py}"


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
) -> list[str]:
    aspect = display_aspect(src)
    # The pieces in frames, as the preview has them (StudioPlayer), to pick the same faces.
    framed = [(trim / FPS, (trim + frames) / FPS) for _, trim, frames in frame_segments(keeps)]
    parts, labels = [], []
    for i, (a, b) in enumerate(keeps):
        # Each piece is framed on its own (face crop, Auto zoom), so pieces can differ before they are joined.
        piece_zoom = ZOOM if zoom == "cuts" and i % 2 == 1 else 1.0
        focus = focus_for(faces, *framed[i]) if i < len(framed) else None
        parts.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS,{piece_filter(aspect, focus, piece_zoom, size)},setsar=1[v{i}]")
        labels.append(f"[v{i}]")
        if audio:
            parts.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{i}]")
            labels.append(f"[a{i}]")
    parts.append(f"{''.join(labels)}concat=n={len(keeps)}:v=1:a={1 if audio else 0}[cv]" + ("[ca]" if audio else ""))
    parts.append(
        f"[cv]fps={FPS},"
        f"subtitles={subs.name}{f':fontsdir={fonts_dir}' if fonts_dir else ''},"
        f"drawtext=fontfile={BOLD_FONT}:text='{WATERMARK}':fontsize=40:fontcolor=white@0.7:"
        f"shadowcolor=black@0.5:shadowx=2:shadowy=2:x=w-tw-48:y=h-th-{js_round(size[1] * WATERMARK_BOTTOM)}[outv]"
    )

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    cmd += ["-filter_complex", ";".join(parts), "-map", "[outv]"]
    if audio:
        cmd += ["-map", "[ca]", "-c:a", "aac", "-b:a", "160k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
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
