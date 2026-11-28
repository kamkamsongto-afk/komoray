"""One round on Modal: the same simulation with the server's FFmpeg. Nothing is deployed."""
import os
import subprocess
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
CODE = Path(r"d:\Platform Project\komoray\modal_app")
app = modal.App("komoray-late-video-test")
image = modal.Image.debian_slim(python_version="3.12").apt_install("ffmpeg").pip_install("fastapi[standard]")
if modal.is_local():
    image = image.add_local_file(HERE / "sim.py", "/root/code/sim.py").add_local_file(CODE / "cutout.py", "/root/code/cutout.py").add_local_file(CODE / "render.py", "/root/code/render.py")


@app.function(image=image, cpu=2, memory=2048, timeout=600)
def go():
    version = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
    r = subprocess.run(["python", "/root/code/sim.py"], capture_output=True, text=True, env={**os.environ, "SIM_SERVER": "1"})
    proxy = Path("/tmp/sim/late/proxy.mp4")
    return version, r.stdout + r.stderr[-3000:], proxy.read_bytes() if proxy.exists() else b""


@app.local_entrypoint()
def main():
    version, out, proxy = go.remote()
    print(version)
    print(out)
    (HERE / "late" / "proxy_server.mp4").write_bytes(proxy)
