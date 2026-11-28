"""A clip whose picture starts later than the file: does the cutout's matte still sit on the picture?
A white box that moves every frame stands for the speaker, so the matte of a frame is the box of that frame.
Runs the repo's own commands (proxy_command, write_both, write_preview, the render's trims) with a local FFmpeg."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = os.environ.get("SIM_SERVER")  # on Modal: the server's own ffmpeg, and the code files copied beside this one
if SERVER:
    FF = Path(shutil.which("ffmpeg"))
    sys.path.insert(0, "/root/code")
else:
    import imageio_ffmpeg
    BIN = HERE / "bin"
    BIN.mkdir(exist_ok=True)
    FF = BIN / "ffmpeg.exe"
    if not FF.exists():
        shutil.copy(imageio_ffmpeg.get_ffmpeg_exe(), FF)
    os.environ["PATH"] = str(BIN) + os.pathsep + os.environ["PATH"]
    sys.path.insert(0, r"d:\Platform Project\komoray\modal_app")
sys.dont_write_bytecode = True
import cutout  # noqa: E402
import render  # noqa: E402

W, H, STEP, BOX = 960, 540, 5, 80  # the proxy's own size, so nothing is resampled but by the encoder
SECONDS = 5


def run(args, **kw):
    r = subprocess.run([str(FF), "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], capture_output=True, **kw)
    if r.returncode:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-800:])
    return r.stdout


def source(path, video_late, sound_late=0.0):
    run(["-itsoffset", video_late, "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r=30:d={SECONDS}",
         "-itsoffset", video_late, "-f", "lavfi", "-i", f"color=white:s={BOX}x{BOX}:r=30:d={SECONDS}",
         "-itsoffset", sound_late, "-f", "lavfi", "-i", f"sine=d={SECONDS + video_late}",
         "-filter_complex", f"[0:v][1:v]overlay=x='n*{STEP}':y=200:eval=frame:shortest=1[v]",
         "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-g", "30", "-c:a", "aac", path])


def box_left(frame):
    """Left edge of the white box in a gray picture (W x H bytes), None if there is none."""
    row = frame[(200 + BOX // 2) * W: (200 + BOX // 2 + 1) * W]
    return next((x for x, v in enumerate(row) if v > 127), None)


def frames_of(raw, h=H):
    n = W * h
    return [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]


def times(path):
    """The time FFmpeg gives each of the first frames of a file."""
    r = subprocess.run([str(FF), "-hide_banner", "-i", str(path), "-map", "0:v:0", "-vf", "showinfo", "-frames:v", "3", "-f", "null", "-"], capture_output=True, text=True)
    return [line.split("pts_time:")[1].split()[0] for line in r.stderr.splitlines() if "pts_time:" in line]


def off(pairs):
    """pairs: (picture box x, matte box x) per frame -> how many frames the matte is off."""
    diffs = [round((m - p) / STEP) for p, m in pairs if p is not None and m is not None]
    wrong = sum(1 for d in diffs if d != 0)
    common = max(set(diffs), key=diffs.count) if diffs else None
    return f"{wrong} of {len(diffs)} frames off; usual offset {common} frames"


def gray(path, extra=()):
    return run(["-i", path, "-map", "0:v:0", *extra, "-f", "rawvideo", "-pix_fmt", "gray", "-"])


for name, late in (("normal", 0.0), ("late 0.4 s", 0.4)):
    wd = (Path("/tmp/sim") if SERVER else HERE) / name.split()[0]
    wd.mkdir(parents=True, exist_ok=True)
    src, proxy, pcm, local, matte, preview = wd / "src.mp4", wd / "proxy.mp4", wd / "sound.pcm", wd / "local.h264", wd / "matte.mp4", wd / "stacked.mp4"
    source(src, late)
    cmd = render.proxy_command(src, proxy, pcm, True)
    subprocess.run([str(FF), *cmd[1:]], check=True)
    print(f"\n== {name} ==")
    print("  original, first frame times:", times(src))
    print("  preview copy, first frame times:", times(proxy))
    # The browser: one matte picture for every picture stored in the preview copy, in order.
    stored = frames_of(gray(proxy, ["-fps_mode", "passthrough"]))
    print("  pictures stored in preview copy:", len(stored), "of which black filler:", sum(box_left(f) is None for f in stored))
    mattes = b"".join(bytes(255 if v > 127 else 0 for v in f) for f in stored)
    subprocess.run([str(FF), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "10", "-pix_fmt", "gray", "-f", "h264", str(local)], input=mattes, check=True)

    for label, make in (("NOW (from preview copy)", lambda: cutout.write_both(local, proxy, (W, H), (W, H), matte, preview)),
                        ("BEFORE today (from original)", lambda: (cutout.write_preview(src, matte, preview)))):
        make()
        stacked = frames_of(gray(preview, ["-fps_mode", "passthrough"]), H * 2)
        pairs = [(box_left(f[:W * H]), box_left(f[W * H:])) for f in stacked]
        print(f"  preview after cut, {label}: {off(pairs)}")

    # The final video: the render trims the original and the matte with the same times.
    for a, b in ((0.0, 1.0), (2.0, 3.0)):
        chain = "trim=start={a}:end={b},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=30,setpts=PTS-STARTPTS"
        got = []
        for file in (src, matte):
            got.append(frames_of(run(["-i", file, "-filter_complex", f"[0:v]{chain.format(a=a, b=b)}[v]", "-map", "[v]", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "-"])))
        pairs = [(box_left(p), box_left(m)) for p, m in zip(*got)]
        print(f"  final video, kept {a}-{b} s: {off(pairs)}")
