# Komoray: บันทึกความคืบหน้า

อัปเดตล่าสุด: **30 ต.ค. 2026 (ค่ำ)** · ตอนนี้เร็วกว่าแผน ~5 วัน
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
- **Cloudflare Workers ผ่าน OpenNext** (`@opennextjs/cloudflare`) เลือกแทน vinext เพราะ vinext ยังเป็น beta
- **Workers Builds**: push ขึ้น `main` แล้ว Cloudflare build + deploy เองอัตโนมัติ
  - Build: `npx opennextjs-cloudflare build` · Deploy: `npx opennextjs-cloudflare deploy` · Preview: `npx opennextjs-cloudflare upload`
- **Cloudflare R2**: ตู้ `komoray-uploads` (CORS อนุญาต localhost:3000, komoray.com, www, workers.dev)
- **Deepgram** (model `nova-3`) ถอดเสียงพร้อมเวลารายคำ รองรับ `en` และ `th`
- **Modal** ตัดคลิปด้วย FFmpeg (แอป `komoray-render`)
- **Supabase** (โปรเจกต์ `komoray`, Free, ฐานข้อมูลอยู่ us-west-2) สำหรับ login · Google provider เปิดแล้ว · URL `https://icjjeinussbapihdjiym.supabase.co`
  - ตาราง `projects` (1 แถว = 1 คลิป, `id` = โฟลเดอร์ใน R2) + Row Level Security: เห็น/เพิ่ม/ลบได้เฉพาะของตัวเอง · SQL อยู่ที่ `supabase/migrations/`
  - รันคำสั่ง SQL จากเครื่อง: ต่อผ่าน `aws-1-us-west-2.pooler.supabase.com:5432` user `postgres.icjjeinussbapihdjiym` + `SUPABASE_DB_PASSWORD`
  - URL Configuration: Site URL `https://komoray.com` · Redirect URLs komoray.com/**, www.komoray.com/**, localhost:3000/**
- **Google Cloud** โปรเจกต์ `komoray` → Google Auth Platform: แอป Komoray (External, **Published** 30 ต.ค., ไม่มีโลโก้), OAuth client `Komoray web` (redirect ไป Supabase callback)
- **DNS** อยู่ที่ Cloudflare (โดเมนซื้อที่ Namecheap)
- **อีเมล** `hello@komoray.com` → Cloudflare Email Routing ส่งต่อเข้า kamkamsongto@gmail.com (30 ต.ค.) · ส่งออกผ่าน Gmail "Send mail as" (App password `Komoray mail`) · DNS: SPF `include:_spf.mx.cloudflare.net include:_spf.google.com`, DMARC `_dmarc` p=none · Gmail filter "Never send to Spam" สำหรับ komoray.com · ⚠️ เมลที่ส่งออกยังตกสแปม (ไม่มี DKIM ของ komoray.com) → จะย้ายไป Google Workspace

### กุญแจและความลับ
- ในเครื่อง: ไฟล์ `.dev.vars` (อยู่ใน `.gitignore` ไม่ขึ้น GitHub)
- ใน `.dev.vars` มี: R2, Deepgram, `RENDER_TOKEN`, `SUPABASE_DB_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- บนเว็บจริง: Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DEEPGRAM_API_KEY`, `RENDER_TOKEN` (ตั้งด้วย `npx wrangler secret`, wrangler login แล้ว)
- กุญแจ R2 ปัจจุบัน = token `komoray-upload-v2` (เปลี่ยน 29 ต.ค., ลบดอกเก่าแล้ว)
- ค่าที่ไม่ลับ (`R2_ACCOUNT_ID`, `R2_BUCKET`, `RENDER_URL`) อยู่ใน `wrangler.jsonc` → `vars` · Supabase URL + publishable key (สาธารณะ) อยู่ในโค้ด `src/lib/supabase/config.ts` เพื่อไม่ต้องตั้งค่าตอน build

### แผนที่ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `src/app/page.tsx` | หน้าแรก Coming soon + ลิงก์ Privacy · Terms |
| `src/app/upload/page.tsx` | ต้องล็อกอินก่อน · อัปโหลด → เลือกภาษา → Find silences → เสร็จแล้วพาไป `/edit` เอง · จำงานไว้ใน URL `?key=` |
| `src/app/edit/page.tsx` | **หน้าตัดต่อเต็มจอ** `/edit?key=…`: แถบบน (ความยาวเดิม→หลังตัด, Make video, ดาวน์โหลด, แจ้งเตือน) + ScriptView · บันทึกการแก้ลง edit.json ทันที (ซับรอ 0.6 วิหลังเลื่อนเสร็จ) · ยังไม่มีสคริปต์ → ส่งกลับ /upload |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | นโยบายความเป็นส่วนตัว / ข้อตกลง (ติดต่อ hello@komoray.com) · ใช้ `src/components/LegalPage.tsx` |
| `src/app/admin/page.tsx` + `src/app/api/admin/jobs/route.ts` | หน้า admin: ทุกคลิป + สถานะ (done/working/failed/stuck) + error · เข้าได้เฉพาะล็อกอินด้วย `ADMIN_EMAIL` (kamkamsongto@gmail.com) |
| `src/app/projects/page.tsx` | My projects: คลิปของตัวเอง เรียงใหม่→เก่า + อีกกี่วันถูกลบ · กดแล้วไป `/edit?key=…` |
| `src/app/auth/callback/route.ts` | Google ส่งกลับมาที่นี่หลังล็อกอิน → แลกเป็น session cookie |
| `src/components/Account.tsx` | `useUser`, ปุ่ม Sign in with Google, แถบบน (New video · My projects · Sign out) |
| `src/components/ScriptView.tsx` | ตัวตัดต่อ: ซ้าย = ข้อความ (ต่อชิ้นคำไทยด้วย `Intl.Segmenter`, ✂️ ช่วงเงียบ, ลากคลุมคำ → Delete/Restore, คลิกคำ → กระโดด, ไฮไลต์คำที่พูด) · ขวา = สลับ Preview / Original + แถบปรับซับ |
| `src/components/PreviewPlayer.tsx` | **ตัวอย่างคลิปจริงในเบราว์เซอร์**: 9:16 + ซับ Kanit + ลายน้ำ · ใช้ `<video>` 2 ตัวสลับกันที่จุดตัด (ตัวหนึ่งเล่น อีกตัวรอที่ชิ้นถัดไป) จึงไม่สะดุด · ลากซับขึ้นลงได้ |
| `src/lib/timeline.ts` | คิดไทม์ไลน์คลิปจริง + แบ่งบรรทัดซับ **ลอกกติกาจาก `render.py`** (แก้ที่หนึ่งต้องแก้อีกที่ ไม่งั้นตัวอย่างไม่ตรงคลิปจริง) |
| `src/lib/edit.ts` | คำที่ลบ → ช่วงตัด (`wordCuts`), รวมกับช่วงเงียบ (`allCuts`), รวมวินาทีที่ตัด |
| `src/lib/subtitle-style.ts` | ค่าซับ size / outline / position + ค่าตั้งต้น + ขอบเขต (ใช้ทั้งหน้าเว็บและเซิร์ฟเวอร์) |
| `src/app/api/edit/route.ts` | PUT: บันทึก `deleted` และ/หรือ `style` ลง edit.json |
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
| `modal_app/render.py` | งานตัดคลิปบน Modal (FFmpeg) · deploy: `python -m modal deploy modal_app/render.py` · ทดสอบ: `python -m modal run modal_app/render.py --job job.json` · endpoint: `https://kamkamsongto--komoray-render-start.us-east.modal.run` |

`edit.json` = `{ source, duration, rules, cuts: [{start, end, reason}], words: [{text, start, end}], deleted?: [ลำดับคำที่ลบ], style?: {size, outline, position} }`

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

---

## ⚠️ ติดอยู่ / เรื่องที่ต้องรู้

| เรื่อง | รายละเอียด | ต้องทำเมื่อไหร่ |
|---|---|---|
| 🖼️ Google consent screen | **ห้ามอัปโหลดโลโก้** ในหน้า Branding (ต้องรอ Google ตรวจหลายวัน) · หน้าเลือกบัญชีจะโชว์ `icjjeinussbapihdjiym.supabase.co` (แก้ได้ด้วย Supabase custom domain แบบเสียเงิน) | ภายหลัง |
| 📧 เมล hello@ ที่ส่งออกตกสแปม | แบบฟรีเซ็น DKIM เป็น gmail.com · แก้จริง = Google Workspace (~$7/เดือน) | **ก่อนส่งเมลชวน beta** |
| 🇹🇭 Deepgram ภาษาไทย | ตกตัวอักษรบางตัว (เช่น "จุดเด่คือ", "โค้") · ต่อชิ้นคำได้แล้ว แต่ตัวที่ตกต้องรอฟีเจอร์แก้ข้อความ | ทำพร้อมฟีเจอร์แก้คำ/คัมภีร์ |
| 🗂️ คลิปก่อนมี login | 10 คลิปทดสอบไม่มีเจ้าของในตาราง projects → เปิดจาก /upload ไม่ได้ ดูได้ใน admin · หมดอายุเองตามกฎ 14 วัน | ไม่ต้องทำอะไร |
| 💸 Deepgram opt out อาจแพงขึ้น | ยังไม่รู้ตัวเลขจริง · เช็กใน Deepgram Console → Usage หลังมีคลิปใหม่ | ครั้งถัดไปที่ทดสอบ |
| 🌐 ไม่มีปุ่มจากหน้าแรกไป /upload | มี login แล้ว (30 ต.ค.) · ยังตั้งใจส่งลิงก์ให้เฉพาะคน beta · R2 ลบไฟล์ใน `uploads/` เองหลัง 14 วัน | ใส่ปุ่มตอน soft launch |
| 🇹🇭 คลิปไทยเจอช่วงเงียบน้อย | มีช่วง 28.99–43.49 วิ (14.5 วิ) ในคลิปโค้ช รอโค้ชฟังว่าเงียบจริงไหม | รอคำตอบจากโค้ช |
| 🧹 ESLint พังมากับเทมเพลต | error "Converting circular structure to JSON" ไม่กระทบเว็บ | ทำเมื่อว่าง |
| 🖼️ Banner บน X | ใช้ภาพคนที่ AI สร้าง + ตัวเลขยอดไลก์ อาจทำให้เข้าใจผิดว่าเป็นลูกค้าจริง | แนะนำลบตัวเลข / เปลี่ยนเป็นภาพจริงภายหลัง |
| 📣 งานตลาด / launch / ติดต่อ creator | โค้ชสั่ง**ข้ามไปก่อน** (29 ต.ค.) · 0 โพสต์ · ยังไม่มี beta · soft launch จึงยังไม่เกิด | รอโค้ชตัดสินใจวันใหม่ |
| 💻 บทเรียน | เวลาทดสอบด้วย `next dev` เบื้องหลัง ต้องปิด process ให้หมด ไม่งั้น `npm run dev` ของโค้ชจะเปิดไม่ได้ · ทดสอบหน้าตาได้ด้วย Chrome headless + สคริปต์ CDP (ทำหน้า dev ชั่วคราวที่ไม่ต้อง login แล้วลบทิ้ง) | ทุกครั้งที่ทดสอบ |
| 🔤 ซับไทยไม่เว้นวรรคระหว่างไทยกับตัวเลข | เช่น "5นาที" ทั้งตัวอย่างและคลิปจริง (กติกาเดียวกัน) · แก้ต้อง deploy Modal ใหม่ด้วย | พร้อมงานฟอนต์วันที่ 17 |
| 🔁 คลิปที่หาช่วงเงียบแล้ว | ตอนนี้กด Find silences ใหม่จากหน้า /edit ไม่ได้ (หน้า upload ส่งไป /edit เลย) | ถ้าต้องการค่อยเพิ่มปุ่ม |
| 🏠 Find silences บน localhost | Deepgram ส่งผล callback มาที่เครื่องในบ้านไม่ได้ จะค้างที่ Listening · ทดสอบบน komoray.com หรือจำลอง callback ด้วยลายเซ็น HMAC | ทุกครั้งที่ทดสอบในเครื่อง |
| 📦 ขนาดไฟล์ 500 MB | คลิป 4K ของมืออาชีพเกินแน่นอน · โค้ชเลือก**ยังไม่ขยาย**ตอนนี้ · ของจริงควรจำกัดตามความยาวคลิป/แพ็กเกจ + อัปโหลดแบบแบ่งชิ้น (multipart) | หลังมี login |

---

## ⏭️ ขั้นต่อไป


**แผนคู่ขนาน (31 ต.ค., โค้ชตัดสิน):** ทำ 2 สายสลับกันครึ่งต่อครึ่ง · ชิ้นละ 1–3 ชม. ทดสอบได้ทันที · ลำดับ **A1 → B1 → A2 → B2 → A3 → B3 → A4 → B4 → A5 → A6 → A7** · เวลาเหลือค่อยเพิ่มทีละชิ้น

สาย A: **ตัวเล่นของเราเอง** (เหตุผล: บันทึกจาก iPad 31 ต.ค. พบ Safari สั่ง play ช้า 0.5–0.65 วิ, seek 1–1.6 วิ, เปลี่ยนความเร็วแล้วตกเฟรม → วิดีโอ 2 ตัวสลับกันไปได้แค่นี้บน Safari/Mac)
- A1 แก้บั๊กจุดตัดแรกค้าง 2.7 วิ (Safari รีเซ็ตตำแหน่งวิดีโอที่รอเป็น 0 ตอนโหลดไฟล์)
- A2 Modal ทำไฟล์เสียงเล็ก ๆ แยก (ต่อจาก proxy)
- A3 เสียง: Web Audio เล่นช่วงที่เก็บต่อกันไร้รอยต่อ (ทดสอบแค่เสียงบน iPad)
- A4 ภาพ: WebCodecs แกะเฟรมจาก proxy.mp4 วาดลง canvas
- A5 ภาพเดินตามนาฬิกาเสียง ข้ามช่วงตัด
- A6 ต่อเข้า /edit แบบลิงก์พิเศษ (Play/Pause, ลากแถบเวลา, คลิกคำแล้วกระโดด)
- A7 เป็นตัวหลัก เบราว์เซอร์ที่ไม่มี WebCodecs ใช้ตัวเดิม

สาย B: **งานขายได้**
- B1 คลิกคำแล้วพิมพ์แก้ (ซับตัวอย่าง + คลิปจริงเปลี่ยนตาม)
- B2 Replace all (เกด → เกตุ ทั้งคลิป)
- B3 คัมภีร์คำส่วนตัวใน Supabase (คลิปต่อไปแก้เอง)
- B4 เว้นวรรคไทย/ตัวเลขในซับ (`timeline.ts` + `render.py`)

**งานอื่น (เรียงตามลำดับ หลังแผนคู่ขนาน):**
1. **ทดสอบตัวอย่างบน iPhone** · ดู debug: เพิ่ม `&debug=1` ท้ายลิงก์ /edit → ป้ายแดง Recording → บันทึกเข้า `debug/` ใน R2
2. **วันที่ 15: ตรวจเทคซ้ำด้วย Claude API** (เก็บเทคสุดท้ายที่พูดจบ แสดงให้เห็น กดคืนได้)
3. วันที่ 17 ที่เหลือ: สไตล์ซับ 5 แบบ + เลือกฟอนต์ + อัปโหลดฟอนต์ + แก้ช่องว่างไทย/ตัวเลขในซับ (ทั้ง `timeline.ts` และ `render.py`)
4. วันที่ 18 ที่เหลือ: Brand Kit (ตั้งค่าซับครั้งเดียวใช้ทุกคลิป)
5. **Google Workspace** (~45 นาที, ก่อนส่งเมลหา creator): สมัคร Business Starter (yoshi@komoray.com, hello@/support@ เป็น alias) → ยืนยันโดเมน (TXT) → MX เป็นของ Google + ปิด Cloudflare Email Routing → DKIM (`google._domainkey`) → SPF เหลือ `include:_spf.google.com` → ลบ "Send mail as" + App password `Komoray mail` → ทดสอบส่งหาภรรยา
6. ทดสอบคลิปที่เหลือ 6 คลิป + คลิปแนวนอน + .mov จาก iPhone (โค้ช)
7. งานที่ข้ามไว้: soft launch / แบบฟอร์ม feedback / ชวน beta / งานตลาด (รอโค้ชบอก)

**งานตลาด (วันละ ~30 นาที, เร่งด่วน):**
1. โพสต์แรก build in public บน X (โค้ชเล่าเป็นภาษาไทย Claude เกลาเป็นอังกฤษ)
2. รายชื่อครีเอเตอร์ talking head มืออาชีพ 50 คน
3. DM ชวน beta 10 คน (คอมเมนต์คุยก่อนแล้วค่อย DM)
4. หน้า waitlist บน komoray.com

**ทำได้เมื่อว่าง:** ระดับความกระชับ Tight/Natural/Relaxed · ESLint

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
- **อีเมล** (30 ต.ค.): เริ่มฟรีด้วย Cloudflare Email Routing + Gmail Send mail as · ย้ายไป Google Workspace เมื่อมีลูกค้าจ่ายเงินหรือมีทีม
- **สูตรตัดหางคำ** (29 ต.ค.): แก้ที่สูตรของเรา ไม่ได้แก้ที่ Deepgram · ค่า 0.2 + 0.05×ตัวอักษร
- ไอเดียช่วงเงียบที่ตั้งใจเว้น (29 ต.ค.): ระดับความกระชับ Tight/Natural/Relaxed + ย่อช่วงเงียบแทนตัดทิ้ง + กดคืนจุดตัดใน Script view
- **คัมภีร์คำส่วนตัวที่โตเอง** (30 ต.ค.): จุดขายหลัก + ทำให้ลูกค้าไม่ย้ายไปเจ้าอื่น (Gling แก้คำผิดซ้ำ ๆ ไม่ได้ + ไทยเว้นวรรคมั่ว) · เก็บในฐานข้อมูลผูกกับบัญชี ไม่ผูกกับเบราว์เซอร์ เพื่อใช้ต่อในแอป PC/Mac ในอนาคต · ไม่เอาไปเทรน AI กลาง (เป็นของผู้ใช้คนนั้นเท่านั้น)
  - ร่างกติกาการเก็บคัมภีร์ (30 ต.ค., ยังไม่ทำ): ผูกกับ**บัญชี** ไม่ผูกกับการจ่ายเงิน → หยุดจ่ายแล้วคัมภีร์ยังอยู่ (ไฟล์เล็กมาก + เป็นเหตุผลให้กลับมา) · ลบเมื่อบัญชีไม่ได้ใช้เกิน 12 เดือน (เตือนทางอีเมลก่อน 30 วัน, ใช้กติกาเดียวกับบัญชี) · ผู้ใช้ export และลบเองได้ตลอด · ระบุในหน้า Privacy + แจ้งตอนเปิดใช้คัมภีร์ครั้งแรก
- **ตัวอย่างคลิปทำเอง ไม่ใช้ Remotion** (30 ต.ค.): Remotion ค้างที่จุดตัด · ถ้าอนาคตอยากให้ตัวอย่างกับคลิปจริงตรงกัน 100% ค่อยพิจารณา render ด้วยเทคโนโลยีเดียวกัน (หลังมี beta)
- **หน้าตัดต่อแบบซ้ายข้อความ-ขวาคลิป เป็นหน้าใหม่ `/edit` ไม่ใช่ pop up** (30 ต.ค., ไอเดียโค้ช) เพราะเบราว์เซอร์บล็อก pop up และใช้บนมือถือยาก
- **กลยุทธ์ต่อ Gling** (30 ต.ค.): เก็บสิ่งที่เขาทำดีให้ "พอดี" · ทุ่มเรื่องที่เราชนะได้จริง (ภาษาไทย, คัมภีร์คำ) · ไม่ไล่ตามทุกฟีเจอร์จนไม่ได้ launch · ให้ beta บอกว่าขาดอะไร
- **แชทใหม่ทุกวัน** (30 ต.ค.): แชทยาวเปลืองโควตาและถูกย่อจนรายละเอียดหาย → ปิดงานทุกวันให้ PROGRESS.md ครบ แล้ววันใหม่เริ่มแชทใหม่
- ก่อน Public launch: เพิ่มเจ้าถอดเสียงสำรองที่สลับอัตโนมัติถ้า Deepgram ล่ม (ยังไม่ยืนยันกับโค้ช) กันอีเมลขยะ · อีเมล (Resend) ใช้เฉพาะเรื่องสำคัญ: ฟีเจอร์ใหม่, ชวนอัปเกรด, waitlist, ต้อนรับ
