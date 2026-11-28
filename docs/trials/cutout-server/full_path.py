# Trial of plan A from end to end (scratch app, not the project's): the website asks once; Modal cuts the speaker out
# of the whole preview copy on several machines, each also making its stretch of matte.mp4 and proxy-cutout.mp4 (the
# two files finish_local makes today, same settings), then joins them and uploads. Timed from the ask to the answer,
# with the machines cold (a new app each run).
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import modal

app = modal.App("komoray-scratch-full-path")
MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite"
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "libegl1", "libgles2", "curl")
    .pip_install("mediapipe", "numpy")
    .run_commands(f"curl -fsSL -o /selfie.tflite {MODEL}")
)
FPS, MATTE_SIDE, PROXY_SIDE, KEY_FRAMES = 30, 1080, 540, 15  # as in modal_app/cutout.py
CORES, MEMORY = 4, 3072
MOST_MACHINES = 10


def run(cmd: list) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-700:])
    return result.stdout


def size_of(src: str, side: int) -> tuple[int, int]:
    """Upright width and height with the short side brought to `side` (picture_size in cutout.py)."""
    first = Path(tempfile.mkdtemp()) / "first.png"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-frames:v", "1", "-vf", f"scale='if(gt(iw,ih),-2,min({side},iw))':'if(gt(iw,ih),min({side},ih),-2)'", str(first)])
    w, h = run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(first)]).strip().split(",")[:2]
    return int(w), int(h)


def even(n: float) -> int:
    return max(2, round(n / 2) * 2)


@app.function(image=image, cpu=CORES, memory=MEMORY, timeout=900, scaledown_window=2)
def stretch(proxy_url: str, first: int, count: int, w: int, h: int) -> dict:
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    began = time.time()
    d = Path(tempfile.mkdtemp())
    proxy = d / "proxy.mp4"
    urllib.request.urlretrieve(proxy_url, proxy)
    got = time.time()
    pw, ph = size_of(str(proxy), PROXY_SIDE)
    iw, ih = (256, even(256 * ph / pw)) if ph >= pw else (even(256 * pw / ph), 256)
    seek = ["-ss", f"{first / FPS:.6f}", "-i", str(proxy)]
    reader = subprocess.Popen(["ffmpeg", "-v", "error", *seek, "-frames:v", str(count), "-vf", f"scale={iw}:{ih}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    side = f"scale='if(gt(iw,ih),-2,{PROXY_SIDE})':'if(gt(iw,ih),{PROXY_SIDE},-2)'"
    graph = (f"[1:v]split[a][b];[a]scale={w}:{h}:flags=bicubic[full];"
             f"[0:v]{side},fps={FPS},format=yuv420p[p];[b]scale={pw}:{ph}:flags=bicubic,format=yuv420p[m];[p][m]vstack=shortest=1[stack]")
    writer = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", *seek, "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{iw}x{ih}", "-r", str(FPS), "-i", "-", "-filter_complex", graph,
         "-map", "[full]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-g", str(FPS), "-pix_fmt", "gray", str(d / "matte.mp4"),
         "-map", "[stack]", "-frames:v", str(count), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-tune", "fastdecode", "-bf", "0",
         "-g", str(KEY_FRAMES), "-keyint_min", str(KEY_FRAMES), "-sc_threshold", "0", str(d / "preview.mp4")],
        stdin=subprocess.PIPE,
    )
    options = vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path="/selfie.tflite"), running_mode=vision.RunningMode.VIDEO, output_confidence_masks=True, output_category_mask=False)
    n = 0
    with vision.ImageSegmenter.create_from_options(options) as model:
        while True:
            raw = reader.stdout.read(iw * ih * 3)
            if len(raw) < iw * ih * 3:
                break
            frame = np.frombuffer(raw, np.uint8).reshape(ih, iw, 3).copy()
            mask = model.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(n * 1000 / FPS) + 1).confidence_masks[-1].numpy_view()
            writer.stdin.write((mask.reshape(ih, iw) * 255).astype(np.uint8).tobytes())
            n += 1
    writer.stdin.close()
    if writer.wait() or reader.wait():
        raise RuntimeError("ffmpeg failed on a stretch")
    if n != count:
        raise RuntimeError(f"stretch from {first}: {n} frames, {count} wanted")
    return {"matte": (d / "matte.mp4").read_bytes(), "preview": (d / "preview.mp4").read_bytes(), "seconds": time.time() - began, "download": got - began}


