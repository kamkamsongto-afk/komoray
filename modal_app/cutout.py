"""Komoray cutout worker on Modal (GPU): cuts the speaker out of the background.

For the parts of the video the user asked for (windows, in seconds of the original video), the
BiRefNet-matting model (MIT, code and weights) finds how much of each pixel is the person (the
"matte": white = person, black = background, grey = hair and soft edges). That is the Best quality;
Fast and Balanced are made on the customer's own computer and only finished here (finish_local).
It writes back:
  matte.mp4          the matte for the whole video at 30 fps (black outside the windows), for the
                     final render: the same picture-for-picture timing as the original
  proxy-cutout.mp4   the editor's preview copy with the matte under the picture (one frame = picture
                     on top, matte below), made exactly like proxy.mp4 in render.py so the editor's
                     own player can play it: the picture and its matte can never drift apart
  cutout.json        written last: done, with the windows and the time it took

Like render.py, Modal never holds R2 keys: the website hands it short-lived signed URLs.
Round 1-3 tests (7 Nov, komoray-tests/cutout-2026-11-07): the model's own edge kept as is looks
best (re-colouring the edge or smoothing it over time blurred the hair).

Deploy:          python -m modal deploy modal_app/cutout.py
Staging copy:    KOMORAY_CUTOUT_APP=komoray-cutout-staging python -m modal deploy modal_app/cutout.py
"""

import hmac
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import modal

app = modal.App(os.environ.get("KOMORAY_CUTOUT_APP", "komoray-cutout"))

MODEL = "ZhengPeng7/BiRefNet-matting"
# Pinned: the model runs its own code when it loads (trust_remote_code), so never take a newer one unseen.
MODEL_REVISION = "eccde0a8cbdce7ac5fecfeb06340fe7b949e85d9"
MODEL_DIR = "/model"


def fetch_model() -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL, revision=MODEL_REVISION, local_dir=MODEL_DIR)


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "transformers==4.46.3",
        "huggingface_hub==0.26.2",
        "timm==1.0.12",
        "einops==0.8.0",
        "kornia==0.7.4",
        "opencv-python-headless==4.10.0.84",
        "numpy<2.3",
        "fastapi[standard]",
    )
    .run_function(fetch_model)  # in the image: no download per job
)

FPS = 30  # same as render.py
MATTE_SIDE = 1080  # px, the matte's short side (the final video is 1080 wide)
MODEL_SIDE = 1024  # px, the picture size the model works at
BATCH = 4
# The preview copy: the same settings as proxy_command in render.py (PROXY_SIDE, PROXY_KEYFRAME_FRAMES).
PROXY_SIDE = 540
PROXY_KEYFRAME_FRAMES = 15
PART_SECONDS = 45  # about one GPU machine for this much video
MAX_PARTS = 4  # more than this and starting the machines eats the time saved
SEEK_BACK = 2.0  # s, jump this far before a run so its first frame is decoded properly


def put(url: str, data: bytes, content_type: str) -> None:
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": content_type})
    with urllib.request.urlopen(req) as res:
        if res.status >= 300:
            raise RuntimeError(f"upload failed ({res.status})")


def picture_size(src: Path) -> tuple[int, int]:
    """Width and height after turning the picture upright and scaling the short side to MATTE_SIDE."""
    import cv2

    first = src.with_name("first.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-frames:v", "1", "-vf", scale_filter(MATTE_SIDE), str(first)], check=True)
    picture = cv2.imread(str(first))
    if picture is None:
        raise RuntimeError("could not read the video's picture")
    return picture.shape[1], picture.shape[0]


def scale_filter(side: int) -> str:
    # The short side becomes `side` (never bigger than the original), like proxy_command in render.py.
    return f"scale='if(gt(iw,ih),-2,min({side},iw))':'if(gt(iw,ih),min({side},ih),-2)'"


def inside(t: float, windows: list[list[float]]) -> bool:
    return any(a <= t < b for a, b in windows)


def ranges_of(windows: list[list[float]], frames: int) -> list[list[int]]:
    """The windows as runs of frame numbers [first, past the last)."""
    runs: list[list[int]] = []
    for i in range(frames):
        if inside(i / FPS, windows):
            if runs and runs[-1][1] == i:
                runs[-1][1] = i + 1
            else:
                runs.append([i, i + 1])
    return runs


def new_runs(start: int, end: int, previous_windows: list[list[float]]) -> list[list[int]]:
    """The frames of [start, end) the previous cutout doesn't have."""
    runs: list[list[int]] = []
    for i in range(start, end):
        if inside(i / FPS, previous_windows):
            continue
        if runs and runs[-1][1] == i:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1])
    return runs


