"""The final video's side of `npm run check`: runs modal_app/render.py's own functions on the cases from run.mjs
(JSON on stdin) and prints what they give (JSON on stdout). Nothing is sent anywhere and no video is made."""
import json
import math
import re
import sys
import types
from pathlib import Path

try:
    import modal  # noqa: F401
except ImportError:  # only the app's decorators need it, and none of the functions checked here use them
    from unittest.mock import MagicMock

    sys.modules["modal"] = MagicMock()

source = Path(__file__).resolve().parents[2] / "modal_app" / "render.py"
r = types.ModuleType("render")
r.__file__ = str(source)
exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), r.__dict__)

FUNCS = {"min": min, "max": max, "sin": math.sin, "cos": math.cos, "pow": pow, "PI": math.pi, "abs": abs,
         "clip": lambda v, a, b: min(b, max(a, v)), "lt": lambda a, b: 1 if a < b else 0, "gte": lambda a, b: 1 if a >= b else 0,
         "mod": math.fmod, "ceil": math.ceil}


def ffmpeg_value(expr: str, **names) -> float:
    """An FFmpeg expression worked out here. `if(a,b,c)` and `in` are not Python names, so they are renamed."""
    code = re.sub(r"\bif\(", "iff(", expr).replace("in-1", "IN-1")
    return eval(code, {"__builtins__": {}}, {**FUNCS, "iff": lambda c, a, b: a if c else b, **names})


def constants(_):
    return {
        "FPS": r.FPS,
        "formats": {k: list(v) for k, v in r.FORMATS.items()},
        "fonts": sorted(r.FONTS),
        "bannerTop": r.BANNER_TOP,
        "bannerAnims": sorted(r.BANNER_ANIMS),
        "bannerFit": r.BANNER_FIT,
        "frameFade": r.FRAME_FADE,
        "frameRatio": r.FRAME_RATIO,
        "layoutSlide": r.LAYOUT_SLIDE,
        "layoutFlash": r.LAYOUT_FLASH,
        "layoutJoin": r.LAYOUT_JOIN,
        "layoutFill": r.LAYOUT_FILL,
        "partHold": r.PART_HOLD,
        "partGlide": r.PART_GLIDE,
        "pop": [list(k) for k in r.POP],
        "bounce": [list(k) for k in r.BOUNCE],
        "bounceGap": r.BOUNCE_WORD_GAP,
        "logo": [r.LOGO_MOTION[k] for k in ("show", "zoom_from", "flash", "glow")],
    }


def segments(cases):
    return [r.frame_segments(r.keep_segments(c["duration"], c["cuts"])) for c in cases]


def subtitles(cases):
    out = []
    for c in cases:
        style = {**r.DEFAULT_STYLE, "look": c["look"], "motion": "none", "size": c["size"], "letterSpacing": c["spacing"], "format": "9:16", "splits": c["splits"]}
        ass = r.build_subtitles(c["words"], r.keep_segments(c["duration"], c["cuts"]), style, [])
        lines = []
        for row in ass.splitlines():
            if not row.startswith("Dialogue:"):
                continue
            fields = row.split(",", 9)
            if fields[3] == "Banner" or "\\p1" in fields[9]:
                continue
            text = re.sub(r"\{[^}]*\}", "", fields[9]).replace("\\N", " ").replace("\\h", " ")
            h = lambda t: sum(float(x) * m for x, m in zip(t.split(":"), (3600, 60, 1)))
            start, end = h(fields[1]), h(fields[2])
            # A look that lights one word at a time writes several events per line, end to end with the same words, the
            # coloured word further along each time (two lines in a row can also have the same words).
            lit = None
            if c["look"] == "highlight":
                before = fields[9].split("{\\1c", 1)[0]
                lit = len(re.sub(r"\{[^}]*\}", "", before))
            last = lines[-1] if lines else None
            if last and lit is not None and last["text"] == text and abs(last["to"] - start) < 0.02 and lit > last["lit"]:
                last["to"], last["lit"] = end, lit
            else:
                lines.append({"from": start, "to": end, "text": text, **({"lit": lit} if lit is not None else {})})
        out.append(lines)
    return out