def put(url: str, path: Path) -> None:
    urllib.request.urlopen(urllib.request.Request(url, data=path.read_bytes(), method="PUT", headers={"Content-Type": "video/mp4"}), timeout=300).close()


def frames_of(path: str) -> int:
    return int(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path]).strip().split(",")[0])


@app.function(image=image, cpu=2, memory=4096, timeout=900, scaledown_window=2)
def whole(proxy_url: str, source_url: str, limit: int, matte_url: str, preview_url: str, most: int) -> dict:
    began = time.time()
    d = Path(tempfile.mkdtemp())
    proxy = d / "proxy.mp4"
    urllib.request.urlretrieve(proxy_url, proxy)
    frames = frames_of(str(proxy))
    frames = min(frames, limit) if limit else frames
    w, h = size_of(source_url, MATTE_SIDE)  # only the start of the original is read, over its link
    machines = max(1, min(most, round(frames / 1200)))
    per = (frames + machines - 1) // machines
    jobs = [(proxy_url, a, min(per, frames - a), w, h) for a in range(0, frames, per)]
    ready = time.time()
    results = list(stretch.starmap(jobs))
    cut = time.time()
    out = {}
    for name in ("matte", "preview"):
        listing = d / f"{name}.txt"
        for k, r in enumerate(results):
            (d / f"{name}-{k}.mp4").write_bytes(r[name])
        listing.write_text("".join(f"file '{d / f'{name}-{k}.mp4'}'\n" for k in range(len(results))))
        run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(d / f"{name}.mp4")])
        out[name] = d / f"{name}.mp4"
    joined = time.time()
    put(matte_url, out["matte"])
    put(preview_url, out["preview"])
    done = time.time()
    shapes = {name: run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)]).strip() for name, path in out.items()}
    return {
        "frames": frames, "video_seconds": round(frames / FPS, 1), "machines": len(jobs),
        "frames_in_files": {name: frames_of(str(path)) for name, path in out.items()}, "sizes": shapes,
        "MB": {name: round(path.stat().st_size / 1e6, 1) for name, path in out.items()},
        "step_seconds": {"read_inputs": round(ready - began, 1), "cut_and_encode": round(cut - ready, 1), "join": round(joined - cut, 1), "upload": round(done - joined, 1), "inside_total": round(done - began, 1)},
        "stretch_seconds": {"slowest": round(max(r["seconds"] for r in results), 1), "sum": round(sum(r["seconds"] for r in results)), "slowest_download": round(max(r["download"] for r in results), 1)},
    }


@app.local_entrypoint()
def main(links_file: str, limit: int = 0, label: str = "", most: int = MOST_MACHINES):
    links = json.loads(Path(links_file).read_text())
    asked = time.time()
    res = whole.remote(links["proxy"], links["source"], limit, links["matte_put"], links["preview_put"], most)
    res["asked_to_done_s"] = round(time.time() - asked, 1)
    # list price (modal billing rates, 28 Nov): CPU $0.0473 a core-hour, memory $0.008 a GiB-hour; running time only
    part = res["stretch_seconds"]["sum"] * (CORES * 0.0473 + MEMORY / 1024 * 0.008) / 3600
    lead = res["step_seconds"]["inside_total"] * (2 * 0.0473 + 4 * 0.008) / 3600
    res["cost_usd_from_running_time"] = round(part + lead, 4)
    print("RESULT", label, json.dumps(res))