def split_parts(runs: list[list[int]]) -> list[list[list[int]]]:
    """Shares the frames between GPU machines: about one per PART_SECONDS, never more than MAX_PARTS. More
    machines cost about the same (each is paid for less time) but finish sooner."""
    total = sum(b - a for a, b in runs)
    count = min(MAX_PARTS, max(1, (total + PART_SECONDS * FPS - 1) // (PART_SECONDS * FPS)))
    each = (total + count - 1) // count
    parts: list[list[list[int]]] = [[]]
    room = each
    for a, b in runs:
        while a < b:
            if room == 0:
                parts.append([])
                room = each
            take = min(room, b - a)
            parts[-1].append([a, a + take])
            a += take
            room -= take
    return parts


def count_frames(src: Path) -> int:
    """How many frames the video has at FPS: read through once, tiny, the way every later step sees it."""
    reader = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-an", "-vf", f"fps={FPS},scale=2:2", "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
    total = 0
    while chunk := reader.stdout.read(1 << 20):
        total += len(chunk)
    if reader.wait() != 0:
        raise RuntimeError("could not read the video")
    return total // 4


def write_preview(src: Path, matte: Path, preview: Path) -> None:
    """The preview copy: picture on top, matte below, each PROXY_SIDE on its short side."""
    side = f"scale='if(gt(iw,ih),-2,{PROXY_SIDE})':'if(gt(iw,ih),{PROXY_SIDE},-2)'"
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-i", str(matte),
         "-filter_complex", f"[0:v]{side},fps={FPS},format=yuv420p[p];[1:v]{side},fps={FPS},format=yuv420p[m];[p][m]vstack=shortest=1[v]",
         "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-tune", "fastdecode", "-bf", "0",
         "-g", str(PROXY_KEYFRAME_FRAMES), "-keyint_min", str(PROXY_KEYFRAME_FRAMES), "-sc_threshold", "0", "-movflags", "+faststart", str(preview)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on the preview: {result.stderr[-800:]}")


def matte_writer(path: Path, w: int, h: int):
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "gray", str(path)],
        stdin=subprocess.PIPE,
    )


