"""Komoray cutout worker on Modal (GPU): cuts the speaker out of the background.

For the parts of the video the user asked for (windows, in seconds of the original video), the
BiRefNet-matting model (MIT, code and weights) finds how much of each pixel is the person (the
"matte": white = person, black = background, grey = hair and soft edges). It writes back:
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


@app.function(image=image, gpu="L4", cpu=4, memory=16384, timeout=30 * 60)
def cutout(video_url: str, windows: list, matte_url: str, preview_url: str, done_url: str, error_url: str) -> dict:
    try:
        return make_cutout(video_url, [[float(a), float(b)] for a, b in windows], matte_url, preview_url, done_url)
    except Exception as err:
        put(error_url, json.dumps({"error": str(err)[-500:], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode(), "application/json")
        raise


def make_cutout(video_url: str, windows: list[list[float]], matte_url: str, preview_url: str, done_url: str) -> dict:
    import cv2
    import numpy as np
    import torch
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation

    t_start = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        wd = Path(tmp)
        src, matte, preview = wd / "source", wd / "matte.mp4", wd / "proxy-cutout.mp4"
        urllib.request.urlretrieve(video_url, src)
        w, h = picture_size(src)

        model = AutoModelForImageSegmentation.from_pretrained(MODEL_DIR, trust_remote_code=True).half().cuda().eval()
        prep = transforms.Compose([transforms.ToTensor(), transforms.Resize((MODEL_SIDE, MODEL_SIDE), antialias=True), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

        # One pass over the whole video at 30 fps (like proxy.mp4), so frame i is at i / 30 s in both.
        reader = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-i", str(src), "-an", "-vf", f"{scale_filter(MATTE_SIDE)},fps={FPS}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
            stdout=subprocess.PIPE,
        )
        writer = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "gray", str(matte)],
            stdin=subprocess.PIPE,
        )
        black = np.zeros((h, w), np.uint8).tobytes()
        frame_bytes = w * h * 3
        batch: list = []
        index, model_frames, model_s = 0, 0, 0.0

        def flush() -> None:
            nonlocal model_frames, model_s
            if not batch:
                return
            t0 = time.time()
            with torch.no_grad():
                x = torch.stack([prep(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)) for f in batch]).half().cuda()
                out = model(x)[-1].sigmoid().float().cpu().numpy()[:, 0]
            model_s += time.time() - t0
            for m in out:
                writer.stdin.write((np.clip(cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR), 0, 1) * 255).astype(np.uint8).tobytes())
            model_frames += len(batch)
            batch.clear()

        while True:
            raw = reader.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break
            if inside(index / FPS, windows):
                batch.append(np.frombuffer(raw, np.uint8).reshape(h, w, 3))
                if len(batch) == BATCH:
                    flush()
            else:
                flush()  # keep the order: the frames waiting go out before this black one
                writer.stdin.write(black)
            index += 1
        flush()
        writer.stdin.close()
        if writer.wait() != 0 or reader.wait() != 0:
            raise RuntimeError("ffmpeg failed while making the matte")

        # The preview copy: picture on top, matte below, each PROXY_SIDE on its short side.
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

        put(matte_url, matte.read_bytes(), "video/mp4")
        put(preview_url, preview.read_bytes(), "video/mp4")
        stats = {
            "windows": windows,
            "frames": index,
            "modelFrames": model_frames,
            "modelSeconds": round(model_s, 1),
            "totalSeconds": round(time.time() - t_start, 1),
            "size": [w, h],
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        # Last: the website takes cutout.json existing to mean both files are there.
        put(done_url, json.dumps(stats).encode(), "application/json")
        return stats


@app.function(image=image, secrets=[modal.Secret.from_name("komoray-render")])
@modal.fastapi_endpoint(method="POST")
def start(body: dict) -> dict:
    """Called by komoray.com (same token as render.py). Starts a cutout in the background."""
    if not hmac.compare_digest(str(body.get("token", "")), os.environ["RENDER_TOKEN"]):
        return {"error": "unauthorized"}
    call = cutout.spawn(body["videoUrl"], body["windows"], body["matteUrl"], body["previewUrl"], body["doneUrl"], body["errorUrl"])
    return {"callId": call.object_id}
