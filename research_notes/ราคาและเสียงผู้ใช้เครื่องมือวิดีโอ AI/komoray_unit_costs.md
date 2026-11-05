# Komoray unit costs: real cost per source minute (researched 4 Nov 2026)

Labels used throughout. **[M]** measured or reported by the project (PROGRESS.md, git). **[V]** vendor list price or vendor statement, fetched 4 Nov 2026. **[R]** read from the code, not run. **[A]** my assumption, replace with real data when available. **[C]** computed from the others. Nothing here was run against production, no paid API was called, and `.dev.vars` was not opened.

Headline: Base cost is about **$0.0078 per source minute for a Free user** and about **$0.0214 for a Pro user** (a 7-minute clip costs $0.055 and $0.15). Deepgram is the largest cost for Free. Translation is the largest for Pro. An uploader who abandons a 10-minute clip costs about **$0.06**, about 70% of it Deepgram. The bigger financial risk is not normal use: `/api/analyze`, `/api/render` and `/api/translate` have no per-user limit, and there is no duration limit at all.

## 1) What are the unit prices?

### Takeaway
All prices below were fetched today. Two open items can move the model: whether Deepgram's opt-out doubles the rate (sources conflict), and how many CPU cores FFmpeg really bills on Modal (the code sets no cap).

### Cited Findings