@app.function(image=image, gpu="L4", cpu=4, memory=16384, timeout=30 * 60)
def cut_part(video_url: str, runs: list, w: int, h: int) -> dict:
    """One GPU machine's share: the matte for these runs of frames, as one small video."""
    import cv2
    import numpy as np
    import torch
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    with tempfile.TemporaryDirectory() as tmp:
        wd = Path(tmp)
        src, out = wd / "source", wd / "part.mp4"
        urllib.request.urlretrieve(video_url, src)
        model = AutoModelForImageSegmentation.from_pretrained(MODEL_DIR, trust_remote_code=True).half().cuda().eval()
        prep = transforms.Compose([transforms.ToTensor(), transforms.Resize((MODEL_SIDE, MODEL_SIDE), antialias=True), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        writer = matte_writer(out, w, h)
        frame_bytes = w * h * 3
        batch: list = []
        model_s = 0.0

        def flush() -> None:
            nonlocal model_s
            if not batch:
                return
            t0 = time.time()
            with torch.no_grad():
                x = torch.stack([prep(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)) for f in batch]).half().cuda()
                masks = model(x)[-1].sigmoid().float().cpu().numpy()[:, 0]
            model_s += time.time() - t0
            for m in masks:
                writer.stdin.write((np.clip(cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR), 0, 1) * 255).astype(np.uint8).tobytes())
            batch.clear()

        for a, b in runs:
            # Jumps near the run, then keeps the video's own clock (-copyts) so these are the same frames a
            # read from the very start would give: the matte must fit the picture frame for frame.
            reader = subprocess.Popen(
                ["ffmpeg", "-v", "error", "-ss", str(max(0.0, a / FPS - SEEK_BACK)), "-copyts", "-start_at_zero", "-i", str(src), "-an",
                 "-vf", f"{scale_filter(MATTE_SIDE)},fps={FPS},trim=start={a / FPS}:end={b / FPS}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                stdout=subprocess.PIPE,
            )
            made, last = 0, None
            while made < b - a:
                raw = reader.stdout.read(frame_bytes)
                if len(raw) < frame_bytes:
                    break
                last = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
                batch.append(last)
                made += 1
                if len(batch) == BATCH:
                    flush()
            reader.stdout.close()
            reader.wait()
            while made < b - a and last is not None:  # the very end of a video can come up a frame short
                batch.append(last)
                made += 1
                if len(batch) == BATCH:
                    flush()
        flush()
        writer.stdin.close()
        if writer.wait() != 0:
            raise RuntimeError("ffmpeg failed while making the matte")
        return {"video": out.read_bytes(), "modelSeconds": model_s}


@app.function(image=image, cpu=4, memory=8192, timeout=90 * 60)
def cutout(video_url: str, windows: list, matte_url: str, preview_url: str, done_url: str, error_url: str, previous_url: str | None = None, previous_windows: list | None = None) -> dict:
    try:
        return make_cutout(video_url, [[float(a), float(b)] for a, b in windows], matte_url, preview_url, done_url, previous_url, [[float(a), float(b)] for a, b in previous_windows or []])
    except Exception as err:
        put(error_url, json.dumps({"error": str(err)[-500:], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode(), "application/json")
        raise


def make_cutout(video_url: str, windows: list[list[float]], matte_url: str, preview_url: str, done_url: str, previous_url: str | None, previous_windows: list[list[float]]) -> dict:
    import numpy as np

    t_start = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        wd = Path(tmp)
        src, matte, preview = wd / "source", wd / "matte.mp4", wd / "proxy-cutout.mp4"
        urllib.request.urlretrieve(video_url, src)
        w, h = picture_size(src)
        frames = count_frames(src)

        # Frames the last Best cutout already made are kept, not paid for again.
        reuse = bool(previous_url and previous_windows)
        fresh = ranges_of(windows, frames)
        if reuse:
            fresh = [run for start, end in fresh for run in new_runs(start, end, previous_windows)]
        parts = split_parts(fresh) if fresh else []
        calls = [cut_part.spawn(video_url, runs, w, h) for runs in parts]
        results = [call.get() for call in calls]
        for i, result in enumerate(results):
            (wd / f"part{i}.mp4").write_bytes(result["video"])

        made = None
        if results:
            (wd / "parts.txt").write_text("".join(f"file part{i}.mp4\n" for i in range(len(results))))
            made = subprocess.Popen(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE, cwd=wd)
        before = None
        if reuse:
            before = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(previous_url), "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)

        writer = matte_writer(matte, w, h)
        black = np.zeros((h, w), np.uint8).tobytes()
        fresh_at = {i for a, b in fresh for i in range(a, b)}
        for i in range(frames):
            old = before.stdout.read(w * h) if before else b""
            if i in fresh_at:
                raw = made.stdout.read(w * h)
                writer.stdin.write(raw if len(raw) == w * h else black)
            elif reuse and inside(i / FPS, previous_windows) and inside(i / FPS, windows) and len(old) == w * h:
                writer.stdin.write(old)
            else:
                writer.stdin.write(black)
        writer.stdin.close()
        if writer.wait() != 0:
            raise RuntimeError("ffmpeg failed while making the matte")
        for reader in (made, before):
            if reader:
                reader.stdout.close()
                reader.wait()

        write_preview(src, matte, preview)
        put(matte_url, matte.read_bytes(), "video/mp4")
        put(preview_url, preview.read_bytes(), "video/mp4")
        stats = {
            "windows": windows,
            "tier": "best",
            "frames": frames,
            "modelFrames": len(fresh_at),
            "modelSeconds": round(sum(r["modelSeconds"] for r in results), 1),
            "machines": len(results),
            "totalSeconds": round(time.time() - t_start, 1),
            "size": [w, h],
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        # Last: the website takes cutout.json existing to mean both files are there.
        put(done_url, json.dumps(stats).encode(), "application/json")
        return stats


@app.function(image=image, cpu=2, memory=4096, timeout=15 * 60)
def finish_local(video_url: str, local_url: str, windows: list, tier: str, matte_url: str, preview_url: str, done_url: str, error_url: str) -> dict:
    """Fast and Balanced are cut out on the customer's own computer (lib/cutout-local.ts), which sends the matte
    as a plain H.264 stream. This turns it into the same two files Best makes. No GPU."""
    try:
        t_start = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            wd = Path(tmp)
            src, local, matte, preview = wd / "source", wd / "local.h264", wd / "matte.mp4", wd / "proxy-cutout.mp4"
            urllib.request.urlretrieve(video_url, src)
            urllib.request.urlretrieve(local_url, local)
            w, h = picture_size(src)
            # extractplanes: the brightness exactly as the browser wrote it (a colour conversion would stretch it
            # and leave the speaker slightly see-through).
            result = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-f", "h264", "-framerate", str(FPS), "-i", str(local),
                 "-vf", f"extractplanes=y,scale={w}:{h}:flags=bicubic", "-r", str(FPS),
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "gray", str(matte)],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed on the matte: {result.stderr[-800:]}")
            write_preview(src, matte, preview)
            put(matte_url, matte.read_bytes(), "video/mp4")
            put(preview_url, preview.read_bytes(), "video/mp4")
            stats = {"windows": [[float(a), float(b)] for a, b in windows], "tier": tier, "totalSeconds": round(time.time() - t_start, 1), "size": [w, h], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            put(done_url, json.dumps(stats).encode(), "application/json")
            return stats
    except Exception as err:
        put(error_url, json.dumps({"error": str(err)[-500:], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode(), "application/json")
        raise


@app.function(image=image, secrets=[modal.Secret.from_name("komoray-render")])
@modal.fastapi_endpoint(method="POST")
def start(body: dict) -> dict:
    """Called by komoray.com (same token as render.py). Starts a cutout in the background."""
    if not hmac.compare_digest(str(body.get("token", "")), os.environ["RENDER_TOKEN"]):
        return {"error": "unauthorized"}
    if body.get("kind") == "finish":
        call = finish_local.spawn(body["videoUrl"], body["localUrl"], body["windows"], body["tier"], body["matteUrl"], body["previewUrl"], body["doneUrl"], body["errorUrl"])
    else:
        call = cutout.spawn(body["videoUrl"], body["windows"], body["matteUrl"], body["previewUrl"], body["doneUrl"], body["errorUrl"], body.get("previousUrl"), body.get("previousWindows"))
    return {"callId": call.object_id}
