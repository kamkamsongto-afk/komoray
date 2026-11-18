"""Once a day: asks the site to run the storage clean-up (src/app/api/cron/storage, src/lib/storage-cleanup.ts).

Its own small Modal app, apart from render.py, so deploying it never touches the video renderer.
The site decides whether anything is really deleted (its STORAGE_CLEANUP secret): this only knocks, with the shared
CRON_SECRET, and prints the site's report into Modal's log.

Deploy (the test site's copy):
  KOMORAY_CRON_APP=komoray-cron-staging KOMORAY_CRON_SECRET=komoray-cron-staging python -m modal deploy modal_app/cron.py
The Modal secret it reads (made once with `modal secret create`) holds CRON_SECRET (the same as the Worker's) and SITE.
"""

import json
import os
import urllib.request

import modal

app = modal.App(os.environ.get("KOMORAY_CRON_APP", "komoray-cron"))
SECRET = os.environ.get("KOMORAY_CRON_SECRET", "komoray-cron")


@app.function(schedule=modal.Cron("0 20 * * *"), secrets=[modal.Secret.from_name(SECRET)], timeout=600, retries=0)
def storage_cleanup():
    """20:00 UTC = 03:00 in Thailand, when few people are working."""
    request = urllib.request.Request(
        f"{os.environ['SITE']}/api/cron/storage",
        data=json.dumps({"apply": True}).encode(),
        method="POST",
        # Our own name: Cloudflare's bot check refuses Python's ("Python-urllib", error 1010; docs/bugs.md).
        headers={"Authorization": f"Bearer {os.environ['CRON_SECRET']}", "Content-Type": "application/json", "User-Agent": "KomorayCron/1.0"},
    )
    with urllib.request.urlopen(request, timeout=540) as res:
        print(res.read().decode()[:4000])