def zoom(cases):
    """The zoom at every frame, picked per shot as ffmpeg_command does."""
    out = []
    for c in cases:
        pieces = [tuple(s) for s in c["segments"]]
        style = c["style"]
        mode, amount, period = style["zoom"], style["zoomAmount"], style["zoomPeriod"]
        off = r.no_zoom_frames(pieces, c["noZoom"]) if mode != "off" else []
        runs = r.zoom_part_frames(pieces, c["parts"])
        ramps = r.zoom_ramps(pieces, period)
        track = {}
        for i, out_frame, trim, frames, level, run in r.zoom_shots(pieces, off, mode, amount, runs):
            if run and run[2] != "cuts":
                expr = r.part_zoom_expr(out_frame, run, run[5] or amount)
            elif not run and mode in ("smooth", "in", "out"):
                expr = r.smooth_zoom_expr(out_frame, frames, off, amount, period, mode, ramps[i])
            else:
                expr = None
            for k in range(frames):
                track[out_frame + k] = level if expr is None else ffmpeg_value(expr, IN=k + 1)
        out.append([track[f] for f in sorted(track)])
    return out


def background(cases):
    """The window a moving background is looked through: how much it is blown up, and its corner as a share."""
    out = []
    for c in cases:
        W, H = 1080, 1920
        text = r.bg_motion_filter(c["motion"], c["amount"], c["speed"], c["end"] - c["start"], (W, H))
        if not text:
            out.append([{"s": 1, "x": 0, "y": 0} for _ in c["frames"]])
            continue
        part = dict(re.findall(r"(x0|y0|x1)='([^']*)'", text))
        if "pad=iw+4" in text:  # smaller than its space: drawn on a canvas 2 px bigger (corners moved by that border)
            rows = []
            for f in c["frames"]:
                x0, x1, y0 = (ffmpeg_value(part[k], IN=f + 1) for k in ("x0", "x1", "y0"))
                s = (W + 4) / (x1 - x0)
                rows.append({"s": s, "x": (x0 - 2 + 2 / s) / W, "y": (y0 - 2 + 2 / s) / H})
            out.append(rows)
            continue
        rows = []
        for f in c["frames"]:
            x0, x1, y0 = (ffmpeg_value(part[k], IN=f + 1) for k in ("x0", "x1", "y0"))
            rows.append({"s": W / (x1 - x0), "x": x0 / W, "y": y0 / H})
        out.append(rows)
    return out


def layouts(cases):
    out = []
    for c in cases:
        size = tuple(c["size"])
        rows = []
        for l in c["layouts"]:
            boxes = r.layout_boxes(l, size)
            expr = r.layout_ease_expr(l, c["layouts"])
            rows.append({
                "other": list(boxes["other"]), "me": list(boxes["me"]), "picture": list(boxes["picture"]), "zoom": boxes["zoom"],
                "progress": [ffmpeg_value(expr, t=t) if l["start"] <= t < l["end"] else 0 for t in c["times"]],
            })
        out.append(rows)
    return out


def frames(cases):
    return [{"rect": list(r.frame_rect(c["frame"], tuple(c["size"]))), "points": [list(p) for p in r.frame_points(c["frame"]["shape"])]} for c in cases]


def banners(cases):
    out = []
    for c in cases:
        b = c["banner"]
        rows = [(t, r.BANNER["size"]) for t in b["text"].split("\n") if t] + ([(b["sub"], r.BANNER["sub_size"])] if b.get("sub") else [])
        out.append({
            "fit": r.banner_fit(rows, float(b.get("lineGap") or 0), c["height"], float(b["padding"] if b.get("padding") is not None else r.BANNER["padding"])),
            "poses": [list(r.banner_pose(b, t)) for t in c["times"]],
        })
    return out


def behind(cases):
    return [[r.behind_motion(c["text"], t, c["width"], c["height"]) for t in c["times"]] for c in cases]


def framing(cases):
    """The face to frame and where the whole picture then goes."""
    out = []
    for c in cases:
        focus = r.focus_for(c["faces"], c["start"], c["end"])
        out.append({"focus": list(focus) if focus else None, "rect": list(r.frame_piece(c["aspect"], focus, c["zoom"], tuple(c["size"])))})
    return out


def logo(cases):
    """How far in the logo is: render.py's own sum, and the expression FFmpeg is given for a part starting at `start`."""
    out = []
    for c in cases:
        expr = r.logo_phases(c["style"], c["start"], "T")[0]
        effect, speed, every = r.logo_motion(c["style"])
        out.append({"sum": [r.logo_in(c["start"] + t, effect, speed, every) for t in c["times"]],
                    "ffmpeg": [ffmpeg_value(expr, T=t) for t in c["times"]]})
    return out


def words(cases):
    """How big a popping line and a bouncing word are, ms after they start."""
    return [[r.scale_at(r.POP, ms), r.scale_at(r.BOUNCE, ms)] for ms in cases]


