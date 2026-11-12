# Komoray: บันทึกความคืบหน้า

อัปเดตล่าสุด: **12 พ.ย. 2026 (ปิดงาน)** · ขึ้นเว็บจริงแล้ว: Layers + Move here, Import แบบ List, Make video ที่มี Cutout เร็วขึ้น ~2 เท่า, เสียงคลิปที่แทรก (Mute + แถบเสียง), Darken/Blur background, **Frame Me** · ไม่มี branch ค้าง
แผน 67 วัน: [Google Sheet](https://docs.google.com/spreadsheets/d/177tM1wyvNRYY82ykldY7aoKK9YSHDi8JJ1SKtCfR5v4/edit) (1 แถว = 1 วันในปฏิทิน, คอลัมน์ K = สถานะ)

---

## ภาพรวม

| | |
|---|---|
| ผลิตภัณฑ์ | Komoray: AI studio สำหรับครีเอเตอร์คลิปพูดหน้ากล้อง (talking head) |
| กลุ่มเป้าหมาย | ครีเอเตอร์**มืออาชีพ**ที่มีรายได้แล้ว (หลัก ๆ อเมริกา) อยากได้เครื่องมือที่ประหยัดเวลา ไม่ใช่มือใหม่ |
| Positioning | เรียกว่า "AI studio" **ห้ามเรียกว่า editor/เครื่องมือตัดต่อ** (คนจะเทียบกับ CapCut) |
| สโลแกน | **You shoot. Komoray makes you shine.** |
| เว็บ | https://komoray.com (และ www, komoray.kamkamsongto.workers.dev) |
| โค้ด | https://github.com/kamkamsongto-afk/komoray (private, branch `main`) |
| X | https://x.com/KomorayStudio (Professional → Software Company → Business) |
| Soft launch | **ศ. 30 ต.ค.** (เลื่อนจาก 28 ต.ค.) · Public launch **15 ธ.ค.** |

---

## ระบบที่ใช้ (tech stack)

- **Next.js 16.4 + Tailwind 4 + TypeScript** · โปรเจกต์อยู่ที่ `D:\Platform Project\komoray`
- **Cloudflare Workers ผ่าน OpenNext** (`@opennextjs/cloudflare`) เลือกแทน vinext เพราะ vinext ยังเป็น beta · **แพ็กเกจ Workers Paid** ตั้งแต่ 3 พ.ย. (~$5/เดือน, บิลรอบ 26–25, Budget alert $10)
- **Workers Builds**: push ขึ้น `main` แล้ว Cloudflare build + deploy เองอัตโนมัติ
  - Build: `npx opennextjs-cloudflare build` · Deploy: `npx opennextjs-cloudflare deploy` · Preview: `npx opennextjs-cloudflare upload`
- **Cloudflare R2**: ตู้ `komoray-uploads` (CORS อนุญาต localhost:3000, komoray.com, www, workers.dev · headers แค่ `Content-Type` **ไม่มี Range** → ตัวเล่นใหม่อ่านไฟล์ผ่าน `/api/media` บนเว็บเราแทน)
- **Deepgram** (model `nova-3`) ถอดเสียงพร้อมเวลารายคำ · เปิดให้เลือก 16 ภาษา (`src/lib/languages.ts`) · **ถอดเสียงอย่างเดียว ไม่แปล** (แปลซับคือวันที่ 28 ต้องใช้ Claude API)
- **Modal** ตัดคลิปด้วย FFmpeg (แอป `komoray-render`) · วัดความกว้างตัวอักษรด้วย `uharfbuzz` เพื่อวาดกล่องโค้งมน
- **Claude API** (`src/lib/translate.ts`, โมเดล `claude-sonnet-5-5`) แปลซับ · เปลี่ยนโมเดลแก้บรรทัดเดียว · ตั้ง fallback อัตโนมัติถ้าโมเดลปฏิเสธ · Worker secret `ANTHROPIC_API_KEY` ตั้งแล้ว
- **Supabase** (โปรเจกต์ `komoray`, Free, ฐานข้อมูลอยู่ us-west-2) สำหรับ login · Google provider เปิดแล้ว · URL `https://icjjeinussbapihdjiym.supabase.co`
  - ตาราง `projects` (1 แถว = 1 คลิป, `id` = โฟลเดอร์ใน R2) + Row Level Security: เห็น/เพิ่ม/ลบได้เฉพาะของตัวเอง · SQL อยู่ที่ `supabase/migrations/`
  - ตาราง `word_fixes` (คัมภีร์คำส่วนตัว, 31 ต.ค., `002_word_fixes.sql`): `heard` (คำที่สคริปต์เขียน แบบตัวเล็ก ไม่มีวรรคตอนท้าย) → `fixed`, `uses` · RLS เฉพาะเจ้าของ (ทดสอบแล้ว ผู้ใช้อื่นมองไม่เห็น/ลบไม่ได้) · ลบบัญชีแล้วคำหายด้วย (cascade)
  - รันคำสั่ง SQL จากเครื่อง: ต่อผ่าน `aws-1-us-west-2.pooler.supabase.com:5432` user `postgres.icjjeinussbapihdjiym` + `SUPABASE_DB_PASSWORD`
  - URL Configuration: Site URL `https://komoray.com` · Redirect URLs komoray.com/**, www.komoray.com/**, localhost:3000/**
- **Google Cloud** โปรเจกต์ `komoray` → Google Auth Platform: แอป Komoray (External, **Published** 30 ต.ค., ไม่มีโลโก้), OAuth client `Komoray web` (redirect ไป Supabase callback)
- **DNS** อยู่ที่ Cloudflare (โดเมนซื้อที่ Namecheap)
- **อีเมล** `hello@komoray.com` → Cloudflare Email Routing ส่งต่อเข้า kamkamsongto@gmail.com (30 ต.ค.) · ส่งออกผ่าน Gmail "Send mail as" (App password `Komoray mail`) · DNS: SPF `include:_spf.mx.cloudflare.net include:_spf.google.com`, DMARC `_dmarc` p=none · Gmail filter "Never send to Spam" สำหรับ komoray.com · **ส่งออกผ่าน Brevo** (Gmail "Send mail as" → `smtp-relay.brevo.com:587`) ยืนยันโดเมนแล้ว 3 พ.ย. (Brevo code, DKIM `brevo1/2._domainkey`, ลิงก์ `email.komoray.com` + `r.email` + `img.email`, เมฆเทาทั้งหมด) · ทดสอบแล้ว DKIM + SPF ผ่าน เมลเข้ากล่องปกติ · รับเข้ายังผ่าน Cloudflare Email Routing

### กุญแจและความลับ
- ในเครื่อง: ไฟล์ `.dev.vars` (อยู่ใน `.gitignore` ไม่ขึ้น GitHub)
- ใน `.dev.vars` มี: R2, Deepgram, `RENDER_TOKEN`, `SUPABASE_DB_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- บนเว็บจริง: Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DEEPGRAM_API_KEY`, `RENDER_TOKEN`, `ANTHROPIC_API_KEY` (ตั้งด้วย `npx wrangler secret`, wrangler login แล้ว)
- กุญแจ R2 ปัจจุบัน = token `komoray-upload-v2` (เปลี่ยน 29 ต.ค., ลบดอกเก่าแล้ว)
- ค่าที่ไม่ลับ (`R2_ACCOUNT_ID`, `R2_BUCKET`, `RENDER_URL`) อยู่ใน `wrangler.jsonc` → `vars` · Supabase URL + publishable key (สาธารณะ) อยู่ในโค้ด `src/lib/supabase/config.ts` เพื่อไม่ต้องตั้งค่าตอน build

### แผนที่ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `src/app/page.tsx` + `src/components/WaitlistForm.tsx` + `src/app/api/waitlist/route.ts` | หน้าแรกจริง: สโลแกน ขั้นตอน ฟีเจอร์ + ช่อง `Get early access` เก็บที่ R2 `waitlist/<hash>.json` · ไม่มีปุ่ม Sign in (ส่งลิงก์ให้ beta เอง) |
| `src/app/feedback/page.tsx` + `src/components/FeedbackForm.tsx` + `src/app/api/feedback/route.ts` | ความเห็น beta 3 คำถาม + ข้อความ เก็บที่ R2 `feedback/` ดูใน /admin |
| `src/components/VideoReady.tsx` | หน้าเสร็จงานหลัง Make video: ดู ดาวน์โหลด คลิปใหม่ และถามความเห็นครั้งแรก |
| `src/components/ThemeToggle.tsx` + `.surface-inverse` ใน `globals.css` | สวิตช์ Theme มุมขวาบนทุกหน้า (`layout.tsx`) · แผงตั้งค่าใช้สีตรงข้าม Theme |
| `src/lib/translate.ts` + `src/app/api/translate/route.ts` | แปลซับ 33 ภาษาเป็น .srt ทีละ 40 บรรทัด จำคำแปลใน `translation-<ภาษา>.json` |
| `src/lib/upload-limit.ts` | เพดาน 20 อัปโหลด/24 ชม./บัญชี ยกเว้น admin กันค่าใช้จ่ายจนกว่าจะมีโควตาจริง |
| `src/lib/player/stretch.ts` | เร่งเสียง preview 1.25–2x โดยเสียงไม่แหลม |
| `src/app/upload/page.tsx` | ต้องล็อกอินก่อน · อัปโหลด (หรือ 📱 Upload from your phone) → เลือกภาษา (จำครั้งก่อน/ตามภาษาเบราว์เซอร์) → Find silences → เสร็จแล้วพาไป `/edit` เอง · จำงานไว้ใน URL `?key=` |
| `src/app/phone/page.tsx` + `src/app/api/phone/route.ts` + `src/components/PhoneUpload.tsx` | อัปโหลดจากมือถือด้วย QR: คอมออกลิงก์ลายเซ็น 15 นาที → มือถืออัปไฟล์เดียวเข้าโฟลเดอร์ที่เตรียมไว้ (ไม่ต้องล็อกอิน) → คอม claim เป็นโปรเจกต์ตัวเอง · สถานะใน `uploads/<id>/phone.json` |
| `src/app/brand/page.tsx` + `src/app/api/brand/route.ts` | **Brand Kit**: ตั้งสไตล์ซับ/ฟอนต์/สี/ชื่อช่อง/Auto zoom ครั้งเดียว · เก็บที่ R2 `brand/<user id>.json` · คลิปที่ยังไม่มี style ใช้ค่านี้ตอนเปิดครั้งแรก |
| `src/app/api/font/route.ts` + `src/lib/font-info.ts` | ฟอนต์ของผู้ใช้ 1 ตัว/บัญชี (.ttf/.otf ≤ 5 MB) ที่ R2 `fonts/<user id>/` · อ่านชื่อ family + ความสูงฟอนต์จากไฟล์ · Modal โหลดผ่านลิงก์ชั่วคราว (fontsdir) |
| `src/app/edit/page.tsx` | **หน้าตัดต่อเต็มจอ** `/edit?key=…`: แถบบน (ความยาวเดิม→หลังตัด, Make video, ดาวน์โหลด, แจ้งเตือน) + ScriptView · บันทึกการแก้ลง edit.json ทันที (ซับรอ 0.6 วิหลังเลื่อนเสร็จ) · ยังไม่มีสคริปต์ → ส่งกลับ /upload |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | นโยบายความเป็นส่วนตัว / ข้อตกลง (ติดต่อ hello@komoray.com) · ใช้ `src/components/LegalPage.tsx` |
| `src/app/admin/page.tsx` + `src/app/api/admin/jobs/route.ts` | หน้า admin: ทุกคลิป + สถานะ (done/working/failed/stuck) + error · เข้าได้เฉพาะล็อกอินด้วย `ADMIN_EMAIL` (kamkamsongto@gmail.com) |
| `src/app/projects/page.tsx` + `src/app/api/projects/route.ts` | My projects: สลับรายชื่อ/Thumbnail + ถังขยะ (ถามยืนยัน แล้วลบไฟล์ทั้งโฟลเดอร์และแถวในตาราง) · กดแล้วไป `/edit?key=…` |
| `src/app/auth/callback/route.ts` | Google ส่งกลับมาที่นี่หลังล็อกอิน → แลกเป็น session cookie |
| `src/components/Account.tsx` | `useUser`, ปุ่ม Sign in with Google, แถบบน (New video · My projects · My words · Sign out) |
| `src/components/ScriptView.tsx` | ตัวตัดต่อ: ซ้าย = ข้อความ (ต่อชิ้นคำไทยด้วย `Intl.Segmenter`, ✂️ ช่วงเงียบ, ลากคลุมคำ → Delete/Restore/✏️ Fix text, **ดับเบิลคลิกคำ → แก้คำ** + Fix all, 🔍 Find & replace, คลิกคำ → กระโดด, ไฮไลต์คำที่พูด, คำเป็น `WordSpan` memo กันสคริปต์ยาวค้าง) · ใช้คัมภีร์คำครั้งแรกที่เปิดคลิป · ขวา = เลือกตัวเล่น (StudioPlayer ถ้ามี proxy + เบราว์เซอร์รองรับ, ไม่งั้น PreviewPlayer) / Original + แถบปรับซับ |
| `src/components/PlayerFrame.tsx` | กรอบที่ตัวเล่นทั้งสองใช้ร่วมกัน: 9:16, ซับ Kanit (ลากขึ้นลง), ลายน้ำ, ปุ่ม Play, แถบเวลา, ความเร็ว 1–2x (เฉพาะ StudioPlayer), ป้าย Recording, วงกลมหมุนตอนโหลด |
| `src/components/StudioPlayer.tsx` + `src/lib/player/` | **ตัวเล่นของเราเอง (ตัวหลัก, 31 ต.ค.)**: `mp4.ts` อ่านตารางเฟรมของ proxy.mp4 เอง · `bytes.ts` โหลดทีละ 1 MB (Range, จำ ~48 MB) · `engine.ts` WebCodecs แกะภาพวาดลง canvas + Web Audio เล่น `proxy-audio.pcm` เป็นนาฬิกา (ตัดตรง sample, เฟด 3 ms) · error/ไม่รองรับ → กลับไปใช้ PreviewPlayer เอง · `?engine=old` บังคับใช้ตัวเก่า |
| `src/components/PreviewPlayer.tsx` | ตัวเล่นสำรอง: `<video>` 2 ตัวสลับกันที่จุดตัด · Safari เล่นล่วงหน้า 0.5 วิ (ยังสะดุดบน iPad/Mac เพราะ Safari สั่ง play/seek ช้า) |
| `src/lib/zoom.ts` | **Auto zoom ทีละเฟรม**: `zoomTrack` ใช้ทั้ง preview และแถบบน Timeline · `in`/`out` ค่อย ๆ ซูมตาม `zoomPeriod` ค้างไว้ แล้วเริ่มใหม่ที่จุดตัดถัดไป (`zoomRamps`) · `noZoom` = ช่วงที่ปิด zoom (วินาทีของคลิปต้นฉบับ อยู่รอดแม้ตัดใหม่) · ลอกกับ `no_zoom_frames`, `zoom_shots`, `zoom_ramps`, `smooth_zoom_expr` ใน `render.py` |
| `src/lib/languages.ts` | ภาษาที่เลือกได้ + เกณฑ์ที่ใช้คัด (อ่านก่อนเพิ่มภาษา) |
| `src/app/api/banner-templates/route.ts` | My banners: ป้ายที่บันทึกไว้ใช้ซ้ำทุกคลิป เก็บที่ R2 `brand/<user id>-banners.json` |
| `src/lib/timeline.ts` | คิดไทม์ไลน์คลิปจริง + แบ่งบรรทัดซับ **ลอกกติกาจาก `render.py`** (แก้ที่หนึ่งต้องแก้อีกที่ ไม่งั้นตัวอย่างไม่ตรงคลิปจริง) · `joinThai` = `join_thai` เว้นวรรคตรงรอยไทย/ตัวเลข/อังกฤษ, หลังคำลงท้าย, ตรงที่หยุดพูด |
| `src/lib/thai-words.ts` | ประกอบชิ้นคำไทยของ Deepgram เป็นคำจริง (`Intl.Segmenter`) · ใช้ตอน callback ถอดเสียง + แปลงคลิปเก่าใน GET `/api/analyze` (ธง `wordsJoined` ใน edit.json) |
| `src/lib/edit.ts` | คำที่ลบ → ช่วงตัด (`wordCuts`, `allCuts`) · คำที่แก้ (`Fix`, `fixedWords`, `setFix`, `readFixes`) · `normText` (กติกาเทียบคำ) · `WordFix` |
| `src/lib/subtitle-style.ts` | ค่าซับ: size/outline/position + **look** (clean/box/highlight/big/two) + **font** (8 ตัว หรือ own) + color + logo/logoAt + **zoom** (off/cuts) · `FONTS[].height` = ความสูงฟอนต์ (libass คิดขนาดจากค่านี้ ตัวอย่างต้องหารด้วยค่านี้ ไม่งั้นตัวใหญ่กว่าคลิปจริง ~1.5 เท่า) · `readStyle` ตรวจทุกช่อง |
| `src/components/SubtitleControls.tsx` + `BannerControls.tsx` | แผงตั้งค่าซับ (ใช้ทั้งหน้าตัดต่อและ Brand Kit, อัปโหลดฟอนต์ได้) · แผงป้าย Price / Call to action / Follow |
| `src/lib/banners.ts` | ป้าย: ชนิด ข้อความ เวลา (วินาทีของคลิปจริง) ตำแหน่ง สีพื้น สีตัวอักษร ความมน ความทึบ animation 6 แบบ (`bannerMotion`, ลอกกับ `BANNER_ANIMS` ใน `render.py`) · ตัดอีโมจิ · `readBanners` · ไม่มี `+ Follow` แล้ว คลิปเก่ายังแสดง · ลากเวลาบนแถบรวมใน Timeline |
| `src/lib/takes.ts` | **ตรวจเทคซ้ำ** (ไม่ใช้ AI): ประโยคที่เริ่มด้วยคำเดิม ≥ 3 คำภายใน 25 วิ = เทคแรกเสีย · ข้ามคำเติม (um, เอ่อ) · ไม่ตัดเข้าต้นเทคที่เก็บ |
| `src/app/api/edit/route.ts` | PUT: บันทึก `deleted`, `fixes`, `dictionaryApplied`, `style`, `banners` ลง edit.json (ส่งอย่างไหนก็ได้) |
| `src/app/api/dictionary/route.ts` + `src/app/words/page.tsx` | คัมภีร์คำ: GET/POST (นับ uses)/DELETE · หน้า **My words** ค้นหา ลบ ดาวน์โหลด CSV |
| `src/lib/proxy.ts` + `src/app/api/media/route.ts` | ไฟล์ตัวอย่าง: `proxyStatus`/`startProxy` (Modal) · `mediaUrl` ลิงก์มีลายเซ็น HMAC + หมดอายุ 3 ชม. → `/api/media` ดึงจาก R2 แบบ Range ให้ (ไม่ต้องเช็ก login ทุกก้อน) |
| `src/lib/debug-log.ts` + `src/app/api/debug-log/route.ts` | โหมดบันทึก `&debug=1`: ป้ายแดง Recording · ส่งทุก 10 วิไป `logs/debug/` ใน R2 (ลบเองหลัง 90 วัน, หน้า admin ข้าม) |
| `src/lib/report.ts` | ส่ง error ฝั่งเบราว์เซอร์ไปหน้า admin |
| `src/lib/supabase/` | `config.ts` (URL, key, ADMIN_EMAIL) · `browser.ts` · `server.ts` (`currentUser`, `ownsVideo`, `isAdmin`) |
| `src/app/api/report/route.ts` | หน้าเว็บส่ง error ฝั่งเบราว์เซอร์มาเก็บที่ `logs/` ใน R2 (ลบเองหลัง 90 วัน) |
| `src/app/api/upload-url/route.ts` | ออกลิงก์อัปโหลดชั่วคราว 10 นาที (mp4/mov ≤ 500 MB) |
| `src/app/api/analyze/route.ts` | POST: ส่งงานให้ Deepgram แบบ callback (ไม่รอ) · GET: ถามสถานะ (`analyze.json` → `edit.json` / `analyze-error.json`) |
| `src/app/api/analyze/callback/route.ts` | Deepgram ส่งผลมาที่นี่ (ตรวจลายเซ็น HMAC ด้วย `RENDER_TOKEN`) → หาช่วงเงียบ → บันทึก `edit.json` |
| `src/app/api/render/route.ts` | POST: สั่ง Modal ตัดคลิป (ช่วงเงียบ + คำที่ลบ + ค่าซับ) · GET: ถามสถานะ (`render.json` → `final.mp4` / `render-error.json`) + ลิงก์ดู/ดาวน์โหลด 1 ชม. |
| `src/lib/r2.ts` | ทำลิงก์ชั่วคราว + อ่าน/เขียน/ลบไฟล์ใน R2 + `VIDEO_KEY`, `siblingKey` |
| `src/lib/callback.ts` | ลายเซ็นลับของลิงก์ callback |
| `src/lib/transcribe.ts` | **ไฟล์เดียวที่รู้จัก Deepgram** (เปลี่ยนเจ้าแก้ไฟล์นี้ไฟล์เดียว) |
| `src/lib/silences.ts` | กติกาช่วงเงียบ: ช่องว่าง > 0.4 วิ, เว้นระยะรอบคำ 0.1 วิ · `trimStretchedWords`: คำยาวได้ไม่เกิน 0.2 + 0.05×ตัวอักษร วิ (Deepgram ชอบลากหางคำท้ายประโยค) |
| `modal_app/render.py` | งานบน Modal (FFmpeg): `render` ตัดคลิปจริง · `proxy` ทำไฟล์ตัวอย่าง (540p, ภาพเต็มทุก 0.5 วิ, ไม่มี B-frame) + `proxy-audio.pcm` (mono 16-bit 24 kHz) · deploy: `python -m modal deploy modal_app/render.py` · ทดสอบ: `python -m modal run modal_app/render.py --job job.json` (ไม่มี `edit` = proxy) · endpoint: `https://kamkamsongto--komoray-render-start.us-east.modal.run` (`kind: "proxy"`) |

`edit.json` = `{ source, duration, rules, cuts: [{start, end, reason}], words: [{text, start, end}], deleted?: [ลำดับคำที่ลบ], fixes?: [{from, to, text}], dictionaryApplied?: true, style?: {size, outline, position, look, font, ownFont?, color, textColor, outlineColor, boxColor, boxRadius, boxOpacity, letterSpacing, lineSpacing, motion, logo, logoAt, zoom, zoomAmount, zoomPeriod}, noZoom?: [{start, end}], banners?: [{id, kind, text, sub, start, end, place, x?, y?, scale?, color?, ink?, radius?, opacity?, anim?}], wordsJoined?: true }`

ไฟล์ในโฟลเดอร์คลิป (R2 `uploads/<id>/`): ต้นฉบับ · `analyze.json` · `edit.json` · `translation-<ภาษา>.json` · `proxy.json` · `proxy-audio.pcm` · `proxy.mp4` (มีทั้งสองไฟล์ = proxy เสร็จ; proxy.mp4 ที่ไม่มี pcm = รุ่นเก่า สร้างใหม่เองตอนเปิด /edit) · `render.json` · `final.mp4` · `*-error.json`

---

## ✅ เสร็จแล้ว

**26 ต.ค. (ทำงานของวันที่ 1, 2, 3 ในแผน)**
- ติดตั้ง Node.js, Git · สร้างโปรเจกต์ · หน้าแรก "Komoray — AI Studio for Talking Heads / Coming soon"
- push ขึ้น GitHub · deploy บน Cloudflare · ผูก komoray.com และ www.komoray.com
- หน้าอัปโหลดคลิปตรงเข้า R2 พร้อมแถบความคืบหน้า (ทดสอบบนเว็บจริงผ่าน)
- หาช่วงเงียบด้วย Deepgram + บันทึก `edit.json` (ทดสอบกับคลิปไทยของโค้ช 2:07 นาที เจอ 5 จุด รวม 16.19 วิ)
- อัปเดต Google Sheet: วันที่ 1–3 เสร็จ, เลื่อน MVP 2 วัน, soft launch เป็น 30 ต.ค.
- เปิดบัญชี X @KomorayStudio: โลโก้, banner, bio, หมวด Software Company
- สร้าง `PROGRESS.md` (ไฟล์นี้) และ `CLAUDE.md` (กฎประจำโปรเจกต์ + กิจวัตรปิดงาน)

**27 ต.ค. (วันที่ 7 ในชีต: งานตัดคลิป)**
- สมัคร Modal (Starter, เครดิตฟรี $1/เดือนเพราะยังไม่ผูกบัตร · ผูกบัตรแล้วได้ $30) · ติดตั้ง Python 3.12 + modal 1.6
- `modal_app/render.py` deploy แล้วเป็นแอป `komoray-render`: ตัดตาม edit.json → 1080×1920 → ซับ Kanit Medium (ขนาด 100, ขอบดำ 10, สูง 31% จากล่าง) → ลายน้ำ komoray.com → ส่ง `final.mp4` กลับ R2
- Modal ไม่ถือกุญแจ R2: รับแค่ลิงก์ชั่วคราว · endpoint `start` ต้องมี `RENDER_TOKEN` (เก็บใน Modal secret `komoray-render`, Worker secret, `.dev.vars`)
- ทดสอบกับคลิปไทยของโค้ช: 2:07 → 1:50 นาที ผ่าน · ซับไทยรวมได้ 7 พยางค์ต่อบรรทัด · แก้ `ํา` → `ำ` ในซับแล้ว

**28 ต.ค. (วันที่ 8 ในชีต: หน้าสถานะ + ดาวน์โหลด)**
- ปุ่ม **Make video** → หน้าสถานะถามทุก 5 วิ → ดูคลิปในหน้าเว็บ + ปุ่ม **Download video** (ไฟล์ `komoray-video.mp4`)
- **แจ้งเตือนบนจอ** (Notification ของเบราว์เซอร์) + ชื่อแท็บเปลี่ยนเป็น "✅ Ready" · **ตัดสินใจไม่ส่งอีเมลแจ้งคลิปเสร็จ**
- พื้นที่**ลากวางไฟล์**
- แก้ **error 524** (Deepgram ทำงานเกิน 100 วิกับคลิปยาว): เปลี่ยนเป็นแบบ callback + หน้าเว็บถามสถานะทุก 3 วิ
- ทดสอบบนเว็บจริงกับคลิปไทย 7 นาที (482 MB): Find silences 137 วิ (35 จุด รวม 84 วิ) → Make video 95 วิ → ไฟล์ 112 MB ดาวน์โหลดได้ ✅

**29 ต.ค. (วันที่ 9 ในชีต: ทดสอบ 10 คลิป) + ล่วงหน้างานวันที่ 10–11**
- R2 ลบไฟล์ `uploads/` อัตโนมัติหลัง 14 วัน (`beta-expire-14d`) และ `logs/` หลัง 90 วัน (`logs-expire-90d`)
- โค้ชอัดคลิปทดสอบ 9 คลิป ทดสอบไปแล้ว Eng01, Eng02, Long01 (5 นาที) ผ่าน · ยังไม่มีคลิปแนวนอน / .mov จาก iPhone
- สูตรตัดใหม่ตัดหางเสียงที่ Deepgram ลากยาว (Eng01: 36.0 → 31.2 วิ) · รอโค้ชฟังว่ามีคำไหนโดนตัดหางไหม
- แจ้งเตือน: เสียง ding ทุกครั้ง + ป๊อปอัปบนเดสก์ท็อปเฉพาะคนติ๊ก "Also notify me on my desktop" (จำไว้ในเบราว์เซอร์)
- **เปลี่ยนกุญแจ R2** เป็น `komoray-upload-v2` และลบดอกเก่าแล้ว (ลิงก์ที่เซ็นด้วยดอกเก่าใช้ไม่ได้แล้ว)
- **หน้า admin** komoray.com/admin + บันทึก error ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ (งาน soft launch ข้อ 3–4 ของวันที่ 10)
- **หน้า Privacy / Terms** + ขอ Deepgram ไม่ให้เอาเสียงไปเทรน (`mip_opt_out=true`)
- **เตรียม Login (วันที่ 11):** สมัคร Supabase, สร้าง Google OAuth client, เปิด Google provider ใน Supabase (ทดสอบแล้ว Supabase ส่งต่อไป Google ถูกต้อง)
- **อีเมลทางการ** hello@komoray.com รับเมลได้แล้ว

**30 ต.ค. (วันที่ 10–12 ในชีต)**
- Google **Publish app** แล้ว (กรอก Branding: home/privacy/terms, authorized domains)
- **ส่งเมลในชื่อ hello@komoray.com** จาก Gmail ได้ + SPF เพิ่ม Google + DMARC · แต่เมลยังตกกล่องขยะ (ไม่มี DKIM ของโดเมนเรา)
- **Login ด้วย Google ขึ้นเว็บจริงแล้ว** (วันที่ 11): `/upload` ต้องล็อกอิน · ทุกคลิปผูกกับเจ้าของ · คนอื่นเปิด/สั่งงานคลิปของเราไม่ได้ (ทดสอบด้วยบัญชีทดสอบ 2 บัญชี + โค้ชทดสอบบนเว็บจริงผ่านครบ)
- หน้า **My projects** · หน้า admin เปลี่ยนจากรหัสผ่านเป็นเช็กอีเมล (ลบ `ADMIN_PASSWORD` แล้ว) · error report บอกอีเมลคนที่เจอ
- **Script view** ขึ้นเว็บจริง (วันที่ 12, `5719c5e`) + แก้ภาษาไทยตัวห่าง: ต่อชิ้นคำของ Deepgram เป็นคำจริงด้วยตัวตัดคำไทยของเบราว์เซอร์ (`4380650`)
- **ลบคำในสคริปต์** (วันที่ 14, `0da02f0`): ลากคลุม → Delete (ขีดฆ่า) / Restore / Restore all · Make video ตัดคำที่ลบทั้งภาพ เสียง ซับ
- **ตัวอย่างคลิปจริงก่อน render** (วันที่ 16, `f7345df`): 9:16 + ซับ + ลายน้ำ + ข้ามจุดตัดลื่น · **ลอง Remotion แล้วไม่ใช้** (ค้าง > 6 วิที่จุดตัด เพราะสร้าง video ใหม่ทุกชิ้น) → ทำ player เองด้วย video 2 ตัวสลับกัน และถอด Remotion ออกแล้ว
- **หน้าตัดต่อเต็มจอ `/edit`** (`0f2dde6`, ตามไอเดียโค้ช): ซ้ายข้อความ ขวาคลิป · หาช่วงเงียบเสร็จพาไปเอง · **ปรับซับ**: ลากขึ้นลงบนคลิป + แถบ Text size / Black outline · Make video ใช้ค่าเดียวกัน (ส่วนหนึ่งของวันที่ 17–18)
- ✅ โค้ชทดสอบบนเว็บจริง (31 ต.ค.): My projects → /edit ผ่าน · ซับคลิปจริงตรงกับตัวอย่าง ผ่าน · F5 ค่าซับยังอยู่ ผ่าน · ⏳ iPhone ยังไม่ได้ทดสอบ (ไม่มีเครื่อง)

**31 ต.ค. (ตัวอย่างลื่นทุกเครื่อง + แก้คำ + คัมภีร์คำ: ทำครบแผนคู่ขนาน A1–A7, B1–B4)**
- เส้นทางตัวอย่างบน iPad (เรียนรู้ระหว่างทาง): เล่นล่วงหน้าแบบปิดเสียง → iPad ลื่นแต่เสียงหาย · Web Audio ผูกกับ `<video>` → iPad พัง (ย้อนแล้ว) · **ไฟล์ตัวอย่าง proxy** (`bb223d9`) Chrome ลื่น · **โหมดบันทึก `&debug=1`** (`97825ed`) พบว่า Safari สั่ง play ช้า 0.5–0.65 วิ, seek 1–1.6 วิ → ตัดสินใจทำตัวเล่นเอง
- **A1** แก้จุดตัดแรกค้าง 2.7 วิในตัวเล่นเดิม (`a138cca`)
- **A2** Modal ทำ `proxy-audio.pcm` + proxy ไม่มี B-frame (deploy แล้ว, ทำใหม่ให้คลิปทดสอบ 3 คลิป: Eng01, 18 วิ .MOV, 7 นาที)
- **A3–A7 ตัวเล่นของเราเอง เป็นตัวหลักแล้ว** (`33f05df`): WebCodecs + canvas + Web Audio · วัดบน build แบบเว็บจริงในเครื่อง: คลิป 7 นาที **30 ภาพ/วิ ไม่ทิ้งภาพ ไม่ต้องรอโหลด** · ทดสอบคลิกคำกระโดด / ลบคำระหว่างเล่น / Pause / Play ผ่าน · อ่านไฟล์ผ่าน `/api/media` (เว็บจริงตอบ 206, ลายเซ็นผิด 404) · ⏳ **ยังไม่ได้ทดสอบบน iPad จริง**
- **B1** ดับเบิลคลิกคำ → แก้คำ (`a138cca`) · **B2** Fix all + Find & replace (`ed39009`) · **B3** คัมภีร์คำ + หน้า My words (`c675c12`) · **B4** เว้นวรรคไทย/ตัวเลข/อังกฤษในซับ ตัวอย่างกับคลิปจริงตรงกัน 5/5 กรณี (`7910cb9`, deploy Modal แล้ว)
- หน้า Privacy เพิ่ม My words / ไฟล์ตัวอย่าง / บันทึก debug · บันทึก debug ย้ายไป `logs/debug/` (ลบเองหลัง 90 วัน) (`cc1590b`)
- ✅ โค้ชทดสอบ (31 ต.ค. เย็น): ตัวเล่นใหม่ **ลื่นทั้ง Chrome และ iPad** · แก้คำ / Fix all / Find & replace ใช้ได้ · เจอ 3 เรื่อง แก้แล้ว (รอบเย็น):
  - **ภาพบน iPad ถูกบีบแคบ**: Safari ไม่ crop ตามที่สั่งใน `drawImage` → เปลี่ยนเป็นวาดทั้งภาพขยายให้เต็มกรอบ ให้ขอบ canvas ตัดเอง + บันทึกขนาดภาพใน `&debug=1`
  - **คำไทยเป็นชิ้น ๆ / ซับติดเป็นพรืด**: ต้นเหตุคือ Deepgram แบ่งไทยเป็นพยางค์/ตัวอักษร (`ผู|้|หญิง`) ช่วงห่างแทบทั้งหมด 0 วิ → **`thai-words.ts` ประกอบเป็นคำจริงด้วย `Intl.Segmenter`** ตั้งแต่ตอนถอดเสียง (คลิปเก่าแปลงตอนเปิดครั้งแรก ย้ายคำที่ลบ/แก้ไว้ตามได้ครบ ทดสอบกับ 9 คลิปไทยจริง) · ซับไทย**เว้นวรรคหลังคำลงท้าย (ครับ ค่ะ นะ…) หลัง ๆ และตรงที่หยุดพูด ≥ 0.15 วิ** · บรรทัดละไม่เกิน 16 ตัวอักษร (ไม่นับสระบนล่าง) · ตัวอย่างกับคลิปจริงตรงกัน (ต่างแค่จุดตัดบรรทัดเพราะปัดเฟรม ซึ่งเป็นมาแต่เดิม) · deploy Modal แล้ว
  - **My words แก้คำได้**: ปุ่ม Edit (PATCH `/api/dictionary`)
- ⚠️ ระบบ Claude Code **ไม่อนุญาตให้แก้ CORS ของ R2** (เปลี่ยนการตั้งค่าที่ใช้ร่วม) จึงใช้ `/api/media` แทน · ถ้าวันหนึ่งอยากให้เบราว์เซอร์อ่าน R2 ตรง ต้องเพิ่ม `Range` ใน allowed headers เอง

**31 ต.ค. คืน → 1 พ.ย. (รอบทำงานยาวอัตโนมัติ, ดึงงานล่วงหน้าวันที่ 15, 17, 18, 19, 22, 24–25, 26)** — ทุกอย่าง deploy แล้ว ทั้งเว็บและ Modal
- **วันที่ 15 ตรวจเทคซ้ำ** (`ab50b15`, ไม่ใช้ AI): ปุ่ม 🔁 Repeated takes (N) → รายการ ▶ Listen / ✂️ Cut / ↩️ Keep / Cut all · คำในเทคซ้ำขีดเส้นใต้ส้ม · เจอเทคซ้ำจริง 2 ใน 12 คลิปของเรา (ไทย+อังกฤษ) ไม่เจอผิด (**ไม่จริงแล้ว**: 5 พ.ย. อ่านคลิปไทยใหม่ ตัดผิด 5 จาก 11 จุด ดูการตัดสินใจ 5 พ.ย.) · ยังไม่ได้ใช้ Claude (ไม่มีกุญแจ) ไว้ช่วยเคสยากทีหลัง
- **วันที่ 17 สไตล์ซับ 5 แบบ + 8 ฟอนต์** (`5161798`): Clean / Box / Highlight (คำที่พูดเปลี่ยนสี) / Big / Two lines · Kanit Prompt Mitr Sarabun Chakra Petch (+ Poppins Anton Bebas Neue เฉพาะอังกฤษ) · render.py คิดเวลาซับเป็นเฟรมแบบเดียวกับตัวอย่าง → **ตัวอย่างกับคลิปจริงตัดบรรทัดตรงกัน 100%** (9 คลิป × 3 แบบ)
- **อัปโหลดฟอนต์เอง** (`b7226ca`): .ttf/.otf 1 ตัวต่อบัญชี ทดสอบ render ด้วย Itim ผ่าน
- **วันที่ 18 Brand Kit** (`d066c76`): หน้า `/brand` + ปุ่ม ⭐ Save as my Brand Kit ในหน้าตัดต่อ · สีประจำช่อง (ใช้กับ Highlight + ป้าย) · ชื่อช่องมุมบนซ้าย/ขวา · คลิปใหม่ใช้อัตโนมัติ
- ⚠️ ตอนแรกจะเก็บ Brand Kit ในตาราง Supabase แต่ระบบความปลอดภัยไม่ให้ Claude สร้างตารางในฐานข้อมูลจริง → เก็บใน R2 แทน (ไม่ต้องรอโค้ช)
- **วันที่ 19 อัปโหลดจากมือถือด้วย QR** (`1302b09`): ไม่ต้องล็อกอินบนมือถือ · ทดสอบ: ลายเซ็นปลอม/หมดอายุ 403, ไม่ใช่วิดีโอ 400, ใช้ซ้ำ 409, รับคลิปโดยไม่ล็อกอิน 401
- **วันที่ 22 ส่วนแรก Auto zoom** (`babd179`): ซูม 112% สลับทุกจุดตัด (เหมือนมีกล้องตัวที่ 2) · ตัวอย่างวาดซูมทีละเฟรมตรงจุดตัดพอดี · คลิป 7 นาทีพร้อมซูม render ~100 วิ · ยังไม่มีหาตำแหน่งหน้า (MediaPipe) จุดซูมคือกลางจอค่อนบน
- **วันที่ 24–25 ป้าย** (`199316a`): Price (บรรทัดเล็กใต้ราคาได้) / Call to action / Follow · ตั้งเวลา (ปุ่ม Now) ตำแหน่ง บน/กลาง/ล่าง · สีประจำช่อง · เฟดเข้าออก
- **แก้บั๊กใหญ่ที่มีมาตั้งแต่ต้น**: ตัวอักษรในตัวอย่างใหญ่กว่าคลิปจริง ~1.5 เท่า (libass คิดขนาดจากความสูงเต็มของฟอนต์) → ตอนนี้วัดแล้วตรงกัน (37.5% vs 37.8% ของความกว้างจอ)
- **ดาวน์โหลดซับ .srt** + หน้าอัปโหลดจำภาษาที่พูด (`457533c`) · ⚠️ ลองให้ Deepgram เดาภาษาเองแล้ว **เดาไทยไม่ได้** (คลิปไทยออกมาเป็นอังกฤษ ไม่มีคำ) จึงยังให้เลือกเอง
- **Pace: Tight / Natural / Relaxed** (`16550a0`): หาช่วงเงียบใหม่จากคำที่มีอยู่ ไม่ต้องถอดเสียงใหม่ (คลิป 55.6 วิ → 29.2 / 31.2 / 33.6 วิ)
- **จัดกรอบตามหน้าคน** (`0beeef0`): Modal หาหน้าด้วย OpenCV วินาทีละ 2 ภาพ → `faces.json` · คลิปที่กว้างกว่ากรอบตัดรอบหน้า · Auto zoom ซูมเข้าหาหน้า · สูตร TS กับ Python ตรงกัน 0 px (2,000 กรณี)
- **Undo / Redo + Space เล่น/หยุด** (`bc19df7`) · **My projects มีรูปตัวอย่าง + 3 ขั้นสำหรับคนใหม่** (`88af328`)
- **สัดส่วนคลิป 9:16 / 1:1 / 16:9 (YouTube)**: ช่อง Video shape ในแผงซับ (และ Brand Kit) · เปลี่ยนสัดส่วนแล้วซับเลื่อนไปตำแหน่งที่เหมาะเอง · ป้าย Bottom ใต้ซับใน 9:16 / เหนือซับในแบบกว้าง · ลายน้ำห่างขอบล่างเป็นสัดส่วน · ทดสอบ render จริงทั้ง 3 แบบ (1920×1080, 1080×1080) ตรงกับตัวอย่าง · แก้ไปด้วย: ป้าย Bottom เคยทับซับใน 9:16
- **31 ต.ค. ค่ำ แก้ตามที่โค้ชลองเว็บจริง** (`6b913a1`): จับเทคซ้ำที่พูดต่อกันไม่เว้นจังหวะ + ขอบซับในตัวอย่างมนเหมือนคลิปจริง
- ⚠️ บทเรียน Modal: หลัง deploy ใหม่ งานแรก ๆ อาจยังวิ่งบนเครื่องเวอร์ชันเก่าที่เปิดค้าง (เจอจริงตอนทดสอบสัดส่วน) → ถ้าผลไม่ตรงโค้ด ให้สั่งใหม่อีกครั้งก่อนสงสัยโค้ด

**1 พ.ย. (รอบยาว, โค้ชยังไม่ได้ลองบนเว็บจริงส่วนใหญ่)**
- **Timeline ใต้หน้าตัดต่อ** + ตัดเทคซ้ำอัตโนมัติ เก็บเทคสุดท้าย (`2aabace`, เลิกตัดเองแล้ว 5 พ.ย.) · ลากตัด/เก็บช่วงไหนก็ได้ + ซับเด้ง Pop/Bounce (`bef8bc7`) · ลากขอบจุดตัดละเอียดกว่าระดับคำ + ปุ่ม Auto (`ffb85ea`) · ป้ายลากวาง/ขยายได้ + โลโก้รูปภาพ 4 มุม (`fd9037b`) · ไทยวรรณยุกต์ไม่ซ้อนสระในคลิปจริง + ตัดบรรทัดตามวลี (`05d902f`) · ตัดคลิปจริงลงเฟรมเต็มเหมือน preview + เฟดเสียงสั้น ๆ ที่จุดตัด (`af94bda`)
- ⚠️ 3 commit หลัง (`fd9037b`, `05d902f`, `af94bda`) ไม่เคยถูก push จึงเป็นเหตุที่โค้ชไม่เห็นปุ่มโลโก้บนเว็บจริง

**2 พ.ย. (รอบยาวอัตโนมัติ, ดึงงานวันที่ 23, 25, 26, 36)** — ขึ้นเว็บแล้ว โค้ชเห็น Smooth zoom แล้ว
- **Zoom 3 แบบ** (`d16bfd0`, `67f143c`): Off / Smooth (ค่อย ๆ เคลื่อนเข้าออก ข้ามจุดตัดได้ ไม่สะดุด) / Jump at every cut · ปรับ Zoom amount 4–30% + Zoom speed Slow/Normal/Fast · **ปิด zoom เป็นช่วง**: คลิกแถบม่วงบน Timeline = ปิด/เปิดชิ้นนั้น หรือลากเลือกแล้วกด `🚫 No zoom` / `🔍 Zoom` · Undo ได้
  - คลิปจริงใช้ FFmpeg `perspective` เพราะ scale/crop ปกติขยับเป็นพิกเซลเต็ม ทำให้ซูมช้าแล้วภาพสั่น · วัดแล้ว ~69 เฟรม/วิ บน 4 CPU (คลิป 7 นาที ~3 นาที)
  - ทดสอบ render จริง 8 กรณี (คลิปกว้าง/แนวตั้ง, Smooth/Jump, มี/ไม่มีช่วงปิด): ระดับซูมตรงกับ preview ทุกเฟรมที่สุ่ม (42/42 ต่อกรณี) · ลองปุ่มบนหน้าเว็บด้วยเบราว์เซอร์จริงผ่าน · ⏳ ยังไม่ได้ลองกับคลิปจริงบนเว็บจริง และยังไม่มีคนดูว่า "เป็นธรรมชาติ" ไหม
  - แก้ไปด้วย: คลิปจริงเกินมา 1 เฟรมที่ท้ายคลิป
- **16 ภาษา** (`cdcdfd3`): en th es fr de pt it nl pl id ru uk bg fi no ca
  - คัดโดยวัดจริง ไม่ได้เชื่อรายชื่อ (Deepgram บอกรองรับเกือบ 60 ภาษา แต่ไม่มีตัวเลขความแม่นรายภาษา): เสียงอ่าน Spoken Wikipedia ภาษาละ 3 ไฟล์ เทียบกับบทความ · เกณฑ์: ความมั่นใจเฉลี่ย ≥ 93%, ไฟล์ดีสุด ≥ 80% ของคำที่ได้ยินเป็นคำจริงในบทความ, ไม่มีไฟล์ต่ำกว่า 60%, ต้องเว้นวรรคระหว่างคำ
  - ⚠️ หลักฐานยังอ่อน: ภาษาละไม่กี่นาที เสียงอาสาสมัคร และบทความอาจแก้หลังอัด · ดัตช์มีแค่ไฟล์เดียว · คะแนนต่ำไม่ได้แปลว่าแย่เสมอ (สเปนได้ไฟล์สั้นมาก) · ค่า Deepgram ทดสอบรวม ~$1–2
  - ไม่ผ่าน/ยังไม่เปิด: ญี่ปุ่น จีน (ไม่มีวรรค ต้องทำตัดบรรทัดเอง + ฟอนต์) · อาหรับ เปอร์เซีย (ขวาไปซ้าย) · ฮินดี ทมิฬ มาเลย์ (คะแนนต่ำ) · สวีเดน เดนมาร์ก เช็ก ฮังการี โรมาเนีย กรีก (มั่นใจต่ำกว่าเกณฑ์หรือแกว่ง) · เซอร์เบีย (Deepgram ออกเป็นอักษรละติน บทความเป็นซีริลลิก วัดไม่ได้) · ตุรกี ลิทัวเนีย ไม่มีเสียงทดสอบ · เกาหลี เวียดนาม ไม่ได้วัด
  - แก้ไปด้วย: อักษรรัสเซียในคลิปจริงใช้ฟอนต์สุ่มจนคำเกือบติดกัน → เพิ่ม Fira Sans (ต้อง deploy Modal) · หน้า preview โหลดตัวอักษรยุโรป (latin-ext) ครบ · เซิร์ฟเวอร์ไม่รับภาษานอกรายการ
- **My banners** (`67f143c`): ⭐ บันทึกป้าย แล้วกดเพิ่มในคลิปไหนก็ได้ · ⏳ ยังไม่ได้ลองกับบัญชีจริง
- **Scene Swap ด่านแรก (วันที่ 36)**: ตรวจสัญญาจาก GitHub ของแต่ละโมเดล: BiRefNet, BEN2, Cutie = MIT · SAM2, MODNet = Apache · **MatAnyone ห้ามเชิงพาณิชย์ · RVM = GPL เลี่ยง** · ทั้งหมดนี้ดูแค่สัญญาของ**โค้ด** ยังต้องเช็กไฟล์ model weights/ข้อมูลเทรนก่อนขายจริง
  - ลอง BiRefNet กับ 6 เฟรมของคลิป Eng01 บน CPU: ขอบแว่นและผมสั้นคมมาก · เห็นเงาจาง ๆ ของชั้นหนังสือบนพื้นหลังใหม่ ต้องกรอง mask ค่าต่ำทิ้ง · ขอบ mask ขยับระหว่างเฟรม อาจต้องทำให้นิ่งเพิ่ม · ⏳ ยังไม่รู้ต้นทุนจริง (CPU ช้าเกินใช้ ต้องวัดบน GPU) ผมยาว/มือยังไม่ได้ลอง

**2 พ.ย. สาย: หน้าตัดต่อแบบ minimal (แนวคิดโค้ช: "น้อยแต่มากและครบเครื่อง" ซ่อนไว้ กดแล้วค่อยเปิด)** — ขึ้นเว็บแล้ว (`2bc8cfc`)
- เปิดมาไม่มีตัวเลือกเลย: ใต้คลิปเหลือแถบไอคอน `Subtitles` `Zoom` `Banners` `Shape` `Brand` กดอันไหนเปิดอันนั้น (`ControlSection` ใน `SubtitleControls.tsx`, หน้า Brand Kit ยังโชว์ครบ)
- คลิกแถบคำบรรยายสีเขียว → เปิดแผงตัวอักษร · ไอคอน 🔍 บนแถบ wave → เปิดแผง Zoom + แถบม่วงบน wave (ปิดแผง = แถบหาย คลิกตรงนั้นไม่มีผล) · Zoom เลือกแล้วใช้ทั้งคลิปเป็นค่าเริ่มต้น + ปุ่ม `Zoom the whole video`
- ค่าตัวอักษรใหม่: `Letter spacing`, `Line spacing` (เฉพาะ Two lines), `Text colour` · ทดสอบ render: ระยะบรรทัด 40/80 → แถวบนขึ้น 40/80 px พอดี
- ⚠️ ภาษาไทยปิด Letter spacing: libass เว้นระยะสระและวรรณยุกต์ด้วย ทำให้หลุดจากพยัญชนะ (เห็นจากภาพ render จริง)
- คอลัมน์ขวาอยู่เหนือ Timeline เสมอ (`--player-h`): เปิดแผงแล้ววิดีโอย่อ เดิมแผงจมอยู่หลัง Timeline
- ⏳ ลองด้วยหน้าทดสอบ ยังไม่ได้ลองกับคลิปจริง · ยังไม่ได้ลองบนมือถือ/iPad

**3 พ.ย. (วันเดียว หลายรอบ)** — ขึ้นเว็บแล้วทั้งหมด (`2ad495c`, `e4177d5`, `c983853`, `7c45f01`)
- **Error 1102 รู้สาเหตุแล้ว**: Observability ขึ้น `exceededCpu` ราว 70 ครั้งช่วงบ่าย 2 วันที่ 2 พ.ย. (แพ็กเกจ Free ให้ CPU ~10 ms ต่อคำขอ) → อัปเกรด **Workers Paid** · อาจมีส่วนจากหน้า admin ที่ดาวน์โหลดไฟล์ 116 MB ใน `logs/test/` ทุกครั้งที่เปิด (แก้แล้ว ยังไม่ยืนยันว่าเกี่ยว)
- **แปลซับ (วันที่ 28 ส่วนแรก)**: 33 ภาษา ดาวน์โหลด .srt · ทดสอบ Opus / Sonnet / Haiku: Haiku 5.5 ส่งกลับบรรทัดไม่ครบ 3 จาก 4 รอบ · Opus กับ Sonnet ครบ 12/12 · Sonnet ราคาครึ่งหนึ่ง (~$0.05 ต่อ 250 บรรทัด ส่งรอบละ 40) จึงเลือก Sonnet 5.5 · ⏳ ยังไม่ได้ฝังลงคลิป
- **ตามลิสต์โค้ชรอบแรก**: My projects รายชื่อ/Thumbnail + ลบ · Letter spacing ใช้กับไทยได้ (space อยู่หลังสระ/วรรณยุกต์ตัวสุดท้าย สระไม่หลุด) · สีกล่องและขอบ · Preview เร่ง 1–2x (วัดจริง 1.00x, 1.51x, 2.00x) · ย้ายเครื่องมือไปข้างคลิป + Timeline ใต้สคริปต์ + ลากแถบย่อขยาย + แผงลอยไม่ทำให้คลิปหด · อิโมจิเป็นไอคอน (เหลือชื่อแท็บ ✅/❌ และแจ้งเตือนเดสก์ท็อป) · กลางวัน/กลางคืน
- **ความปลอดภัย**: ลิงก์อัปโหลดล็อกขนาดและชนิดไฟล์ (ทดสอบกับ R2 จริง) · `/api/report` และ waitlist รับเฉพาะ Origin เว็บเรา + จำกัดขนาด · header พื้นฐาน · เพดาน 20 อัปโหลด/วัน · ซ่อม ESLint (`npm run lint`, error 0)
- **อื่น ๆ**: หน้าแรกจริง + waitlist · `Wrong language?` ถอดเสียงใหม่ · ซับไทยที่เว้นระยะตัดบรรทัดเร็วขึ้น ตรงกับคลิปจริง 24/24 กรณี · สะกดแบบอเมริกัน
- **ตามลิสต์โค้ชรอบสอง**: Zoom in/out เดิมกระจาย 12% ทั้งคลิปจนมองไม่เห็น เปลี่ยนเป็นค่อย ๆ ซูมแล้วเริ่มใหม่ที่จุดตัด (preview กับคลิปจริงตรงกัน) · Bounce เด้งจากคำแรก เว้น 0.35 วิ · Box มี `Corners` + `Box opacity` (วาดเองด้วย ASS เพราะ libass ไม่มีมุมมน) กล่องขยายตามคำที่เด้ง · Big ขนาด 170 · Banner สี/มุม/ความทึบ/animation 6 แบบ + แถบรวมบน Timeline แทนช่องกรอกตัวเลข · ปุ่ม `Split` + ลูกศร 4 ปุ่มบนเส้นเสียง + เคอร์เซอร์ลูกศรบนแถบตัวเลข · Timeline ติดจอล่างบนมือถือ · สวิตช์ Theme มุมขวาบน + แผงสีตรงข้าม
- **หน้าเสร็จงาน + แบบฟอร์ม feedback**: เปิดเองหลัง Make video · คำตอบขึ้นใน /admin
- **อีเมล**: ยืนยันโดเมนใน Brevo, DKIM + SPF ผ่าน, เมลเข้ากล่องปกติ · mail-tester 5.2 เพราะเมลทดสอบไม่มีหัวข้อ/สั้น และโดเมนใหม่ ยังไม่ได้ทดสอบซ้ำด้วยเมลจริง
- ⏳ ทดสอบแบบจำลอง login ในเบราว์เซอร์ + render จริงบน Modal แล้ว · ยังไม่ได้ลองกับบัญชีจริง: อัปโหลดหลังล็อกลิงก์, ลบคลิปจริง, บันทึก waitlist/feedback จริง, แปลซับบนเว็บจริง, มือถือจริงด้วยนิ้ว, เสียงตอนเร่ง

**4–5 พ.ย. (งานตลาด ราคา หน้าแรก และระบบเชิญ)**
- **กติกาทำงานร่วม Claude + Codex** ใน `AGENTS.md`: แก้ไฟล์ทีละตัว, 1 งาน = 1 branch, ตารางบั๊กห้ามย้อน, โค้ดคู่เว็บ/`render.py` · commit แล้ว (`6b7b047`)
- **วิจัยราคา 7 เจ้า + เสียงผู้ใช้ + ต้นทุนจริง**: [Sheet ราคาและแพ็กเกจ](https://docs.google.com/spreadsheets/d/1SoOeJN6xIz8XPZw3uWvwayVPvjTP-pTklLBx5Q1JRVk/edit) · รายงาน `reports/` + `research_notes/` (commit แล้ว `6b7b047`) · Reddit, G2, Capterra เข้าแทบไม่ได้ หลักฐานจึงเอียงไปทาง Trustpilot · ต้นทุนฐาน ~$0.0078 ต่อนาที (ฟรี), ~$0.0214 (Pro) ยังไม่ได้วัดจาก Usage จริง
- **[ชุดงานการตลาด](https://claude.ai/artifact/Sv4j7wic9nFGnQ6KeAnLWo)**: อีเมลชวน โพสต์ FB/YouTube/X/TikTok ไทย+อังกฤษ คำถามสัมภาษณ์ แผน 14 วัน · ยังไม่ได้ส่งหรือโพสต์
- **หน้าแรกใหม่ ขึ้นเว็บแล้ว** (`68553b1`, `220e031`, `552d3fa`): Banner ท้องฟ้าใหญ่ + แสงอาทิตย์เคลื่อนรอบละ 2 นาที + โทรศัพท์ 3 เครื่อง + ลองแตะคำตัดได้ (ตัวอย่างจำลอง) + My words + การ์ดฟีเจอร์ + ฟอร์ม waitlist เดิม · ไฟล์ `src/app/page.tsx`, `src/app/landing.css`, `src/components/LandingDemos.tsx` · รูปคน `public/landing/*.webp` ตัดจากไฟล์ที่โค้ชแนบ ติดป้าย `Illustrative images` · เมฆสร้างด้วยโปรแกรม ไม่ใช่ภาพถ่าย
- **ระบบเชิญ + โควตา + หน้า admin 4 แท็บ** (ขึ้นเว็บแล้ว 5 พ.ย. `26da07e` หลัง Codex รีวิว): เพิ่ม/ถอนอีเมลใน `/admin`, 60 นาที/เดือนนับจากต้นฉบับรวมทุกคลิป, 500 MB/ไฟล์, 30 นาที/คลิป, งานพังคืนนาที, ห้ามสั่งงานซ้อน, ถอดเสียงไม่เกิน 3 ครั้ง/คลิป, แปลไม่เกิน 5 ภาษา/คลิป · คนไม่มีสิทธิ์เห็นหน้า `You're almost in` · ⏳ ผ่าน `tsc`, `lint`, `build` และทดสอบหน้าจอด้วยข้อมูลจำลอง · ยังไม่ได้ลองบัญชีจริง คลิปจริง และการคืนนาที · ยังไม่จำกัดจำนวนครั้ง Make video และนาทีแปลรวมต่อเดือน

**5 พ.ย. (เตรียม beta ฟรีให้คนรู้จัก)** — ขึ้นเว็บแล้วทั้งหมด (`main` = `5a72b98`) · Codex รีวิวแบบอ่านอย่างเดียว 8 รอบ (สั่งด้วย `codex exec -s read-only`)
- **ระบบเชิญ + โควตา** ขึ้นเว็บหลังแก้ตามรีวิว: เปิดสองแท็บจ่ายซ้ำไม่ได้ (`putIfAbsent` ใน `r2.ts`, ทดสอบกับ R2 จริง 5 คำขอพร้อมกันชนะ 1) · งานตายคืนนาที · อัปจากมือถือนับโควตา
- **Popup ต้อนรับ beta** (`BetaWelcome.tsx`) ภาษาอังกฤษ มีช่อง don't show again · **แท็บ Activity ใน /admin** ตารางรายคน (นาทีที่ใช้, ไปถึงขั้นไหน, feedback, error) · เก็บอีเมลเจ้าของไว้ใน `uploads/<id>/owner.json` · หน้า Privacy เพิ่มหัวข้อ "How you use Komoray"
- **Bounce ใหม่**: เด้งทุกคำตั้งแต่คำแรก ช้าลง ใหญ่ 150% บรรทัดไม่สั่น (คำวางตำแหน่งตายตัว `word_places`, `bounce_events`) · deploy Modal แล้ว · ⏳ Box และ Highlight ยังไม่ได้ render จริง
- **หน้าแรก**: การ์ด Shape บนมือถือสัดส่วนจริง · โลโก้ใหม่ในเมนู (`public/logo.svg`) · ไอคอนแท็บตัว K (`favicon.svg`) · **Banner เป็นวิดีโอกระเบนราหู** ทะเลเข้ม ว่ายซ้ายไปขวา เฟดดำช้า ๆ ไม่มีแถบดำหลังข้อความ (`HeroVideo.tsx`, `/api/hero-video` อ่าน R2 `site/hero-manta-v2-*.mp4` แบบ Range) · คลิป Pixabay 371534 เป็นคลิปที่ AI สร้าง ติดป้าย `AI-generated video`
- **บั๊กจริง: เทคซ้ำถูกตัดเองตอนเปิดคลิป** กฎแยกการพูดซ้ำกับการไล่รายการไม่ได้ ตัดผิด 5 จาก 11 จุดในคลิปไทย (จุดหนึ่งความหมายกลับด้าน) → เลิกตัดเอง แจ้งพร้อมปุ่ม `Cut them all` (`56e3401`) · พิสูจน์บนหน้าทดสอบ: ก่อนแก้ลบ 11 คำ หลังแก้ 0 · เพิ่มแถวในตารางบั๊กของ `AGENTS.md`
- **Bad takes ด้วย Claude Opus 5.5** (`src/lib/bad-takes.ts`, `/api/bad-takes`, `BadTakes.tsx`): อ่านสคริปต์ทีละ 1,500 คำ (ซ้อน 200) เสนอจุดตัดพร้อมเหตุผล ปุ่ม `Listen` / `Cut` / `Keep` / `Restore` · ไม่ตัดจนกว่าจะกด · ผลเก็บข้างคลิป จ่ายครั้งเดียวต่อสคริปต์ · **เปิดเฉพาะบัญชี admin** คนอื่นเห็นแบบเดิม (เปิดให้ทุกคน = ลบ 1 บรรทัดใน route + `aiTakes` ใน `edit/page.tsx`) · หน้า Privacy เพิ่มว่า Anthropic อ่านสคริปต์ (โค้ชอนุมัติข้อความ)
  - วัดก่อนทำ (5 คลิป 12 นาที, $0.28): Opus เสนอ 16 จุด อ่านแล้วไม่เจอที่ผิดชัด พลาด 1 · Sonnet 24 จุด ผิดชัดอย่างน้อย 3 → เลือก Opus ~$0.017/นาที (~$1 ต่อคนถ้าใช้ครบ 60 นาที) · ตัดสินจากการอ่าน ยังไม่มีใครฟัง
  - ⏳ ยังไม่ได้ลองเต็มระบบด้วยบัญชีจริง (ล็อกกันจ่ายซ้ำ, ไฟล์ Keep) · ปุ่ม Listen ยังไม่ได้ฟังเสียงจริง
  - พลาด: commit `5ccc200` ที่ build ไม่ผ่าน (แก้ใน `908ef56` ก่อน push) → ต่อไปให้ทุกคำสั่งตรวจหยุดเมื่อพังก่อน commit
- **ร่างโพสต์ Facebook 2–3 แบบ + อีเมล waitlist 2 ฉบับ** ส่งให้โค้ชในแชตแล้ว ยังไม่ได้โพสต์/ส่ง

**6 พ.ย. (ไอเดียโค้ช: เลือกก่อนเริ่ม ไม่ให้หน้าจอรก)** — ขึ้นเว็บแล้ว (`a8e7033`, Modal deploy แล้ว)
- โค้ชถามว่าทำไมคลิป VID20261030133753 ไม่ตัด "ตอนนี้เขาเข้าถึง" ที่พูดซ้ำ → เช็กไฟล์จริง: Claude เจอแล้ว (1:16, มั่นใจสูง) แต่ตอนนั้นระบบแค่เสนอ ไม่ตัดเอง และ Deepgram เขียนครั้งแรกเป็น "ตอนเนี้ย" · คลิปนี้ Claude เสนอ 6 จุด โค้ชกดตัดไป 2
- **Popup ตอนวางคลิป** (`UploadOptions.tsx`): ติ๊กไว้ให้ `Silences`, `Bad takes`, `Auto zoom`, `Subtitles` · `Light`, `Make-up`, `Cut person` สีเทาป้าย `Soon` (ยังไม่มีจริง) · อัปโหลดต่อระหว่างเลือก กด `Start` ก่อนอัปเสร็จ = รอแล้วเริ่มเอง · ปุ่ม `Choose what Komoray does` เปิดใหม่ได้ · ตัวเลือกเก็บใน `analyze.json` → `edit.json` (`options`) ใช้ครั้งแรกที่เปิด /edit · `Wrong language?` ใช้ตัวเลือกเดิม
- **ช่องเลือกภาษา** (`LanguagePicker.tsx`, `Flag.tsx`): ธงวาดเป็น SVG เอง (ธงอีโมจิไม่ขึ้นบน Windows) อังกฤษใช้ธงอเมริกา · ค้นได้ทั้งชื่อภาษาเองและชื่ออังกฤษ · ⭐ ตั้งภาษาประจำ เก็บกับบัญชีที่ R2 `prefs/<user id>.json` (`/api/prefs`) ขึ้นเป็นอันแรก
- **Bad takes ปุ่มเดียว** ข้าง `Pace`: `Cut bad takes (N)` ↔ `Bad takes cut (N)` ตัด/คืนทุกจุด ไม่แตะคำที่ลบเอง · ลบรายการแบบเดิม (`BadTakes.tsx`) · **เปิดให้ทุกคน** · ติ๊กตอนอัป = อ่านเองแล้วตัดให้ครั้งเดียว (`cutFirstTime`, `badTakesApplied`) · ไม่ติ๊ก หรือคลิปเก่า = ปุ่ม `Find bad takes` กดเองถึงเสียเงิน
- **ปิดซับได้**: ช่อง `Show subtitles on the video` ในแผง Subtitles · style ใหม่ `subtitles` (โค้ดคู่ `subtitle-style.ts` ↔ `render.py`) ป้ายและโลโก้ยังอยู่ · ไม่ติ๊ก Silences = ไม่ตัดช่วงเงียบ (`Pace` หาใหม่ได้) · ไม่ติ๊ก Auto zoom = zoom off
- ตรวจ: `tsc`/`lint` (0 error 28 warning)/`build` ผ่าน · ลอง popup บนจอมือถือ 17 ข้อผ่าน · `build_subtitles` ปิดซับแล้วไม่มีซับ ชื่อช่องยังอยู่ · Codex รีวิว 3 รอบ แก้ 2 ข้อ (คลิปเก่าถูกส่งให้ Claude อ่านเอง, `/api/prefs` รับ null แล้ว 500) · ข้อที่เห็นต่าง (ไม่แสดงข้อความจากกฎเก่าในคลิปที่ยังไม่กด Find bad takes) โค้ชเลือกไม่แก้
- ⏳ ยังไม่ได้ลองด้วยบัญชีจริง: อัปโหลดทั้งเส้นทาง, ตัดให้เองครั้งแรก, ปุ่ม Bad takes, ปิดซับในคลิปจริง (ป้ายตอนปิดซับลองในเครื่องไม่ได้ ขาด `uharfbuzz`)
- ✅ โค้ชลองแล้วผ่าน (บ่าย 6 พ.ย.): ข้อ 1 ของใหม่ข้างบน + Make video Bounce + Box/Highlight · ต้นทุนรวมถึงวันนี้: Deepgram $1.29, Modal $0.08, Claude $0.67 (เหลือ $14.33) · โพสต์เฟสส่วนตัวแล้ว มีคนขอใช้ 2 คน

**6 พ.ย. บ่าย (ความเห็นโค้ช 12 ข้อ)** — ขึ้นเว็บแล้ว (`2f8792e`, branch `claude/coach-feedback-6nov`, Modal deploy แล้ว) · **ไม่ได้ให้ Codex รีวิว** (โค้ชสั่งข้าม)
- **Popup ตั้งค่า**: คลิกนอกกล่องหรือ Esc = ปิด (ยกเว้นคลิกวิดีโอ/Timeline ที่ใช้ระหว่างปรับ) · ลากมุมขวาล่างยืดได้ (จำไว้แค่ตอนเปิดคลิปนั้น) · สีใหม่: `#706F6F` แทนดำ, `#F7F7F7` แทนขาว (`globals.css`)
- **Shape** เป็นรูป 9:16 / 1:1 / 16:9 ชี้แล้วบอกว่าเหมาะกับอะไร (`FORMATS[].for`) · **Original** → ปุ่มกลายเป็น `Back to editing` + แถบ "Your edits are safe"
- **Banner**: กลับไป `Where you dragged it` ได้หลังเลือก Top · My banners มีกล่องดาว + ถามก่อนลบ · บน Timeline คลิกเลือก → Delete ลบ, ลากขอบซ้ายเปลี่ยนเวลาเริ่ม
- **Zoom ทีละช่วง** (`zoomParts` ใน edit.json): Zoom in / Zoom out / Back and forth / Jump cut / No zoom / Reset ต่อช่วงที่ลากเลือกบน Timeline · ชื่อเมนูสั้นลง · โค้ดคู่ใหม่ `zoomPartFrames`/`partZoom` (zoom.ts) = `zoom_part_frames`/`part_zoom_expr` (render.py) · เทียบทีละเฟรมครบ 5 แบบ ตรงกัน
- **Key moments** (`/api/zoom-moments`, `lib/zoom-moments.ts`): Claude **Sonnet** อ่านสคริปต์เลือกช่วงที่ควรซูม + แบบซูม เก็บผลใน `zoom-moments.json` จ่ายครั้งเดียวต่อสคริปต์ · ติ๊ก Auto zoom ตอนอัป = ทำเองครั้งแรก แล้วส่วนอื่นของคลิปไม่ซูม · ห่างกันอย่างน้อย 5 วิ · ลองกับสคริปต์ไทยที่แต่งเอง 1 ครั้ง เลือกจุดสมเหตุผล · หน้า Privacy เพิ่ม "the moments worth a zoom" (โค้ชอนุมัติ)
- แผง Brand อธิบายว่า Brand Kit มี 1 แบบต่อบัญชี บันทึกซ้ำ = ทับ · โลโก้ 1 รูปต่อบัญชี เปลี่ยนรูป = เปลี่ยนทุกคลิป
- ตรวจ: `tsc`/`lint` (0 error 28 warning)/`build`/`py_compile` ผ่าน · ⏳ **ยังไม่ได้ลอง**: หน้าจอจริงทั้งหมด, FFmpeg ทำคลิปด้วยสูตรซูมใหม่ (ในเครื่องไม่มี FFmpeg), Key moments กับคลิปจริง
- ตาราง "โค้ดคู่" ใน `AGENTS.md` ยังไม่มีชื่อ `zoom_part_frames`, `part_zoom_expr` (แก้ไฟล์นั้นต้องให้โค้ชอนุมัติ)

**7 พ.ย. (staging + Cutout)** — อยู่บน branch ยังไม่รวม: `claude/staging` (`2bc84b6`, `bf313be`, `95afed1`) · `claude/cutout` (`9d2c2e2`, `d393f45`, `131f697`, `b43e9cf`)
- **Staging** https://staging.komoray.com: Worker `komoray-staging`, R2 `komoray-uploads-staging` (อัปโหลดลบเอง 7 วัน, logs 30 วัน), Supabase `komoray-staging`, Modal `komoray-render-staging` + `komoray-cutout-staging` · ป้าย STAGING สีเหลือง + noindex · ขึ้นด้วย `npm run deploy:staging` (ขึ้น branch ปัจจุบัน) · กุญแจ staging อยู่ใน `.dev.vars` ชื่อขึ้นต้น `STAGING_` / `R2_STAGING_` · ✅ โค้ชลองแล้ว: login, อัปโหลด, Make video, เว็บจริงไม่เห็นคลิป staging
- กติกาใหม่ใน `AGENTS.md`: งานเสี่ยงต้องขึ้น staging ให้โค้ชลองก่อนรวม · วิธี Rollback Worker ใน Cloudflare · staging ไว้ทดสอบเท่านั้น ไม่ใช่ที่หนีตอนเว็บจริงพัง
- **ผูกบัตร Modal แล้ว** (ใช้ GPU ได้)
- **Cutout ส่วน 1** (`modal_app/cutout.py`): โมเดล BiRefNet-matting (MIT, ล็อกรุ่น `eccde0a8…`) บน GPU L4 ตัดคนเฉพาะช่วงที่มีชั้น Cutout · ได้ `matte.mp4` (คลิปจริง) + `proxy-cutout.mp4` (ภาพบน matte ล่าง ให้ตัวเล่นในเว็บ) + `cutout.json` · ผมและแว่นตาเนียน ใช้ขอบของโมเดลตรง ๆ ดีที่สุด (ทดสอบ 3 รอบ)
- **เปิดฟีเจอร์ทีละคน** ใน `/admin`: ติ๊ก `Cutout` + เลือก 10 หรือ 50 วิต่อคลิป (เก็บใน R2 `access/people/<hash>.json` → `features`) · แอดมินเปิดเสมอ · ตัดได้ 5 ครั้งต่อคลิป · เซิร์ฟเวอร์ตรวจสิทธิ์เอง
- **Cutout ส่วน 2+3** (`src/lib/behind.ts` ↔ `behind_motion`, `build_behind`, `cutout_filters` ใน `render.py`): `Text behind you` 6 แบบ (Fade in, Burst, Drop and slam, Heartbeat, วิ่งซ้าย/ขวา + ความเร็ว) ฟอนต์ ขนาด สี ขอบ ความสูง · `Picture or clip` เต็มจอหลังคน คนย่อ/ย้าย/ซ่อนได้ ขอบไหล่จางนุ่ม · สูตรเคลื่อนไหวเว็บ = คลิปจริง (เทียบ 9,900 ค่า) · ✅ คลิปจริงบน staging ออกครบ · ✅ โค้ชลองตัวอักษรหลังตัวคนแล้ว "เจ๋งมาก"
- **ความเห็นโค้ช (แก้แล้ว `131f697`)**: แถบ Cutout บน Timeline (ฟ้า = ตัวอักษร, ส้ม = รูป/คลิป) ลาก/ยืด/ลบได้ · ปุ่มยุบคลื่นเสียงข้าง `Fit` · ลากขีดเหนือ Timeline ให้กล่องสคริปต์สูงขึ้น · หัวหน้าจอเหลือ Undo/Redo + เมนู `Cuts` (Pace, Bad takes, Wrong language?) + เมนู `Export` (.srt, แปล, แจ้งเตือน) + `Make video`
- **Codex รีวิว**: (1) ตัวตัดคน staging ใช้ Modal secret `komoray-render` ชุดเดียวกับเว็บจริง → Claude โต้แย้ง: ใช้ได้จริง (โค้ชตัดคนบน staging สำเร็จ) ตั้งใจใช้ token เดียวกัน แยกได้ภายหลังถ้าโค้ชสั่ง · (2) Make video ก่อน Cut me out → ตัวอักษรขึ้นหน้าคน → **แก้แล้ว `b43e9cf`**: ขึ้นข้อความให้กด Cut me out ก่อน + แถวใหม่ในตารางกันบั๊ก
- ต้นทุน GPU (คิดจากราคาประกาศ ยังไม่ได้ดูบิล): ~$0.02–0.03 ต่อ 10 วิ, ~$0.10 ต่อ 50 วิ · รอ ~5 นาทีถ้าเครื่องเย็น, ~1.5–2.5 นาทีถ้าเครื่องอุ่น
- ตรวจ: `tsc` 0 · `lint` 0 error 28 warning · `build` · `py_compile` ผ่าน · ⏳ ยังไม่ได้ลอง: หน้าใหม่ของ 131f697 และ b43e9cf ในเบราว์เซอร์จริง, Safari/iPad/มือถือ, ผมยาว/มือใกล้หน้า

**9 พ.ย. (ขึ้นเว็บจริงแล้ว)** — `b583f70` เสียงสตูดิโอทุกครั้งที่ `Make video` (ลดเสียงรบกวน, EQ เสียงพูด, de-esser, -14 LUFS) · `4eb15db` Audio optimization (เลือกตอนอัปโหลด + สวิตช์และแถบเลื่อนใน AI studio), หน้าต่างอัปโหลดการ์ดใหญ่ 2 คอลัมน์, หน้ารอหลังกด `Start` · `8e4fff6` เสียงตัวอย่างตรงกับภาพ · `f031976` ยุบคลื่นเสียงบน Timeline
- เปลี่ยนแผน 67 วัน: ตัด Scene Swap ออก แทนด้วยงานเสียง, ตัดและซูมตามบริบท, Intro Hook, Kinetic Typography, แบ่งหน้าจอ, 1 click 3 export (วันที่ 38–52 ใน Sheet)

**10 พ.ย. (ขึ้นเว็บจริงแล้ว `488c83b`, `7780701`)**
- **Cutout รวมเข้า main**: `Cut me out` ตัดทั้งคลิปครั้งเดียวในเครื่องลูกค้า (Google selfie segmenter ผ่าน MediaPipe) แล้ว Modal `finish_local` ทำ `matte.mp4` + `proxy-cutout.mp4` · มีเวลานับถอยหลังในกล่อง บนวิดีโอ ใต้ไอคอน · จุดเขียวบนไอคอนหายเมื่อกดไอคอนเท่านั้น · popup ถามก่อนลบ Text behind you, รูป, คลิป (ทั้งในกล่องและบน Timeline; Banner ยังลบทันที)
- กล่อง Cutout แยกแท็บ `Text behind you` / `Picture or clip` (รูป/คลิปเป็น thumbnail) · แถบ `Text speed` คือความเร็วตัวอักษร ไม่ใช่คุณภาพ
- `Picture or clip` ใหม่: ตัวเรา `Your size` ถึง 150%, `You stand`, `You rise` · รูป/คลิป `Size`, `Left / right`, `Up / down`, `Rotate` · ถ้าไม่เต็มจอเป็นพื้นดำ · ตัวอย่างในเว็บเทียบภาพกับตัวกรองจริงตรงกัน 3 แบบ · ตัดเฉพาะส่วนที่เห็นในจอ (3 ชิ้นสุดขั้วจาก 4.3 GB เหลือ 1.5 GB, 10 ชิ้นสุดขั้ว 3.3 GB บนเครื่อง 4 GB)
- `CUTOUT_ON` ใน `src/lib/cutout.ts` คุมคุณภาพที่เปิด ตอนนี้ `["fast"]` เซิร์ฟเวอร์ปฏิเสธแบบอื่น · โค้ด Normal (MODNet) กับ Slow (BiRefNet) ยังอยู่ · การเก็บทุกคุณภาพแยกไฟล์ (`keepCurrent`, `savedFiles`) ยังอยู่ในโค้ด ใช้เมื่อเปิดหลายคุณภาพ
- `Make video` เปอร์เซ็นต์จริงจากจำนวนเฟรม (`render-progress.json`) · ส่งตัวเลขไม่สำเร็จคลิปยังทำต่อ · ลองคลิปจริง 50 วิบน Modal staging ตัวเลขขึ้นถูก จบ 38 วิ
- Codex รีวิวทุกงานวันนี้ แก้ตามแล้ว: ล็อกต่อคลิปกันไฟล์สลับคุณภาพ, ปิดช่อง GPU ไม่เสียโควตา, หน้า admin เข้าใจผิดว่าไฟล์ matte คือต้นฉบับ, `Switching…` ค้าง, ตัวเลขคลิปก่อนมาปน, `Make video again` ขึ้นว่าเสร็จทั้งที่ยังทำ · ไม่แก้ 2 ข้อ (ลบคลิประหว่างสลับคุณภาพ, เน็ตหลุดแล้วหน้ารอต่อ)
- ตรวจ: `tsc` 0 · `lint` 0 error 28 warning · `build` · `py_compile` ผ่าน · ✅ โค้ชลอง Cutout บนเว็บจริงแล้วโอเค · ⏳ ยังไม่ได้ลอง: เปอร์เซ็นต์บนหน้าเว็บจริง, Mac/Safari/iPad/มือถือ, บัญชีที่ไม่ใช่แอดมิน

**10 พ.ย. บ่าย (ขึ้นเว็บจริงแล้ว `3997305`, `2b4f69e`)**
- โควตา beta ในโค้ดแล้ว (`src/lib/limits.ts`): รวม 45 นาทีตลอดช่วงทดลอง · คลิปละไม่เกิน 20 นาที · ไฟล์ละไม่เกิน 2 GB · ลิงก์อัปโหลดอยู่ 1 ชม. · ทดสอบไฟล์ 1.94 GB ยาว 20 นาทีบน Modal staging ผ่าน (Deepgram 75 วิ, Make video 11 นาที 31 วิ, proxy 3 นาที 26 วิ)
- Cutout: แท็บ `Text behind` / `Pic/Clip` / `Motion` (Soon) กรอบฟ้าที่แท็บที่เลือก · Text behind เคาะได้ 3 บรรทัด + `Line gap` · ตั้งชื่อรูป/คลิป (`Name`) โชว์บน Timeline · ลากตัวคนและมุมย่อขยายบนวิดีโอตอนหยุด · `Soft edges` (ค่าเริ่มต้นขอบคม) · วงสี 4 วง + ช่องเลือกสีทุกเมนู · โลโก้ลูกค้าชิดขอบขึ้น (40 px)
- `Split` กดครั้งเดียวตัดทั้งเสียงและซับ ชิดขอบคำที่ใกล้ที่สุด · ลากซับแยกตำแหน่งได้ทีละชิ้นที่ Split · Codex เจอบั๊ก 2 ข้อ แก้แล้ว · ตัวอย่างกับคลิปจริงเทียบซับ 5 แบบตรงกัน

**11 พ.ย. (ขึ้นเว็บจริงแล้ว `56cf9e1`, โค้ชลองบน staging ผ่าน)** จากรายการ 16 ข้อของการใช้งานจริง
- `Find & replace` หาคำไทยที่อยู่กลางคำได้ (`findInside`) เช่น ฉนั้น · `Fix all` และคัมภีร์คำยังเทียบทั้งคำ
- คำที่แก้แล้วเคาะเว้นวรรค ซับไล่สี/เด้งทีละคำ และเว้นวรรคตามที่พิมพ์ (`splitFix` ส่ง flag `space` ถึง `render.py`)
- ข้อความหาย: แก้คำยาวเกิน 200 ตัวถูกตัดเงียบ ตอนนี้รับ 2,000 ตัว เกินแล้วไม่ให้ Save · ของเดิมที่ถูกตัดไปกู้ด้วยปุ่ม `Original`
- ซับ `Line spacing` ติดลบได้ถึง -40 (Two lines)
- `Pic/Clip` รับ PNG, WebP, GIF โปร่งใส มองทะลุถึงวิดีโอ (เช็กพิกเซลโปร่งใสในเบราว์เซอร์ `seeThrough`) · ตัวคนคงขนาดเต็ม · `Put it in front of me` วางรูปหน้าคน · รูปมี `Movement`: Still / Zoom in / Zoom out + `Zoom speed` 5–60% · GIF ใน FFmpeg ต้องใช้ `-ignore_loop 0` (เพิ่มแถวใน `AGENTS.md`)
- ฟอนต์ Google อีก 20 แบบ (รวม 28) ทุกตัวสิทธิ์ SIL OFL · ไทย 12: Itim, Sriracha, Pattaya, Chonburi, Charm, Mali, Bai Jamjuree, K2D, Krub, Kodchasan, Trirong, Maitree · อังกฤษ 8: Bangers, Pacifico, Lobster, Abril Fatface, Alfa Slab One, Righteous, Archivo Black, Titan One · ใช้ได้ในซับและ Text behind (Banner ยังไม่ได้) · Charm และ Mali ดูเล็กกว่าที่ Size เท่ากัน
- ตัดคำไทยด้วย **newmm** (PyThaiNLP เขียนเป็น TypeScript ใน Worker, `src/lib/newmm.ts` + พจนานุกรม CC0 62,109 คำ) แทน `Intl.Segmenter` · ผลตรง PyThaiNLP 5,012/5,012 · F1 ประโยคพูด 0.957 จาก 0.891 · Worker รวม 2.07 MB gzip · ใช้กับคลิปที่อัปโหลดใหม่เท่านั้น
- ตรวจ: `tsc`, `lint` 0 error, `build`, `py_compile` ผ่าน · FFmpeg จริงบน Modal (โปร่งใส, GIF, Zoom, ฟอนต์ 28 ตัว) ผ่าน · Codex รีวิวทุกชุด แก้ 2 ข้อ · ⏳ ยังไม่ได้ลองบนเว็บจริงหลังรวม: Make video กับรูป PNG, คลิปไทยใหม่ดูการตัดคำ


**11 พ.ย. รอบ 2 (ขึ้นเว็บจริงแล้ว `c81f2c5`, `02d16ad`, `87d4cd6`, `3df9230`, `19165ae` · Modal ตัวจริง deploy ก่อน push)**
- **Banner:** ฟอนต์ของตัวเอง, 3 บรรทัด + Line gap (ถึง -60), ขนาดถึง 500%, หลายบรรทัดอยู่ใน**กล่องเดียว** (คลิปจริงวาดทีละเฟรมตอน Pop/Bounce/Pulse, ตรวจบน Modal แล้ว), เปิด/ปิด `Background`, แท็บตามชนิด, อัปโหลด Banner รูป/คลิป MP4 พร้อมท่าเข้า (Fade, Pop, Bounce, Slide, Pulse), แท็บ Upload โชว์ไฟล์ที่เคยอัปโหลด กดใช้ซ้ำได้, **Duplicate**, popup ถามก่อนลบโผล่บนสุดจริง (รวมปุ่ม Delete บนคีย์บอร์ด)
- **Undo** จำ Banner และชั้น Cutout แล้ว (เดิมย้อนไปเปลี่ยนคำในซับ)
- **Import:** คลังไฟล์ของโปรเจกต์ ใช้รูป/คลิปซ้ำได้โดยไม่ต้องอัปโหลดใหม่
- **Make video เร็วขึ้น:** ปรับเสียงคู่ขนานกับภาพ + ทำภาพเป็น 4 ท่อนพร้อมกัน (เครื่อง 8 GB) · คลิป 5 นาที + Auto zoom ภาพ 175 → 55 วิ · โค้ชลองคลิป 5.29 นาทีบนเว็บจริงใช้ 4:50 นาที (ยังไม่ได้ดูว่าช้าตรงไหน)
- **AI แก้คำผิด** (`src/lib/spelling.ts`, `/api/spelling`): Claude Haiku 5.5 effort medium อ่านสคริปต์ทั้งคลิปครั้งเดียวต่อคลิปใหม่ หลังคัมภีร์คำส่วนตัว · ขีดเส้นใต้สีเขียว มี Undo · ทดสอบคลิป VID20261028143211: แก้ถูก 11–13 จาก ~15 จุด ไม่เคยทำคำถูกให้ผิด · ~$0.01 ต่อ 10 นาที · ค่าทดสอบ Claude รวม ~$0.21
- **คลังคำของ Komoray** (`src/lib/shared-words.ts`): คำที่แอดมินแก้เข้าคลังเอง · `/admin` → แท็บ **Words** เพิ่ม/ลบ/ค้น/ดาวน์โหลด CSV · คลัง staging กับเว็บจริงแยกกัน
- **แชร์คำแบบติ๊กยินยอม** (My words → `Help make Komoray more accurate for everyone`): คำที่ 3 ครีเอเตอร์แก้เหมือนกันจึงเข้าคลังกลาง · รับเฉพาะคู่คำที่หน้าตาคล้ายกัน ไม่รับตัวเลข/ลิงก์ · ผู้โหวตเก็บเป็นรหัส HMAC · **หน้า Privacy อัปเดต 11 พ.ย.** (โค้ชอนุมัติ)
- ตรวจ: `tsc` 0 · `lint` 0 error 26 warning · `build` · `py_compile` ผ่าน · Codex รีวิวทุกชุด แก้ตามแล้วทั้งหมด (เหลือ 2 ข้อที่บันทึกไว้: จุดย่อขยาย Banner คลาดตอนหยุดกลาง Pop ซึ่งมีมาก่อน, การเขียนไฟล์ prefs/คลังคำพร้อมกัน) · โค้ชลอง 3 อย่างบน staging ผ่าน · ⏳ ยังไม่ได้ลองบนเว็บจริงหลังรวม: AI แก้คำกับคลิปใหม่, Banner Pop 2 บรรทัดในคลิปจริง

**12 พ.ย. (ขึ้นเว็บจริงแล้ว `7c09204`, `904872d` · Modal ตัวจริง v37, v38 deploy ก่อน push · โค้ชรัน deploy + push เอง)** จากรายการของโค้ช 12 พ.ย.
- **Layers + Move here:** ปุ่มขึ้น-ลงชั้น (ลำดับในรายการคือชั้น อันหลังอยู่บน) และ `Move here` ย้ายไปที่เส้นฟ้า ใน Banner, Text behind, Pic/Clip · กล่อง Cutout โชว์ทีละอย่าง · Import / Pic/Clip สลับ `List` / `Thumbnails` ได้ (จำในเบราว์เซอร์)
- **Make video ที่มี Cutout เร็วขึ้น ~2 เท่า:** ท่อนภาพกระโดดไปจุดเริ่มด้วย `-ss` และอ่าน matte เฉพาะท่อนที่มีชั้น Cutout · คลิป 3 นาทีมี Cutout 53.1 → 23.3 วิ, ไม่มี Cutout 23.7 → 17.6 วิ · ภาพตรงของเดิม (เพิ่มแถวใน `AGENTS.md` ข้อ 5)
- **เสียงคลิปที่แทรก** (Pic/Clip, Banner คลิป, พื้นหลังคลิปของ Frame Me): คลิปใหม่เปิดเสียงเบา ๆ 20% · ช่อง `Mute` (จำระดับเสียงไว้) + แถบปรับเสียง · คลิปเก่าที่บันทึกไว้ยังเงียบ · คลิปจริงผสมเสียงหลังทำภาพ (`mix_clip_sounds`) · iPhone/iPad ปรับความดังในตัวอย่างไม่ได้ (iOS ไม่ยอม) คลิปจริงถูกต้อง
- **Darken / Blur background** ใน Cutout: ปุ่มเทมเพลต 2 แบบ + แถบ Darken / Blur ในทุก Text behind · พื้นหลังมืด/เบลอ ตัวคนชัดเหมือนเดิม
- **Frame Me** (เมนูใหม่, ใช้ได้ทุกคน ไม่ต้องตัดคน): คนอยู่ในกรอบ Circle / Oval / Square / Rounded / Triangle / Star / Heart ตามช่วงเวลา · ขนาด ตำแหน่ง ซูมตัวเอง ขยับตัวเองในกรอบ (`Center me`) เส้นขอบ · พื้นหลัง Blur / Color / Picture or clip (จาก Import) · ลากกรอบ มุม และจุดฟ้ากลางกรอบบนจอได้ตอนหยุด · แถบเขียวบน Timeline · จางเข้าออก 0.25 วิ · ใช้กับ 9:16, 1:1, 16:9 · โค้ดคู่ `frame-me.ts` ↔ `frame_points`/`frame_rect`/`frame_art`/`frame_filters` (เพิ่มในตาราง `AGENTS.md` ข้อ 4)
- ตรวจ: `tsc` · `lint` 0 error 26 warning · `build` · `py_compile` ผ่าน · รูปทรงตัวอย่างตรงคลิปจริง 99.7–99.9% · ทำเป็นท่อนตรงกับทั้งคลิป 46–49 dB · จางเข้าออกวัดได้ตรงสูตร · Codex รีวิวทุกชุด แก้ครบ · ⏳ ยังไม่ได้ลองบน /edit จริงกับคลิปคนจริง และ iPhone/iPad

---

## ⚠️ ติดอยู่ / เรื่องที่ต้องรู้

| เรื่อง | รายละเอียด | ต้องทำเมื่อไหร่ |
|---|---|---|
| 🔐 **ระบบเชิญขึ้นแล้ว แต่ยังไม่ได้ลองด้วยบัญชีอื่น** | ต้องเพิ่มอีเมลใน `/admin` ก่อนถึงใช้ได้ · โควตา 60 นาที/เดือน · ยังไม่มีใครลองครบ 7 ขั้นด้วย Gmail อีกบัญชี | ก่อนส่งลิงก์ให้คนแรก |
| 🔍 **Zoom ใหม่ยังไม่ผ่านคลิปจริง (6 พ.ย.)** | สูตรซูมทีละช่วงยังไม่เคยผ่าน FFmpeg จริง (ตรวจแค่ตัวเลขตรงกับตัวอย่าง) · ข้ามรีวิว Codex · Key moments ใช้ Sonnet ประมาณ ~$0.005/คลิป (เดา ยังไม่ได้วัด) | โค้ชกด Make video กับคลิปที่มี Key moments เป็นอย่างแรก · ถ้าพัง: กดซ้ำ 1 ครั้งก่อน แล้วแจ้ง Claude |
| 🤖 **Bad takes เปิดให้ทุกคนแล้ว (6 พ.ย.)** | โค้ชฟังผลแล้ว 1 คลิป (VID20261030133753) · ติ๊กตอนอัป = ตัดให้เอง · ไม่มีเพดานค่า AI รายเดือนแยก (~$0.017/นาที, ~$1/คน/เดือนที่ 60 นาที) | ดู Anthropic Console หลังมีคนใช้ · ถ้าตัดผิดบ่อย ปรับคำสั่งใน `src/lib/bad-takes.ts` |
| 🖼️ **รูปคนบนหน้าแรก** | ตัดจากไฟล์ที่โค้ชแนบ ไม่ทราบที่มาและสิทธิ์ของไฟล์ ความละเอียดต่ำ · เครดิต Canva หมด | โค้ชยืนยันสิทธิ์ หรือเปลี่ยนเป็นคลิป/รูปจริง |
| 🟡 **Error 1102: เช็กหลังอัปเกรด** | อัปเกรด Workers Paid แล้ว 3 พ.ย. · ยังไม่ได้ดูว่า `exceededCpu` เป็น 0 หลังใช้งานจริง | โค้ชใช้เว็บสักวัน แล้วดู `Workers & Pages` → `komoray` → `Observability` · `Group By` = `$workers.outcome` |
| 🧪 **ของใหม่ยังไม่ผ่านบัญชีจริง** | อัปโหลดจากคอม/มือถือ, ลบคลิป, แปลซับ, waitlist, feedback, มือถือด้วยนิ้ว | **ก่อนชวน beta โดยเฉพาะอัปโหลด** · เช็กลิสต์อยู่ใน "ขั้นต่อไป" |
| 📧 **เมลเข้า hello@ อาจตกหล่น** | 3 พ.ย. Gmail ตอบเมลจาก Google ที่ Cloudflare ส่งต่อด้วย `421 4.7.28` (จำกัดชั่วคราว ไม่ใช่การตั้งค่าเรา) · เมลทดสอบจากคนอื่นผ่าน · ระหว่าง beta ให้ดู `Email Routing` → `Activity log` เป็นระยะ | ย้ายไป Google Workspace เมื่อมีคนตอบกลับสม่ำเสมอ (Brevo ใช้ต่อได้ ไม่ซ้ำกัน) |
| 🖼️ **รูปโปรไฟล์เมล hello@** | ✅ ใช้ได้แล้ว 3 พ.ย.: `hello@komoray.com` เป็น `Alternate emails` ของบัญชี `komoray.studio@gmail.com` ซึ่งใส่โลโก้ไว้ · บัญชีนี้มีหน้าที่เก็บรูปเท่านั้น ส่งเมลยังใช้ Gmail หลักเลือก `From` เป็น hello@ · **ห้ามลบบัญชีนี้หรือเอา hello@ ออก** | ล็อกอินบัญชีนี้เป็นระยะ และเปิดยืนยัน 2 ชั้น + แก้ `Recovery email` ที่ขึ้น `Verification needed` |
| 🗃️ **ไฟล์เก่าใน R2** | `logs/test/` 12 ไฟล์ ~155 MB เป็นไฟล์ทดสอบของ Claude 31 ต.ค. ไม่ได้ถูกเจาะ ลบเองภายใน 90 วัน · วิดีโอ banner รุ่นแรกใน `site/` ไม่ใช้แล้ว (ใช้ `site/hero-manta-v2-*`) · **โค้ชบอก 5 พ.ย. ว่าจะทยอยลบเอง Claude ห้ามลบ** | โค้ชลบเอง |
| 🖼️ ไฟล์ในโปรเจกต์ที่ไม่ใช้แล้ว | `public/landing/clouds.webp` ไม่มีโค้ดเรียกใช้ (เช็ก 6 พ.ย.) | ลบเมื่อโค้ชบอก |
| 🚀 **ลำดับขึ้นเว็บ** | `python -m modal deploy modal_app/render.py` **ก่อน** แล้วค่อย `git push origin main` (Modal เฉพาะเมื่อแก้ `render.py`) · 12 พ.ย. ระบบสิทธิ์ของ Claude Code ไม่ยอมให้ Claude deploy Modal ตัวจริงเอง (ขึ้น staging ได้) ตอนนี้โค้ชรันเองใน Terminal ถ้าจะให้ Claude ทำ ต้องเพิ่มสิทธิ์ `python -m modal deploy` และ `git push` · บน Windows ต้องใส่ `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` หน้าคำสั่ง Modal ไม่งั้นพังที่เครื่องหมาย ✓ (6 พ.ย.) | ทุกครั้งที่จะขึ้นเว็บ |
| 🔲 **Frame Me / เสียงคลิป ยังไม่ผ่านคลิปคนจริง (12 พ.ย.)** | ทดสอบด้วยภาพทดสอบบน Modal และหน้า dev ใน Chrome เท่านั้น · ระหว่างกรอบกำลังจาง 0.25 วิ ตัวอย่างไม่เห็นข้อความ Cutout ใต้กรอบ แต่คลิปจริงเห็น | โค้ชลองบน komoray.com |
| 💳 Modal GPU | ✅ ผูกบัตรแล้ว 7 พ.ย. · ยังไม่ได้ดูค่า GPU จริงในบิล | ดู Modal → Usage หลังมีคนใช้ Cutout |
| ✂️ **Cutout บนเว็บจริง (10 พ.ย.)** | เปิดทีละคนใน `/admin` · ยังไม่ได้ลองกับบัญชีที่ไม่ใช่แอดมิน และ Mac/Safari/iPad/มือถือ · สิทธิ์โมเดล Google ระบุ Apache 2.0 แต่เช็กได้จากสำเนา model card ยังไม่ได้จากหน้าทางการ · ไฟล์โมเดลและไลบรารีโหลดจาก jsDelivr กับ Google ถ้าล่ม Cutout ใช้ไม่ได้ · Modal `komoray-cutout` staging ใช้ secret `komoray-render` ร่วมกับเว็บจริง (Codex ทัก ยังรอโค้ชตัดสิน Claude แนะนำให้แยกภายหลัง) · เสียงของคลิปแทรกถูกปิดไว้ | ก่อนเปิดให้ลูกค้าทั่วไป: เช็กสิทธิ์โมเดล, ย้ายไฟล์โมเดลมาไว้ระบบเรา |

| 🖼️ Google consent screen | **ห้ามอัปโหลดโลโก้** ในหน้า Branding (ต้องรอ Google ตรวจหลายวัน) · หน้าเลือกบัญชีจะโชว์ `icjjeinussbapihdjiym.supabase.co` (แก้ได้ด้วย Supabase custom domain แบบเสียเงิน) | ภายหลัง |
| 🇹🇭 Deepgram ภาษาไทย | ตกตัวอักษรบางตัว (เช่น "จุดเด่คือ", "โค้", "ผูหญิง", "ปหา", "พิมพ" ไม่มีการันต์) และผิดไม่ซ้ำกันจน Find & replace ช่วยไม่ได้ · ตัดคำใช้ newmm แล้ว (11 พ.ย.) · แผนแก้คำผิด: ส่งให้ AI เฉพาะประโยคที่ newmm เจอคำนอกพจนานุกรม (ลองแล้วจับได้ 9/9 แต่จับคำที่สะกดถูกแต่ผิดความหมายไม่ได้ เช่น "พิมพ" เพราะอยู่ในพจนานุกรม) · **11 พ.ย. รอบ 2: AI แก้คำผิดด้วย Haiku ขึ้นเว็บแล้ว** (อ่านทั้งคลิป ไม่ใช่เฉพาะประโยคนอกพจนานุกรม เพราะวิธีนั้นพลาด 6 จาก 14) · ยังพลาดบางคำ · เร่งเติมคลังคำของ Komoray ก่อนเปิดให้ผู้ใช้แชร์จริง | โค้ชกด `Add all my words` ใน /admin → Words |
| 🎬 ตัวเล่นใหม่ | ✅ ลื่นบน iPad + Chrome (โค้ชทดสอบ 31 ต.ค.) · ภาพบีบบน iPad แก้แล้ว รอโค้ชดูอีกรอบ · iPhone / Mac Safari ยังไม่ได้ลอง | รอบทดสอบถัดไป |
| 🗃️ บันทึก debug เก่า | 2 ชุดแรกจาก iPad อยู่ที่ `debug/` (ก่อนย้ายไป `logs/debug/`) ไม่มีกฎลบเอง · เล็กมาก | ลบเมื่อว่าง |
| 🗂️ คลิปก่อนมี login | 10 คลิปทดสอบไม่มีเจ้าของในตาราง projects → เปิดจาก /upload ไม่ได้ ดูได้ใน admin · หมดอายุเองตามกฎ 14 วัน | ไม่ต้องทำอะไร |
| 💸 Deepgram opt out อาจแพงขึ้น | ยังไม่รู้ตัวเลขจริง · เช็กใน Deepgram Console → Usage หลังมีคลิปใหม่ | ครั้งถัดไปที่ทดสอบ |
| 🌐 ไม่มีปุ่มจากหน้าแรกไป /upload | หน้าแรกจริงขึ้นแล้ว แต่ตั้งใจไม่มีปุ่ม Sign in · ส่งลิงก์ `/upload` ให้เฉพาะคน beta · R2 ลบไฟล์ใน `uploads/` เองหลัง 14 วัน | ใส่ปุ่มตอน soft launch |
| 🇹🇭 คลิปไทยเจอช่วงเงียบน้อย | มีช่วง 28.99–43.49 วิ (14.5 วิ) ในคลิปโค้ช รอโค้ชฟังว่าเงียบจริงไหม | รอคำตอบจากโค้ช |
| 🖼️ Banner บน X | ใช้ภาพคนที่ AI สร้าง + ตัวเลขยอดไลก์ อาจทำให้เข้าใจผิดว่าเป็นลูกค้าจริง | แนะนำลบตัวเลข / เปลี่ยนเป็นภาพจริงภายหลัง |
| 📣 งานตลาด / launch / ติดต่อ creator | โค้ชสั่ง**ข้ามไปก่อน** (29 ต.ค.) · 0 โพสต์ · ยังไม่มี beta · soft launch จึงยังไม่เกิด | รอโค้ชตัดสินใจวันใหม่ |
| 💻 บทเรียน | เวลาทดสอบด้วย `next dev` เบื้องหลัง ต้องปิด process ให้หมด ไม่งั้น `npm run dev` ของโค้ชจะเปิดไม่ได้ · ทดสอบหน้าตาได้ด้วย Chrome headless + สคริปต์ CDP (ทำหน้า dev ชั่วคราวที่ไม่ต้อง login แล้วลบทิ้ง) | ทุกครั้งที่ทดสอบ |
| 🎞️ ตัวเล่นสำรอง | `PreviewPlayer` (เบราว์เซอร์ไม่มี WebCodecs) ไม่มีปุ่มเร่งความเร็ว เพราะสลับ video 2 ตัวตามจังหวะ | ถ้ามีคนเจอ |
| 🏠 Find silences บน localhost | Deepgram ส่งผล callback มาที่เครื่องในบ้านไม่ได้ จะค้างที่ Listening · ทดสอบบน komoray.com หรือจำลอง callback ด้วยลายเซ็น HMAC | ทุกครั้งที่ทดสอบในเครื่อง |
| 📦 ขนาดไฟล์ 500 MB | คลิป 4K ของมืออาชีพเกินแน่นอน · โค้ชเลือก**ยังไม่ขยาย**ตอนนี้ · ของจริงควรจำกัดตามความยาวคลิป/แพ็กเกจ + อัปโหลดแบบแบ่งชิ้น (multipart) | หลังมี login |

---

## ⏭️ ขั้นต่อไป

**แชทหน้าเริ่มตรงนี้:**
0. **โค้ชลองบน komoray.com หลังรวม 12 พ.ย.:** Frame Me → Heart → ลากกรอบ/มุม/จุดฟ้า → พื้นหลัง Blur, Color, Picture or clip → Make video เทียบตัวอย่าง · ใส่คลิปใน Pic/Clip ต้องได้ยินเสียงเบา ๆ ติ๊ก `Mute` แล้วเงียบ · Make video ที่มี Cutout ต้องเร็วขึ้น
   **งานถัดไปจากรายการ 12 พ.ย.:** **Layout + Transition** (ใส่คลิปหรือรูปแบบลากวาง, ฟ้าแลบ, เลื่อนเข้าหากัน) งานใหญ่สุด ต้องคุยรายละเอียดกับโค้ชก่อนเริ่ม
0. **โค้ชลองบน komoray.com หลังรวม 11 พ.ย.:** ใส่รูป PNG โปร่งใส + Zoom in แล้ว Make video เทียบตัวอย่าง · อัปโหลดคลิปไทยใหม่ 1 คลิปดูการตัดคำ (ถ้ายังผิด ส่ง 3–5 จุดพร้อมคำที่ถูก) · เปอร์เซ็นต์ `Make video`
   **ทำก่อน (โค้ช):** komoray.com/admin → แท็บ **Words** → `Add all my words` (หรือวาง 17 คำที่ส่งมา) · ลองบนเว็บจริง: อัปคลิปไทยใหม่ ควรเห็นแถบเขียว `The AI fixed N words` · Banner 2 บรรทัด + Pop แล้ว Make video ดูว่าขยายเป็นก้อนเดียว (ถ้ายังแยก กด Make video อีกรอบ เพราะเครื่อง Modal รุ่นเก่า)
   **ที่เหลือจากรายการของโค้ช (11 พ.ย.):** (1) Cutout ผมฟุ้ง/เป็นจุด (2) ลูกเล่นฟอนต์ Banner: เส้นขอบ, เงาฟุ้ง, เงาแข็ง, Glow (3) ดูใน admin ว่าคลิป 5.29 นาทีที่ใช้ 4:50 ช้าตรงไหน (4) ถามโค้ช: ซ่อนช่องติ๊กแชร์คำจนกว่าจะ launch ไหม · ต่อจากรายการ 16 ข้อ: `Insert`, `Topic`, `Motion Background`, `Video Layout` (วันที่ 47, 49)
   **โน้ตจากโค้ช 10 พ.ย. (ยังไม่ทำ):** duplicate แถบ Text และ Pic/Clip บน Timeline · หมุนตัวคน · เมนู Motion graphic ทยอยเพิ่ม template (เงินโปรย ดอกไม้ ประกาย แสง กราฟิกแบบการ์ตูน; Claude แนะนำทำหลัง launch ใช้เฉพาะงานที่ทำเองหรือมีสิทธิ์) · Motion text ด้านหน้าตัวคน · ย้ายไฟล์โมเดลตัดคนจาก jsDelivr/Google มาไว้ที่เรา · แยกเสียงก่อนส่ง Deepgram (เพดาน Deepgram 2 GB, โค้ชให้ทดไว้) · เพิ่มกติกา "Codex รีวิวทุกงาน" ลง `AGENTS.md` ยังรอโค้ชอนุมัติ
   **เรื่องที่โค้ชยังต้องตัดสิน:** ราคาและแพ็กเกจ เปิด Cutout ให้แพ็กไหน (ไม่ต้องมีระบบเครดิตหรือโควตานาที Cutout ก่อน launch แล้ว เพราะเหลือ Fast)
1. **โค้ชลอง 12 ข้อที่แก้บ่าย 6 พ.ย.** บน komoray.com (/edit): อัปคลิปใหม่ติ๊ก Auto zoom → แผง Zoom → รอ `Finding key moments…` → แถบม่วงบน Timeline มีชื่อเป็นช่วง ๆ ช่วงอื่นไม่ซูม → **Make video แล้วดูว่าซูมตรงกับตัวอย่าง** · ลากคลุมช่วง → `Zoom out` · popup ปิดเมื่อคลิกสคริปต์ + ลากมุมยืด · Banner: Top → `Where you dragged it` กลับที่เดิม, คลิกบน Timeline → Delete, x ใน My banners ถามก่อน · Shape 3 รูป · `Back to editing` · สี popup ทั้ง 2 Theme
2. ทดสอบระบบเชิญด้วย Gmail อีกบัญชี (บัญชี admin ไม่ถูกนับโควตา): หน้ารอคำเชิญ → `Add email` ใน /admin → นาทีเหลือ 60 → อัปคลิปจริงจากมือถือ → popup → `Start` → นาทีลดตรงไหม · **ผ่านแล้วค่อยเพิ่มอีเมล 2 คนที่ขอใช้**
3. ดูวิดีโอ banner บน iPhone/iPad จริง · คลิปไทยที่ไล่รายการ: Bad takes ตัดเนื้อหาจริงผิดไหม
4. ดู Anthropic Console หลังมีคนใช้ Key moments เพื่อรู้ต้นทุนจริงต่อคลิป

**ของที่อยากเพิ่มเพื่อแทน CapCut + Gling (ความเห็นโค้ช 4 พ.ย.):** แต่งแสงสี + หัวข้อพร้อม animation แล้วทดสอบทำ 5 คลิปโดยไม่เปิดโปรแกรมอื่น

**แนวทาง (Claude แนะนำ 3 พ.ย.):** หยุดเพิ่มฟีเจอร์ใหญ่ไว้ก่อน แล้วชวน beta 5–10 คนในสัปดาห์นี้ เพราะยังไม่มีคนนอกใช้เลย

**1. โค้ชลองบนเว็บจริงก่อน (ตามลำดับ):** อัปโหลดจากคอม → อัปโหลดจากมือถือ (QR) → แปลซับ → Make video ด้วย Box + Corners + Bounce + Letter spacing → หน้าเสร็จงาน + ส่ง feedback → `/admin` → ลบคลิป → Preview 2x ฟังเสียง → ลากแถบย่อขยาย → Zoom in → Banner + ลากบน Timeline → Split บนมือถือด้วยนิ้ว → สวิตช์ Theme

**2. ชวน beta:** เลือกครีเอเตอร์ 5–10 คน เขียนข้อความชวน (Claude ช่วยร่าง) ส่งจาก hello@ ทีละคน ทดสอบเมลจริงซ้ำก่อน (มีหัวข้อ เนื้อหาเต็ม) ส่งเข้า Gmail อีกบัญชี + Outlook

**งานที่ Claude ทำได้เลย:**
- แก้ตามผลทดสอบข้อ 1
- ฝังซับแปลลงคลิป (ปิดวันที่ 28) ทำเมื่อ beta ขอ: ต้องเช็กฟอนต์แต่ละภาษา
- ทดสอบคลิปที่ค้าง 6 คลิป + แนวนอน + .mov (ต้องให้โค้ชอัปคลิปและดูผล)

**งานที่รอโค้ช:**
1. สมัคร Paddle + ตัดสินใจราคา (วันที่ 29–33) ต้องถามว่ารับผู้ขายจากไทยไหม → โควตาจริง (วันที่ 31)
2. ผูกบัตร Modal → Scene Swap ต่อ (วันที่ 36–52)
3. Google Workspace (~45 นาที, ~$7/เดือน) เมื่อมีคนตอบกลับสม่ำเสมอ: MX เป็นของ Google + ปิด Cloudflare Email Routing + DKIM Google + เพิ่ม Google ใน SPF · **ไม่ต้องยกเลิก Brevo**
4. หาคนพูดภาษาอื่นช่วยดูซับ/คำแปล (เริ่มจาก es, de, pt) ก่อนโฆษณาว่ารองรับ
5. ตัดสินใจ: อ่านข้อความหน้าแรก · เพดาน 20 คลิป/วันเหมาะไหม · ลบ `logs/test/` ไหม · Brand ID และปรับสี
6. ก่อน public launch 15 ธ.ค.: นักกฎหมายดู Privacy/Terms · landing page จริงพร้อมคลิป before/after + ราคา + FAQ

**งานตลาด (วันละ ~30 นาที, เร่งด่วน):**
1. โพสต์แรก build in public บน X (โค้ชเล่าเป็นภาษาไทย Claude เกลาเป็นอังกฤษ)
2. รายชื่อครีเอเตอร์ talking head มืออาชีพ 50 คน
3. DM ชวน beta 10 คน (คอมเมนต์คุยก่อนแล้วค่อย DM)

**ไอเดียต่อ:** Chrome Remote Desktop ถ้าอยากรันคำสั่งจากมือถือ · ขอบรอบตัวอักษรใน Box (โค้ชบอกยังไม่เอา 3 พ.ย.) · Zoom ตามประโยคสำคัญด้วย Claude

**ไอเดียที่โค้ชให้ทดไว้ (31 ต.ค., ยังไม่ทำ):**
- **คัมภีร์คำกลางของแต่ละภาษา** (เช่น ผูหญิง → ผู้หญิง) ใช้กับทุกคนที่พูดภาษานั้น + คัมภีร์ส่วนตัวทับอีกชั้น · Claude แนะนำ: ทีมเราเป็นคนคัดคำเข้าคัมภีร์กลางเอง (ไม่ดึงคำของผู้ใช้ไปใช้อัตโนมัติ เพราะสัญญาไว้ในหน้า Privacy ว่าคำของผู้ใช้เป็นของเขาคนเดียว) · ถ้าจะนับว่าคำไหนถูกแก้บ่อยในหลายบัญชี ต้องแก้หน้า Privacy และขอความยินยอมก่อน · **✅ ทำแล้ว 11 พ.ย.** (คลังของ Komoray + แชร์แบบติ๊กยินยอม, แก้ Privacy แล้ว)

---

## 📌 การตัดสินใจสำคัญ

- **OpenNext** แทน vinext (vinext ยังเป็น beta)
- **Deepgram อ่านคลิปจาก R2 โดยตรง** ไม่ต้องใช้ Modal/Python ในขั้นหาช่วงเงียบ (Modal ยังต้องใช้ตอนตัดคลิป)
- แยกโค้ดถอดเสียงไว้ไฟล์เดียว (`transcribe.ts`) อนาคตเปลี่ยนเป็นเจ้าอื่นหรือ Whisper ของเราเองได้
- กลุ่มเป้าหมาย = มืออาชีพ · ไม่ใช้คำว่า editor · ไม่ใช้ข้อความแนว "อย่าอาย"
- ไม่ใช้คนที่ AI สร้างมาสร้างความน่าเชื่อถือ · ใช้ footage ตัวจริงของโค้ช + เสียงพากย์ ElevenLabs (เสียงโค้ชเอง, บอกคนดูว่าใช้ AI)
- ไม่ใส่ตัวเลขอย่าง "10x faster" จนกว่าจะวัดจริงกับ beta
- **Deepgram ใช้แบบ callback** (28 ต.ค.) เพราะคลิปยาวเกิน 100 วิของการรอแบบปกติ (error 524)
- **คลิปเสร็จแจ้งเตือนบนจออย่างเดียว ไม่ส่งอีเมล** (28 ต.ค.)
- **การเก็บไฟล์** (แก้ 30 ต.ค.): beta ลบทุกอย่างหลัง 14 วัน · ระยะยาว: **เก็บตลอด จำกัดพื้นที่ตามแพ็กเกจ ผู้ใช้ลบเอง** (แทนแผนเดิม Free 7 / Pro 30 / Business 90 วัน) · บัญชีที่ไม่ใช้เกิน 12 เดือนเตือนก่อน 30 วันแล้วลบ · edit.json เก็บตลอด · ต้องแก้หน้า privacy + อีเมลแจ้งผู้ใช้เมื่อเปลี่ยน
- **ไม่ขายข้อมูล ไม่เอาคลิปไปเทรน AI** (30 ต.ค.) · Deepgram ใช้ `mip_opt_out=true` · ร่าง privacy/terms ใช้ได้ช่วง beta แต่ก่อน public launch ให้นักกฎหมายดู (ลูกค้าอเมริกา + PDPA ไทย)
- **อีเมล** (แก้ 3 พ.ย.): รับผ่าน Cloudflare Email Routing · ส่งผ่าน Gmail "Send mail as" + Brevo ฟรี (DKIM ของ komoray.com) · ย้ายกล่องเมลไป Google Workspace เมื่อมีคนตอบกลับสม่ำเสมอ ลูกค้าจ่ายเงิน หรือมีทีม · Brevo ใช้ต่อกับเมลจำนวนมาก
- **แปลซับใช้ Claude Sonnet 5.5** (3 พ.ย.): ไม่ใช้ Deepgram เพราะถอดเสียงอย่างเดียว · Haiku ส่งบรรทัดไม่ครบ · แยกโมเดลรายภาษาได้ถ้ามีหลักฐานว่าคุ้ม
- **Banner ทุกอย่างบนแถบเดียวบน Timeline** (3 พ.ย.): ฉากหลังและกราฟิกในอนาคตใส่แถบนี้ ไม่เพิ่มเส้นจนตาลาย
- **รูปโปรไฟล์เมลใช้บัญชี `komoray.studio@gmail.com`** (3 พ.ย.): ฟรี ยังไม่ทำ BIMI (โลโก้แบรนด์แบบทางการ มักมีค่าใบรับรองรายปี)
- **สูตรตัดหางคำ** (29 ต.ค.): แก้ที่สูตรของเรา ไม่ได้แก้ที่ Deepgram · ค่า 0.2 + 0.05×ตัวอักษร
- ไอเดียช่วงเงียบที่ตั้งใจเว้น (29 ต.ค.): ระดับความกระชับ Tight/Natural/Relaxed + ย่อช่วงเงียบแทนตัดทิ้ง + กดคืนจุดตัดใน Script view
- **คัมภีร์คำส่วนตัวที่โตเอง** (30 ต.ค.): จุดขายหลัก + ทำให้ลูกค้าไม่ย้ายไปเจ้าอื่น (Gling แก้คำผิดซ้ำ ๆ ไม่ได้ + ไทยเว้นวรรคมั่ว) · เก็บในฐานข้อมูลผูกกับบัญชี ไม่ผูกกับเบราว์เซอร์ เพื่อใช้ต่อในแอป PC/Mac ในอนาคต · ไม่เอาไปเทรน AI กลาง (เป็นของผู้ใช้คนนั้นเท่านั้น)
  - ร่างกติกาการเก็บคัมภีร์ (30 ต.ค., ยังไม่ทำ): ผูกกับ**บัญชี** ไม่ผูกกับการจ่ายเงิน → หยุดจ่ายแล้วคัมภีร์ยังอยู่ (ไฟล์เล็กมาก + เป็นเหตุผลให้กลับมา) · ลบเมื่อบัญชีไม่ได้ใช้เกิน 12 เดือน (เตือนทางอีเมลก่อน 30 วัน, ใช้กติกาเดียวกับบัญชี) · ผู้ใช้ export และลบเองได้ตลอด · ระบุในหน้า Privacy + แจ้งตอนเปิดใช้คัมภีร์ครั้งแรก
- **ตัวอย่างคลิปทำเอง ไม่ใช้ Remotion** (30 ต.ค.): Remotion ค้างที่จุดตัด · ถ้าอนาคตอยากให้ตัวอย่างกับคลิปจริงตรงกัน 100% ค่อยพิจารณา render ด้วยเทคโนโลยีเดียวกัน (หลังมี beta)
- **หน้าตัดต่อแบบซ้ายข้อความ-ขวาคลิป เป็นหน้าใหม่ `/edit` ไม่ใช่ pop up** (30 ต.ค., ไอเดียโค้ช) เพราะเบราว์เซอร์บล็อก pop up และใช้บนมือถือยาก
- **กลยุทธ์ต่อ Gling** (30 ต.ค.): เก็บสิ่งที่เขาทำดีให้ "พอดี" · ทุ่มเรื่องที่เราชนะได้จริง (ภาษาไทย, คัมภีร์คำ) · ไม่ไล่ตามทุกฟีเจอร์จนไม่ได้ launch · ให้ beta บอกว่าขาดอะไร
- **ร่างราคา ยังไม่อนุมัติ** (4 พ.ย.): ขายเป็นนาที ไม่ใช้เครดิต ไม่ลดแข่ง · Free 60 นาทีแรก + 15/เดือน มีลายน้ำ · Creator $29/$20 · Pro $45/$36 (แนะนำ) · Studio $119/$89 ต้องมีระบบทีมก่อน · Founding 40% 100 คนแรก · ตั้งราคาไม่ต่ำกว่าต้นทุนเมื่อใช้เต็มโควตา · ฟรีแบบโควตารายเดือนแทนทดลอง 7 วัน · วางแผนเปลี่ยนเป็นลูกค้าที่ 3% ของคนสมัคร ไม่ใช้ 9% (ProductLed เป็น B2B รวม free trial)
- **ใช้รูปคนตัวอย่างบนหน้าแรกชั่วคราว** (5 พ.ย., โค้ชตัดสินใจ): ยกเว้นจากกติกาเดิมที่ไม่ใช้คน AI สร้างความน่าเชื่อถือ · ไม่มียอดไลก์ ติดป้าย `Illustrative images` · เปลี่ยนเป็นคลิปจริงเมื่อมี
- **เทคซ้ำไม่ตัดเอง** (5 พ.ย.): ระบบเสนอได้ แต่ผู้ใช้เป็นคนกดตัดเสมอ เพราะตัดเนื้อหาจริงผิดแย่กว่าพลาดเทคเสีย (อยู่ในตารางบั๊กของ `AGENTS.md`)
- **Bad takes ใช้ Claude Opus 5.5 ไม่ใช้ Sonnet** (5 พ.ย.): Sonnet ถูกกว่า ~3 เท่า แต่เสนอตัดเนื้อหาจริง · ไม่หักนาทีของผู้ใช้ · การอ่านรายการไฟล์ Keep ทุกครั้งที่ถาม (Codex ทักไว้) โค้ชเลือกไม่แก้ เพราะไฟล์น้อย (6 พ.ย. ปุ่ม Keep เลิกใช้แล้ว)
- **เลือกก่อนเริ่ม ไม่ใช่รายการให้ไล่ดู** (6 พ.ย., โค้ช): popup ตอนวางคลิป ติ๊กไว้ให้ 4 อย่าง ฟีเจอร์ที่ยังไม่มีแสดงเป็นสีเทา `Soon` · Bad takes เปิดให้ทุกคน ติ๊กแล้ว AI ตัดให้เองครั้งเดียว (แก้แถวตารางบั๊ก `AGENTS.md` แล้ว) · กฎเทคซ้ำแบบเก่ายังห้ามตัดเอง และแสดงเฉพาะเมื่อ Claude ทำงานไม่ได้ · ภาษาต้องเลือกเสมอ (Deepgram เดาไทยไม่ได้) จึงวางบนสุดของ popup ไม่ได้อยู่ใต้ Subtitles
- **Banner หน้าแรกใช้วิดีโอที่ AI สร้าง** (5 พ.ย., โค้ชเลือก): ติดป้าย `AI-generated video` · ไม่ใช่คน จึงไม่ขัดกติกาเรื่องความน่าเชื่อถือ
- **Zoom เฉพาะช่วงสำคัญ ไม่ซูมทุกเทค** (6 พ.ย., โค้ช): ซูมทุกเทคดูจงใจและน่าเบื่อ → AI (Sonnet ไม่ใช่ Opus เพราะซูมผิดไม่ทำให้เนื้อหาหาย) เลือกช่วงและแบบซูมตามอารมณ์ · ผู้ใช้เปลี่ยนแบบซูมทีละช่วงได้ · โค้ชรับค่าใช้จ่ายเพิ่มแล้ว และสั่งข้ามรีวิว Codex เพื่อขึ้นเว็บวันนี้
- **โควตา beta** (5 พ.ย.): 60 นาที/เดือน, 500 MB/ไฟล์, 30 นาที/คลิป (เปลี่ยนจาก 15 เพราะคลิปจริงของโค้ชยาว 19 นาที) · นับจากต้นฉบับ ไม่จำกัดความยาวคลิปที่ตัดเสร็จ
- **Cutout เหลือ Fast อย่างเดียว** (10 พ.ย., โค้ชเทียบเองแล้วแทบไม่ต่าง): เร็วที่สุด ใช้ได้กับเครื่องมากที่สุด ไม่มีค่า GPU · Normal และ Slow เก็บโค้ดไว้ เปิดคืนที่ `CUTOUT_ON` ถ้าวันหน้าอยากมี Slow สำหรับแพ็กสูง · เรื่องนี้ทำให้โควตา Slow และระบบเครดิตไม่จำเป็นก่อน launch
- **Codex รีวิวทุกงาน** (10 พ.ย., โค้ช): Claude สั่ง Codex เองทุกครั้งที่จบงาน ไม่ต้องรอโค้ชส่งไม้ · ยังไม่อยู่ใน `AGENTS.md` จนกว่าโค้ชจะอนุมัติ
- **โควตาใหม่ที่โค้ชกำหนด** (10 พ.ย., **ส่วน beta ขึ้นเว็บแล้ว** ใน `src/lib/limits.ts` ส่วน Free ยังไม่ได้สร้าง): beta รวม 45 นาที **ตลอดช่วงทดลอง ไม่ใช่ต่อเดือน** ไฟล์ละไม่เกิน 20 นาที · วัน launch beta ทุกคนย้ายเป็น Free อัตโนมัติ และนับเดือนแรกจากวัน launch · Free เดือนแรกรวม 35 นาที ไฟล์ละไม่เกิน 15 นาที · จากนั้น 25 นาทีต่อเดือน ไฟล์ละไม่เกิน 12 นาที อีก 3 เดือน (Free รวม 4 เดือนนับเดือนแรก พร้อมลายน้ำ) แล้วส่งเมลชวนสมัครพร้อมส่วนลด (ต้องมีปุ่มเลิกรับ และเช็ก Privacy ก่อน) · รอบใช้งานนับจากวันสมัคร ไม่นับตามเดือนปฏิทิน เช่น สมัคร 30 ก.ย. หมด 29 ต.ค. · ใช้แทนแผนเดิมในไฟล์ราคา (60 นาทีตอนสมัคร + 15 นาที/เดือน) และแผนวันที่ 31 (Free 1 นาที) · ฟีเจอร์ของ Free ยังไม่ตัดสิน: แนวคิดโค้ชคือเดือนแรกลอง Cutout ได้แต่ไม่มี Motion graphic เดือนถัดไปเหลือตัดชน ซับ และลายน้ำ
- **ลายน้ำ Free** (10 พ.ย., โค้ช, ยังไม่ได้ทำ): มีทุกเดือนรวมเดือนแรก ใช้โลโก้ K + ชื่อ Komoray เป็นสีเดียว (ขาวหรือดำ) พื้นโปร่งใส opacity ~30% · ค่อย ๆ fade เข้าและออก โผล่ครั้งละ ~12 วิ แล้วหายไปแบบสุ่ม 30–45 วิ · สลับมุมแบบสุ่มครบ 4 มุม · ต้องสุ่มแบบกำหนดผลได้จากรหัสคลิป เพื่อให้ตัวอย่างใน `/edit` ตรงกับคลิปจริง · ค้นไม่เจอโค้ดลายน้ำ Komoray ใน `render.py` ต้องสร้างใหม่
- **ทิศทางราคาเทียบ Gling** (10 พ.ย., โค้ช): ไม่หนี Gling มาก แต่ไม่แข่งราคา ถ้าแพงกว่าต้องตอบได้ว่ามีอะไรที่ Gling ไม่มี (Cutout, Motion graphic; Audio optimization มีเหมือนกัน ใช้เป็นจุดต่างไม่ได้) · ไม่ทำ B-roll · ราคา Gling ที่โค้ชดูมา: $20/10 ชม., $40/30 ชม., $100/100 ชม., export ไม่จำกัด (ตัวเลข Gling ในไฟล์ Competitor Analysis ไม่ตรง ห้ามใช้ตั้งราคา) · หน้าราคาใช้นาทีเป็นตัวเลขหลัก (ชั่วโมงกำกับเล็ก ๆ) และเขียน Unlimited exports ในแพ็กเกจจ่ายเงิน · ตัวเลขราคาจริงรอวัดต้นทุนจาก beta
- **เพดานขนาดไฟล์** (10 พ.ย., โค้ชกำหนด, beta 2 GB ขึ้นเว็บแล้ว แพ็กอื่นยังไม่ได้ทำ): ขนาดสูงสุดต่อ 1 ไฟล์ต่อการอัปโหลด 1 ครั้ง ไม่จำกัด GB รวมต่อเดือนทุกแพ็กเกจ · beta 2 GB · Free 1 GB · แพ็กเกจจ่ายเงิน 5 GB · Pack Max 10 GB เป็นแพ็กระดับองค์กร (เกินที่ R2 รับ PUT ครั้งเดียวได้คือ 5 GiB ต้องมีอัปโหลดแบบแบ่งชิ้นก่อนขาย โค้ชให้ทดไว้ ทำประมาณ 5 เดือนหลัง launch) · ระหว่าง beta เก็บขนาดไฟล์ MB ต่อนาที และเวลาทำคลิปจริง · ก่อนขยายต้องลองคลิปขนาดเต็ม 1 คลิปบน Modal staging (`render` มี RAM 4 GB, timeout 30 นาที) · ตอนนี้นาทีถูกหักตอนกด Find silences ไม่ใช่ตอนอัปโหลด ไฟล์ที่อัปแล้วไม่กดจึงไม่เสียโควตา
- **ตัดคำไทยด้วย newmm ใน Cloudflare** (11 พ.ย., โค้ช): เบาพอใส่ใน Worker ไม่ต้องใช้ Modal · DeepCut ไม่ใช้ (TensorFlow 1.3 GB ผลไม่ดีกว่า) · PyThaiNLP แก้คำผิดเองไม่ใช้ (ทำคำถูกเสีย 5/9 เช่น คอนเทนต์→คอนแวนต์) · ภาษาอื่นที่เปิดอยู่มีวรรคอยู่แล้ว ไม่ต้องใช้ spaCy, NLTK, tokenizer ของ AI · **จีน/ญี่ปุ่นทำหลัง launch** (ต้องทำตัดบรรทัด ฟอนต์ และวัดผล ไม่ใช่แค่ Jieba/MeCab)
- **แก้คำผิดไทยด้วย AI เฉพาะประโยคที่มีคำนอกพจนานุกรม** (11 พ.ย., โค้ช): ประหยัดกว่าส่งทั้งสคริปต์ · ยอมพลาดคำที่สะกดถูกแต่ผิดความหมาย · เลือกโมเดลหลังทดสอบจริงเท่านั้น (ประเมินต่อคลิป 10 นาที: Haiku ~$0.002, GPT-5.4 nano ~$0.005, Gemini 3.5 Flash-Lite ~$0.009, Sonnet ~$0.04)
- **AI แก้คำผิดใช้ Haiku 5.5 effort medium ไปก่อน** (11 พ.ย., โค้ช): ผลใกล้ Opus (11–13 vs 12–13 จาก ~15) ไม่ทำคำถูกให้ผิด ถูกกว่ามาก · effort low แต่งคำขึ้นเอง ห้ามใช้ · Haiku ไม่มี fallback ถ้าล่ม ผู้ใช้กด `Try again`
- **คลังคำไทยของ Komoray ก่อน แล้วค่อยเปิดให้ผู้ใช้แชร์** (11 พ.ย., โค้ช): แชร์ต้องติ๊กยินยอมเอง ไม่เปิดเผยตัวตน คำต้องแก้เหมือนกันอย่างน้อย 3 คนจึงเข้าคลังกลาง (กันชื่อคนหลุด)
- **ระยะเก็บไฟล์แพ็กจ่ายเงิน** (11–12 พ.ย., โค้ช, ยังไม่ได้ทำ ทำพร้อมงานราคาวันที่ 29–33): ต้นฉบับลบหลัง 45 วัน · แพ็กบนสุด (~$100) 1 TB เก็บ 60 วัน · Free 14 วันเหมือน beta · เมลเตือน 14 และ 7 วันก่อนลบ · My projects โชว์วันที่เหลือ · หลังลบต้นฉบับยังดาวน์โหลดคลิปเสร็จได้แต่ Make video ไม่ได้ · **เริ่มต่ำแล้วเพิ่มเท่านั้น ห้ามลด** · ต้องเขียน Privacy ใหม่ให้โค้ชอนุมัติ
- **แชทใหม่ทุกวัน** (30 ต.ค.): แชทยาวเปลืองโควตาและถูกย่อจนรายละเอียดหาย → ปิดงานทุกวันให้ PROGRESS.md ครบ แล้ววันใหม่เริ่มแชทใหม่
- ก่อน Public launch: เพิ่มเจ้าถอดเสียงสำรองที่สลับอัตโนมัติถ้า Deepgram ล่ม (ยังไม่ยืนยันกับโค้ช) กันอีเมลขยะ · อีเมล (Resend) ใช้เฉพาะเรื่องสำคัญ: ฟีเจอร์ใหม่, ชวนอัปเกรด, waitlist, ต้อนรับ