| Driver | Unit price [V], 4 Nov 2026 | Source |
|---|---|---|
| Deepgram Nova-3 Monolingual, pre-recorded, pay as you go | $0.0043/min (Growth $0.0036) | [Deepgram pricing](https://deepgram.com/pricing) |
| Deepgram Nova-3 Multilingual (not used by Komoray) | $0.0052/min (Growth $0.0043) | [Deepgram pricing](https://deepgram.com/pricing) |
| Deepgram Smart Formatting (used) | Included | [Deepgram pricing](https://deepgram.com/pricing) |
| Deepgram free credit | $200, no expiry, no card | [Deepgram pricing](https://deepgram.com/pricing) |
| Deepgram pre-recorded concurrency, Nova-3 | 50 requests per region, per project | [Deepgram rate limits](https://developers.deepgram.com/reference/api-rate-limits) |
| Modal CPU | $0.0000131 per physical core per second (1 physical core = 2 vCPU) | [Modal pricing](https://modal.com/pricing) |
| Modal memory | $0.00000222 per GiB per second | [Modal pricing](https://modal.com/pricing) |
| Modal network egress | $0.04/GiB; Starter includes 1 TiB/month free | [Modal pricing](https://modal.com/pricing) |
| Modal Starter / Team | $0 + compute, $30/month credit, 100 containers / $250 + compute, $100 credit, 5,000 containers | [Modal pricing](https://modal.com/pricing) |
| Modal multipliers | Non-preemptible 3x; region selection 1.15x (broad) to 1.75x (narrow), only when a container region is set | [Modal pricing](https://modal.com/pricing); [Modal region selection](https://modal.com/docs/guide/region-selection) |
| Modal GPU, entry tier | T4 $0.000164/s, L4 $0.000222/s, A10 $0.000306/s | [Modal pricing](https://modal.com/pricing) |
| R2 Standard storage | $0.015/GB-month; 10 GB-month free | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Class A / Class B | $4.50 / $0.36 per million; 1M / 10M free per month; DeleteObject free | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 egress | Free | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Workers Paid | $5/month minimum; 10M requests then $0.30/M; 30M CPU ms then $0.02/M ms; no bandwidth charge; subrequests not billed | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers Logs | 20M events included, $0.60/M after; moves to Cloudflare Observability pricing on 1 Dec 2026, new rate not found | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/); [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Claude Sonnet 5.5 | $2 input, $10 output per MTok; batch $1/$5 | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Translation, project figure | **[M]** about $0.05 per 250 subtitle lines, i.e. $0.0002 per line. This is the project's reported number, not a vendor price | PROGRESS.md line 211 |
| Supabase Free | $0; 50,000 MAU, 500 MB database, 5 GB egress, 1 GB files, 2 active projects, paused after 1 week idle | [Supabase pricing](https://supabase.com/pricing) |
| Supabase Pro | From $25/month with $10 compute credit; 100,000 MAU, 8 GB database, 250 GB egress, never paused for inactivity | [Supabase pricing](https://supabase.com/pricing) |
| Paddle | 5% + 50¢ per checkout transaction; no monthly fee | [Paddle pricing](https://www.paddle.com/pricing) |

Other vendor facts that shape the model:
- CPU and memory bill on "whichever is higher: your request or actual usage". Containers have "a default soft CPU limit that is set at 16 physical cores above the CPU request" — [Modal resources](https://modal.com/docs/guide/resources).
- Idle containers: "By default, the maximum idle time is 60 seconds", configurable down to 2 seconds, and "you will be billed for any resources used while the container is idle" — [Modal cold start](https://modal.com/docs/guide/cold-start). The autoscaler may shut down earlier when over-provisioned (same page).
- Default inputs route through `us-east`; a multiplier applies only "to any Function or Sandbox that has a container region defined" — [Modal region selection](https://modal.com/docs/guide/region-selection).
- Deepgram opt-out, sources conflict:
  - Deepgram's API reference tells users to "Refer to our Docs for pricing impacts" — [Deepgram reference, via search result](https://developers.deepgram.com/reference/speech-to-text/listen-streaming). The current [program page](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program) and [pricing page](https://deepgram.com/pricing) state no price effect.
  - A competitor's Feb 2026 article says opting out means "forgoing the 50% discount, thereby doubling the listed rates" — [Gladia](https://www.gladia.io/blog/deepgram-pricing). Gladia sells a rival product.
  - An Oct 2026 pull request says "We checked this with Deepgram directly and they confirmed opting out no longer makes any pricing difference" — [postiz PR #2287](https://github.com/gitroomhq/postiz-app/pull/2287). Second-hand, contact not named.

Project facts:
- **[R]** `model: "nova-3"`, `smart_format`, `callback`, `mip_opt_out: "true"`, `language` is a single code — `src/lib/transcribe.ts:19`. Allowed codes are the 16 measured languages (`src/lib/languages.ts`), so `multi` is not sent and the Monolingual rate applies.
- **[R]** Modal jobs (`modal_app/render.py`):
  - `render` at :894, cpu=4, memory=4096: the final video from the original.
  - `proxy` at :1051, cpu=4, memory=4096: 540p copy, PCM sound, face scan (:1072) and thumbnail (:1077), all in one job.
  - `faces` at :1037, cpu=2, memory=2048: only for preview copies made before faces existed, or when faces.json is missing.
  - `start` at :1092, no cpu or memory set, so the 0.125 core / 128 MiB default: the web endpoint that spawns jobs.
- **[R]** No `region=`, `nonpreemptible`, `retries`, `scaledown_window` or CPU limit tuple anywhere in `render.py`. No `-threads` in the FFmpeg commands (:874-883, :977-987).
- **[R]** All functions have `timeout=30 * 60` except `start`.
- **[M]** PROGRESS.md has no section called "Expense". Scattered figures: Workers Paid ~$5/month with a $10 Budget alert (line 26), Modal credit $1/month without a card and $30 with one (line 118), Deepgram language tests ~$1–2 total (line 194), translation figure (line 211), Google Workspace ~$7/month when needed (line 267), opt-out cost unknown (line 239). The Modal card is not yet attached (lines 232, 266).

### Inferences
- **[C]** 4-core job rate: 4 × $0.0000131 + 4 GiB × $0.00000222 = **$0.00006128/s**. 2-core job rate: **$0.00003064/s**. `start`: $0.0000019/s, about $0.00012 per wake-up with idle, negligible.
- **[C]** No region multiplier applies: the code sets no container region, so `us-east` in the hostname is consistent with Modal's default input routing and implies 1.0x. Modal's page does not explain the hostname itself.
- **[C]** One idle minute after a job costs 60 × $0.00006128 = **$0.0037**. That is about 85% of a Deepgram minute, paid per job and not per minute, so short clips are relatively expensive.

### Gaps
- Deepgram opt-out effect is unresolved. Decisive check: Deepgram Console → Usage for one new clip. A 7-minute clip should show **$0.0301** at list price or **$0.0602** if doubled. PROGRESS.md line 239 already lists this as open.
- No Deepgram page states Thai is priced the same. The pricing page only separates Monolingual and Multilingual, with no per-language table, so Thai at $0.0043 is an inference.
- Modal billed cores are unknown. "~69 fps on 4 CPU" (PROGRESS.md line 189) describes the request, not confirmed usage. Check the Modal usage page against one render of known length. At 100 s: $0.0061 if billed at 4 cores, $0.0114 at 8, $0.0271 at the soft cap of 20.
- Cloudflare Observability pricing from 1 Dec 2026 was not found.

## 2) What does one source minute cost for a Free user and a Pro user?

### Takeaway
At a 7-minute reference clip, Free costs $0.0060 / **$0.0078** / $0.0167 per source minute and Pro costs $0.0128 / **$0.0214** / $0.0419. The Pro base figure without translation is $0.0114.

### Cited Findings
Project measurements and inputs:
- **[M]** 7-minute Thai clip, 482 MB source: Find silences 137 s, 84 s cut, Make video 95 s, final 112 MB (PROGRESS.md line 128). With zoom about 100 s (line 172). Smooth zoom about 69 fps on 4 CPU, "about 3 minutes" for 7 minutes (line 189).
- **[R]** PCM is mono, 16-bit, 24 kHz (`render.py:957`).
- **[R]** Lifecycle: `uploads/` deleted after 14 days (PROGRESS.md line 131). Long-term plan is to keep files with a storage cap per plan (line 294).
- Vendor prices are in section 1.

No measurement of proxy job duration exists in PROGRESS.md or the git log I searched.

### Inferences
**Modal seconds per source minute**

| Job | Low | Base | High | Label |
|---|---|---|---|---|
| Proxy + faces + thumb | 8.6 s (60 s per 7 min) | 14.3 s (100 s) | 22.9 s (160 s) | **[A]** not measured |
| of which face scan, base | | ~5 s (35 s per 7 min) | | **[A]** |
| Render, no zoom | 13.6 s (95/7) | 14.3 s (100/7) | 14.3 s | **[M]** |
| Render, Smooth zoom | 25.7 s (180/7) | 26.1 s (183/7) | 26.1 s | **[M]** 12,600 frames / 69 fps = 183 s |
| Billing rate | 4 cores | 4 cores | 8 cores, $0.00011368/s | High is **[A]** |
| Idle after each job | 0 s | 60 s | 70 s (with cold start) | **[V]** default, usage **[A]** |

**Proxy and face detection, base [C]:** transcode 65 s × $0.00006128 / 7 = $0.00057 per source minute; face scan 35 s × $0.00006128 / 7 = $0.00031. Total **$0.00088**. They run in one job, so they cannot be avoided separately today.

**Rendering per source minute by number of renders, base [C].** The second figure includes $0.000525 per render for 60 s idle spread over a 7-minute clip.

| Renders | No zoom | No zoom + idle | Smooth zoom | Smooth + idle |
|---|---|---|---|---|
| 1 | $0.00088 | $0.00140 | $0.00160 | $0.00213 |
| 2 | $0.00175 | $0.00280 | $0.00320 | $0.00425 |
| 3 | $0.00263 | $0.00420 | $0.00481 | $0.00638 |

**Storage per source minute**

| File | MB/min | Label | 14 days | 30 days | 90 days |
|---|---|---|---|---|---|
| Source | 68.86 (482/7) | **[M]** | $0.00048 | $0.00103 | $0.00310 |
| proxy.mp4 | 6.5 | **[A]** see note | $0.00005 | $0.00010 | $0.00029 |
| proxy-audio.pcm | 2.88 (24,000 × 2 × 60 / 1e6) | **[C]** | $0.00002 | $0.00004 | $0.00013 |
| final.mp4 | 16 (112/7; 20 per final minute) | **[M]** | $0.00011 | $0.00024 | $0.00072 |
| **All** | **94.24** | | **$0.00066** | **$0.00141** | **$0.00424** |
| Whole 7-minute clip | 660 MB | **[C]** | $0.0046 | $0.0099 | $0.0297 |

Formula: MB / 1000 × $0.015 × days / 30. Note on proxy size: the only hint is an example in a code comment, "bytes 0-1048575/45688867" (`src/lib/player/bytes.ts:75`), 45.7 MB, which would be 6.5 MB/min only if it was the 7-minute clip. That link is unproven. Low 5, high 10 MB/min **[A]**. Re-renders overwrite `final.mp4` (`src/app/api/render/route.ts:44`), so more renders do not add stored files.

Keep-forever plan **[C]**: each full GB costs $0.015/month, so a 50 GB cap costs up to $0.75/month and a 100 GB cap up to $1.50/month per user at the cap.

**Playback through `/api/media` [C].** 1 MiB blocks (`bytes.ts:10`). Proxy 6.5 MB/min = 6.2 blocks; PCM 2.88 MB/min = 2.75 blocks. Total **about 9 Worker requests and 9 Class B reads per minute played**, on first play. Cost at the margin beyond the free allowance:
- Requests: 9 × $0.30/M = $0.0000027
- Class B: 9 × $0.36/M = $0.0000032
- CPU: 18 ms at 2 ms per request **[A]** = $0.0000004
- Total **$0.0000063 per minute played**. Bandwidth is free. This cost is too small to affect a plan decision.

**Translation.** $0.0002 per line **[M]**. `translate.ts:5` confirms `claude-sonnet-5-5`; the route sends 40 lines per call (`src/app/api/translate/route.ts:13`). Lines per source minute **[A]**, derived from `LINE_LIMITS` (`render.py:61`):
- Low 20: "two" look, 3 s cap.
- Base 50: "normal" look, 3 words per line at 150 words per minute.
- High 90: "big" look, 2 words per line at 180 words per minute.
- Thai "normal" has a floor of about 27 lines/min from its 2.2 s cap.

Rough check against Sonnet 5.5 list price **[A]** on tokens: one batch at ~530 input and ~400 output tokens is about $0.005, or $0.03 for 250 lines. Same order as the reported $0.05.

**Deliverable table: cost per source minute at a 7-minute clip [C]**

Free = 1 render, no zoom, 14-day retention. Pro = 2 renders with Smooth zoom, 30-day retention, 1 translation.

| Item | Free low | Free base | Free high | Pro low | Pro base | Pro high |
|---|---|---|---|---|---|---|
| Deepgram | $0.00430 | $0.00430 | $0.00860 | $0.00430 | $0.00430 | $0.00860 |
| Proxy + faces | $0.00053 | $0.00088 | $0.00260 | $0.00053 | $0.00088 | $0.00260 |
| Render(s) | $0.00083 | $0.00088 | $0.00162 | $0.00315 | $0.00320 | $0.00594 |
| Modal idle | $0 | $0.00105 | $0.00123 | $0 | $0.00158 | $0.00184 |
| R2 storage | $0.00035 | $0.00066 | $0.00128 | $0.00075 | $0.00141 | $0.00274 |
| Modal egress | $0 | $0 | $0.00128 | $0 | $0 | $0.00207 |
| R2 ops + Workers | $0.00003 | $0.00005 | $0.00009 | $0.00004 | $0.00006 | $0.00010 |
| Translation | n/a | n/a | n/a | $0.00400 | $0.01000 | $0.01800 |
| **Total per minute** | **$0.00604** | **$0.00781** | **$0.01670** | **$0.01276** | **$0.02143** | **$0.04188** |
| 7-minute clip | $0.042 | $0.055 | $0.117 | $0.089 | $0.150 | $0.293 |
| 60 source minutes | $0.36 | $0.47 | $1.00 | $0.77 | $1.29 | $2.51 |

Case definitions **[A]**:
- Low: list Deepgram, measured render time, proxy 60 s, no idle, source 30 MB/min, final 12 MB/min.
- Base: list Deepgram, measured source size, 60 s idle.
- High: Deepgram doubled, 8 cores billed, proxy 160 s, source 150 MB/min (4K), final 20 MB/min, Modal egress paid above the free 1 TiB.
- Ops: 30 Class A per video and Worker usage of about 210 requests per video (polls at 3 s and 5 s, 20 saves, 1.5 plays, 20 ms per API call).

Clip length changes the Free base figure because idle is per job: **1-minute clip $0.0144/min, 3-minute $0.0093, 7-minute $0.0078, 30-minute $0.0070.**

Decision aid for the founder **[C]**: at base, a Free allowance of 30 min/month costs $0.23 per fully active user, and 60 min costs $0.47. For a Pro user at 120 min/month: $2.57 model cost + $1.45 Paddle = $4.02 against $19, about 79% gross margin before fixed costs.

Offsets not in the table **[C]**: Deepgram's $200 credit covers 46,512 minutes once. Modal's $30/month covers 136 hours of 4-core time. R2's 10 GB-month is shared across all users.

### Gaps
- Proxy job duration, real proxy.mp4 size, real re-render count per video and real minutes played are not measured. The Modal dashboard and R2 object sizes would answer the first two. I did not query them because production access was excluded.
- Whether Modal counts PUTs to R2 as billed egress was not confirmed. I assumed yes in the high case only.
- Scene Swap is not in these tables (section 4).

## 3) What does a user cost if they upload a 10-minute clip and abandon it?

### Takeaway
Uploading alone costs only about **$0.005** because nothing runs until the user presses `Find silences`. After that press, Deepgram and the proxy + face job both start immediately: **$0.051 / $0.061 / $0.133** low / base / high, even if the user never presses `Make video`.

### Cited Findings
Code trace **[R]**:
1. `/api/upload-url` signs a PUT and inserts the project row. No processing starts — `src/app/api/upload-url/route.ts:35,38`.
2. After the upload, the page only stores the key — `src/app/upload/page.tsx:105-111`. **Transcription is not automatic on upload**: it needs the `Find silences` button — `upload/page.tsx:249-253`, calling POST `/api/analyze` at :136.
3. POST `/api/analyze` starts Deepgram (`src/app/api/analyze/route.ts:37`) and then, in the same request, the proxy job (:39-43).
4. The `proxy` job also runs the face scan and thumbnail — `modal_app/render.py:1070-1080`.
5. On `done`, the browser moves to `/edit` by itself — `upload/page.tsx:151`.
6. `/edit` calls GET `/api/analyze` (`src/app/edit/page.tsx:145`). That GET starts a proxy if status is `none` (`route.ts:70`) and starts the 2-core `faces` job if proxy is done and faces.json is missing (`route.ts:81`, `src/lib/proxy.ts:45-67`). For a normal new clip faces.json already exists, so `faces` does not run again.
7. Only `makeVideo` posts to `/api/render` — `edit/page.tsx:470`.

The brief's assumption that these steps run "automatically on upload or open of /edit" is partly wrong: the trigger is the `Find silences` click, which comes before `/edit` opens.

### Inferences
**Cost table, 10-minute clip, 14-day retention [C]**

| Item | Arithmetic (base) | Low | Base | High |
|---|---|---|---|---|
| Deepgram | 10 × $0.0043 | $0.0430 | $0.0430 | $0.0860 |
| Proxy + faces | 143 s × $0.00006128 | $0.0053 | $0.0088 | $0.0260 |
| Modal idle | 60 s × $0.00006128 | $0 | $0.0037 | $0.0043 |
| R2 storage, no final | 0.782 GB × $0.015 × 14/30 | $0.0027 | $0.0055 | $0.0114 |
| Modal egress | | $0 | $0 | $0.0050 |
| R2 ops + Workers | | $0.0002 | $0.0004 | $0.0007 |
| **Total** | | **$0.051** | **$0.061** | **$0.133** |
| Upload only, never pressed the button | 0.689 GB × $0.015 × 14/30 | $0.0021 | $0.0048 | $0.0105 |

Scale **[C]**: 1,000 signups who each do this cost about $61, and 10,000 cost about $613. Deepgram's one-time $200 credit would cover the transcription of the first 4,651 such clips (46,512 min / 10 min). The other $0.018 per clip is still paid.

### Gaps
- Actual abandon rate is unknown because there are no outside users yet (PROGRESS.md lines 3, 253).

## 4) What are the monthly fixed costs at 100, 1,000 and 10,000 signups, and when is Supabase Pro needed?

### Takeaway
Fixed costs are small: about **$5 at 100 signups and about $37 at 1,000 and 10,000**. Usage-based cost dominates at scale: about $712/month at 10,000 signups under my assumptions.

### Cited Findings
- Prices: section 1 ([Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Supabase](https://supabase.com/pricing), [Modal](https://modal.com/pricing)).
- **[M]** Google Workspace ~$7/month, when replies become regular; Brevo stays free (PROGRESS.md lines 228, 267, 296).
- **[M]** Supabase is on Free now, us-west-2 (line 33).

### Inferences
**Usage assumptions [A]:** 30% of signups active each month, 30 source minutes per active user, Free profile, 7-minute clips. Change these first when real data exists.

| Monthly | 100 signups | 1,000 signups | 10,000 signups | Label |
|---|---|---|---|---|
| Active users / source minutes | 30 / 900 | 300 / 9,000 | 3,000 / 90,000 | **[A]** |
| Workers Paid | $5 | $5 | $5 | **[V]** |
| Supabase | $0 Free | $25 Pro | $25 Pro | **[V]**, timing **[A]** |
| Google Workspace | $0 | ~$7 | ~$7 | **[M]** |
| Modal plan fee | $0 Starter | $0 Starter | $0 Starter | **[V]** |
| **Fixed subtotal** | **$5** | **$37** | **$37** | **[C]** |
| Deepgram | $3.87 | $38.70 | $387.00 | **[C]** |
| Modal compute, net of $30 credit | $0 ($2.52 gross) | $0 ($25.21 gross) | $222.12 ($252.12 gross) | **[C]** |
| R2 storage, net of 10 GB | $0.44 | $5.79 | $59.22 | **[C]** |
| Modal egress above 1 TiB | $0 | $0 | ~$44 (2,127 GiB) | **[C]**, assumes R2 PUTs count |
| Workers overage | $0 | $0 | ~$0.04 | **[C]** |
| **Usage subtotal** | **$4.31** | **$44.49** | **~$712** | **[C]** |

Workers usage at 10,000 signups: about 2.7M requests (10M included) and about 32M CPU ms (30M included). So CPU is the first Worker limit, at a 20 ms per API call **[A]**. R2 ops stay within free tiers (about 386,000 Class A, 4.0M Class B). Modal averages about 1 container, so 100 containers is plenty for normal load, and Team at $250 is not needed for capacity.

**When Supabase Pro is needed [A, judged from V].** MAU is not the limit, since Free includes 50,000. Practical triggers:
- Paying customers, because login depends on a project that Free can pause after 1 idle week.
- The 5 GB egress: the analyze, render and translate routes check `ownsVideo`, so polling generates Supabase traffic. Not measured.
- The 500 MB database, least likely soon: rows are small.

Recommendation: move to Pro by public launch (15 Dec per PROGRESS.md line 19) or the first paid plan, whichever comes first.

Excluded: domain renewal (price not in the project and not looked up), legal review, marketing, Supabase custom domain.

**Scene Swap, planned GPU.** **Throughput is unknown; PROGRESS.md line 199 says cost has not been measured on GPU.** Hypothetical sensitivity only **[C/A]**, at 1,800 frames per source minute, GPU + 4 cores + 8 GiB:

| GPU (list per second) | at 5 fps | at 15 fps | at 30 fps |
|---|---|---|---|
| T4 $0.000164 ($0.59/h) | $0.084/min | $0.028/min | $0.014/min |
| L4 $0.000222 ($0.80/h) | $0.105/min | $0.035/min | $0.018/min |
| A10 $0.000306 ($1.10/h) | $0.135/min | $0.045/min | $0.023/min |

Even at 30 fps on a T4, this is close to double the whole Free base cost per minute, so it should not be in a Free plan until measured. Modal GPU also requires a card on file (line 232).

### Gaps
- Real Supabase egress per user, real active rate and real minutes per user are unknown.

## 5) Where does cost leak, and what is the maximum one abuser can cost per day?

### Takeaway
Within the 20-upload limit, one abuser can cost about **$1 to $64 per day** depending on file bitrate, because there is a size limit but **no duration limit**. Outside it, re-transcribing and re-rendering are not limited at all: the ceiling is set by vendor concurrency, roughly **$529/day on Modal and $949/day on Deepgram** in theory, shared across all users.

### Cited Findings
Limits that exist in code **[R]**:
- 500 MB, MP4/MOV by declared content type — `src/app/api/upload-url/route.ts:6-7,22-26` and `src/app/api/phone/route.ts:17-18,69-70`.
- 20 uploads per 24 hours per account, admin exempt — `src/lib/upload-limit.ts:5,10`.
- Modal job timeout 30 minutes — `render.py:894,1037,1051`.
- **No maximum duration anywhere.** A search of `src` and `modal_app` for duration limits found none. Nothing checks actual file contents before Deepgram.
- Vendor ceilings: 50 concurrent Deepgram requests ([limits](https://developers.deepgram.com/reference/api-rate-limits)); 100 containers on Modal Starter ([pricing](https://modal.com/pricing)).

### Inferences
**500 MB in minutes [C]:** at the measured 9.2 Mbps, 7.3 min; 4 Mbps, 16.7 min; 1 Mbps, 66.7 min; 500 kbps, 133 min; 100 kbps, 11.1 hours.

**Abuser cost per day, within the 20-upload limit, list prices, one render each [C]**

| File type | Minutes/day | Deepgram | Proxy (30 min cap) | Render (30 min cap) | Idle | Storage, 14 days | **Total/day** |
|---|---|---|---|---|---|---|---|
| Measured bitrate | 145 | $0.62 | $0.13 | $0.13 | $0.15 | $0.10 | **$1.12** |
| 500 kbps, 133 min each | 2,666 | $11.46 | $2.21 | $2.21 | $0.15 | $0.54 | **$16.57** |
| 100 kbps, 11.1 h each | 13,334 | $57.34 | $2.21 | $2.21 | $0.15 | $2.44 | **$64.33** |

If Deepgram's opt-out doubles the rate, Deepgram figures double. Very long jobs would hit the Modal timeout, as discussed below. Not tested.

**Leak list [R, costs C]** — all read from code, none exploited.

| # | Leak | Where | Maximum per abuser per day | Status |
|---|---|---|---|---|
| 1 | No duration limit | `upload-url/route.ts:7` only checks size | $64.33 (above) | Confirmed from code |
| 2 | Repeat POST `/api/analyze` on one clip: each call pays Deepgram again. No limit, no in-progress check. Normal users reach it via `Wrong language?` | `analyze/route.ts:20-37`; `edit/page.tsx:605-607` | $2.87 per call on an 11.1-hour file. Theory: 50 concurrent × 1,440 min × 3.07 audio-min per min × $0.0043 = **$949/day**, using the measured 137 s for 7 min | Confirmed no limit; ceiling is theoretical and shared |
| 3 | Unlimited re-renders, also in parallel. POST deletes the last result and spawns a new job without checking `render.json` or cancelling. Leaving the page does not stop the job | `render/route.ts:44-45,64` | 100 containers × 86,400 s × $0.00006128 = **$529/day** ($982 at 8 cores), about 4,800 POSTs on long clips. Ordinary user: 10 Smooth re-renders of 7 minutes = $0.15 | Confirmed no limit; ceiling is shared |
| 4 | Translation has no limit. 33 languages per clip; no lock, so parallel calls can pay for the same batch | `translate/route.ts:41-50` | 133-min clip: 6,650 lines × $0.0002 × 33 = **$43.89**; 11.1-hour clip **$220**. 7-minute clip $2.40. Parallel repeats limited only by Anthropic rate limits, not looked up | Confirmed from code |
| 5 | Upload limit resets on delete: it counts rows, and deleting a project removes its row | `upload-limit.ts:12`; `src/app/api/projects/route.ts:14` | Makes the $64.33 above open-ended | Confirmed from code, not tried |
| 6 | QR route bypass: limit checked only at `create`, not at `claim`. Links can be created while under 20, then all claimed | `phone/route.ts:48,96` | Open-ended, same unit costs | Confirmed from code, not tried |
| 7 | Work before commitment: Deepgram and proxy start together on first click, before the user sees anything | `analyze/route.ts:37-43` | $0.061 per abandoned 10-minute clip | Confirmed |
| 8 | Default 60 s idle on every job | No `scaledown_window` in `render.py` | $0.0037 per job, or about 13% of the Free base cost per minute at 7 minutes | Vendor default; billing basis on idle unconfirmed |
| 9 | Possible CPU burst: no CPU limit or `-threads`, so FFmpeg can bill above the 4-core request | `render.py:894,1051,874-883` | Up to 4.4x Modal job cost at the 20-core soft cap | **Suspected**, needs Modal usage check |
| 10 | Retry loop on jobs longer than 30 minutes: the timeout may kill the job before an error file is written, `proxyStatus` then returns `none` after 30 minutes, and each open `/edit` poll can start a new job | `proxy.ts:18,27`; `analyze/route.ts:70`; `edit/page.tsx:178-188`, `render.py:1051` | $0.11 per 30 minutes per open tab, about $5.30/day | **Suspected**, not run |
| 11 | Storage: 20 × 500 MB/day × 14 days = 140 GB source held steady | `upload-limit.ts:5`, lifecycle | $2.10/month per abuser at steady state, more with leaks 5 and 6 | Confirmed arithmetic |
| 12 | Phone uploads never claimed stay until the 14-day rule | `phone/route.ts:14,75` | Storage only | Confirmed from code |

Ways to close these **[A: my recommendations, not implemented]**, largest effect first:
- Enforce a minutes quota, using duration read from the file before calling Deepgram.
- Add per-account limits on analyze, render and translate.
- Reject render or analyze while one is in progress.
- Count uploads in a table that deletes do not change, and recheck at QR claim.
- Set `scaledown_window` low and `cpu=(4, 4)` once measured. Any `render.py` change must follow AGENTS.md section 6 review rules.
- Set vendor spend alerts. PROGRESS.md only records a Cloudflare Budget alert (line 26).

### Gaps
- Deepgram's maximum file length, processing time and over-limit error were not on the page I fetched, so the 11.1-hour case may be refused or time out. Not tested, because that would be a paid call.
- Whether Deepgram bills for failed or timed-out jobs is not known.
- Whether Modal or Deepgram offer hard spend caps was not checked.
- Anthropic rate limits on the project's tier were not checked.

## 6) How do payment fees hit $19 monthly vs $190 annual, and does Paddle accept Thai sellers?

### Takeaway
Paddle takes **7.63% on $19 monthly and 5.26% on $190 annual**. Paddle's official wording indicates Thailand is accepted as a seller country because it is not on the unsupported list, but no page says so by name, so get written confirmation before relying on it.

### Cited Findings
- Fee is 5% + 50¢ per checkout transaction; "Start selling globally with Paddle as your Merchant of Record"; includes tax compliance, fraud protection, chargebacks and buyer support — [Paddle pricing](https://www.paddle.com/pricing).
- "Paddle works with software businesses anywhere in the world with the exception of the unsupported countries listed below." Thailand is not on that list, and the list "is subject to change" — [Paddle help](https://www.paddle.com/help/start/account-verification/which-countries-are-supported-by-paddle).
- The developer country list is about where you can sell to, not where sellers are based — [Paddle supported countries](https://developer.paddle.com/concepts/sell/supported-countries-locales). Treat a claim that Thailand is "supported" from that page as a buyer-side fact only.
- Sole traders skip business verification but still pass domain review and identity verification; domain review expects a live site, pricing and accessible terms, refund and privacy policies — [Account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification); [Domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification) (via search summary).
- Payouts: wire or Payoneer. A SWIFT wire when currency and bank country differ "will incur a wire fee of $/€/£15", intermediary banks may charge more, and Paddle may add a conversion margin of up to 1.5% — [Paddle payout fees](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts). Page undated.
- Payouts are monthly with a default $100 threshold — [Paddle Get Paid](https://www.paddle.com/help/manage/get-paid) (via search summary, not opened).
- Alternatives in one line: [Lemon Squeezy](https://www.lemonsqueezy.com/pricing) is also merchant of record at 5% + 50¢; [Stripe Thailand](https://stripe.com/th/pricing) charges 4.75% + ฿10 on international cards plus 2% if conversion is needed, and is not described there as merchant of record, so sales tax would stay with Komoray.

### Inferences
**Fee arithmetic [C]**

| Plan | Fee | % | Net per charge | Net per year |
|---|---|---|---|---|
| $19 monthly | $0.95 + $0.50 = $1.45 | 7.63% | $17.55 | $210.60 (fee $17.40) |
| $190 annual | $9.50 + $0.50 = $10.00 | 5.26% | $180.00 | $180.00 |

- Annual saves $7.40/year in Paddle fees, but nets $30.60 less than a full year of monthly payments, in exchange for cash up front and no monthly churn risk.
- A Thai bank receiving USD would most likely be a SWIFT case, so $15 per monthly payout plus possible bank fees. At low volume, that is a real fixed cost. Compare with Payoneer before choosing.
- Because Paddle is merchant of record, it handles sales tax and chargebacks, so these are not added to the model.

### Gaps
- No official page names Thailand as an accepted seller country; the conclusion comes from it being absent from the exclusion list. Ask Paddle in writing, including payout route to a Thai bank. PROGRESS.md line 265 already has this as a task.
- Not checked: whether the 5% is applied before or after tax, Thai tax treatment of Paddle payouts, and whether Komoray's generative features trigger enhanced review ("some generative content" is listed as a restricted category in Paddle's policy, per a [search summary](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)).