def layout_file(cases):
    """Where a Layout's picture lands in its part, read from the filters layout_filters writes: px from the part's corner."""
    out = []
    for c in cases:
        size, l = tuple(c["size"]), c["layout"]
        parts = []
        r.layout_filters(parts, "[b]", size, [l], [1])
        text = ";".join(parts)
        ow, oh = r.layout_boxes(l, size)["other"][2:]
        iw, ih = c["picture"]
        grow = re.search(r"scale=w='ceil\(iw\*(.+?)/2\)\*2'", text).group(1)
        factor = ffmpeg_value(grow, iw=iw, ih=ih)
        sw, sh = math.ceil(iw * factor / 2) * 2, math.ceil(ih * factor / 2) * 2
        found = re.search(r"crop=\d+:\d+:x='([^']+)':y='([^']+)'", text)
        x = ffmpeg_value(found.group(1), iw=sw, ih=sh)
        y = ffmpeg_value(found.group(2), iw=sw, ih=sh)
        out.append([-x, -y, sw, sh])
    return out


def frame_back(cases):
    """Frame Me's background with a size or place of its own: how much bigger, and its middle away from the screen's, px."""
    out = []
    for c in cases:
        f = c["frame"]
        parts = []
        r.frame_filters(parts, "[b]", tuple(c["size"]), [f], [{"mask": 1, "border": None, "file": 2}], None)
        text = ";".join(parts)
        moved = re.search(r"overlay=x=\(main_w-overlay_w\)/2\+(-?[\d.]+):y=\(main_h-overlay_h\)/2\+(-?[\d.]+)", text)
        if not moved:
            out.append({"moved": False})
            continue
        grow = float(re.search(r"scale=iw\*([\d.]+):ih\*", text).group(1))
        out.append({"moved": True, "grow": grow, "dx": float(moved.group(1)), "dy": float(moved.group(2))})
    return out


def bounce(cases):
    """The Bounce look at moments well away from any edge: how many times each word is drawn, and which is coloured."""
    h = lambda t: sum(float(x) * m for x, m in zip(t.split(":"), (3600, 60, 1)))
    out = []
    for c in cases:
        line = [{"start": w} for w in c["starts"]]
        names = [f"w{k}" for k in range(len(line))]
        events = r.bounce_events(line, c["start"], c["end"], names, [(0.0, 0.0)] * len(line), "", 0, "&H0000FF&")
        rows = []
        for row in events:
            f = row.split(",", 9)
            tags, word = f[9][1:].split("}", 1)
            rows.append((h(f[1]), h(f[2]), word, "&H0000FF&" in tags))
        seen = []
        for frame in c["frames"]:
            t = frame / r.FPS
            live = [e for e in rows if e[0] <= t < e[1]]
            seen.append({"drawn": [sum(1 for e in live if e[2] == n) for n in names], "lit": sorted(int(e[2][1:]) for e in live if e[3])})
        out.append(seen)
    return out


def wraps(cases):
    """Banner rows and the channel name: lines libass could still break onto two by itself (the preview never does)."""
    r.text_width = lambda *a, **k: 100.0  # only the box's width needs it (and uharfbuzz)
    long = "a long row with spaces that is wider than the screen allows"
    out = []
    for c in cases:
        if c.get("logo"):
            kind = "Logo"
            style = {**r.DEFAULT_STYLE, "format": "9:16", "logo": long, "logoEffect": c["logo"], "logoEvery": 5}
            events = r.build_subtitles([], [(0.0, 20.0)], style, []).splitlines()
        else:
            kind = "Banner"
            events = r.banner_events([{"text": long + "\nsecond row", "start": 0, "end": 3, "anim": c["anim"], "place": "top", "scale": 3}])
        lines = [e for e in events if e.startswith("Dialogue:") and e.split(",", 9)[3] == kind and "\\p1" not in e]
        out.append({"drawn": bool(lines), "mayWrap": [e[-90:] for e in lines if "\\q2" not in e]})
    return out


SECTIONS = {f.__name__: f for f in (bounce, constants, segments, subtitles, zoom, background, layouts, frames, banners, behind, framing, logo, words, layout_file, frame_back, wraps)}

if __name__ == "__main__":
    asked = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    results = {}
    for name, cases in asked.items():
        try:
            results[name] = {"ok": SECTIONS[name](cases)}
        except Exception as err:  # said by name, so one broken section doesn't hide the others
            results[name] = {"error": f"{type(err).__name__}: {err}"}
    sys.stdout.buffer.write(json.dumps(results, ensure_ascii=True).encode("ascii"))
