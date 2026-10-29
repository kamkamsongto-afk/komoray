# Komoray: บันทึกความคืบหน้า

อัปเดตล่าสุด: **30 ต.ค. 2026** (ปิดงานของวันที่ 29 ต.ค. ทำต่อจนเลยเที่ยงคืน)
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
- **Supabase** (โปรเจกต์ `komoray`, region Americas, Free) สำหรับ login · เปิด Google provider แล้ว · URL `https://icjjeinussbapihdjiym.supabase.co`
- **Google Cloud** โปรเจกต์ `komoray` → Google Auth Platform: แอป Komoray (External, ยัง **Testing**), OAuth client `Komoray web` (redirect ไป Supabase callback)
- **DNS** อยู่ที่ Cloudflare (โดเมนซื้อที่ Namecheap)
- **อีเมล** `hello@komoray.com` → Cloudflare Email Routing ส่งต่อเข้า kamkamsongto@gmail.com (30 ต.ค.) · ลบ MX/TXT eforward ของ Namecheap แล้ว · Gmail มี filter "Never send to Spam" สำหรับ komoray.com

### กุญแจและความลับ
- ในเครื่อง: ไฟล์ `.dev.vars` (อยู่ใน `.gitignore` ไม่ขึ้น GitHub)
- ใน `.dev.vars` มี: R2, Deepgram, `RENDER_TOKEN`, `ADMIN_PASSWORD`, `SUPABASE_DB_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- บนเว็บจริง: Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DEEPGRAM_API_KEY`, `RENDER_TOKEN`, `ADMIN_PASSWORD` (ตั้งด้วย `npx wrangler secret`, wrangler login แล้ว)
- กุญแจ R2 ปัจจุบัน = token `komoray-upload-v2` (เปลี่ยน 29 ต.ค., ลบดอกเก่าแล้ว)
- ค่าที่ไม่ลับ (`R2_ACCOUNT_ID`, `R2_BUCKET`) อยู่ใน `wrangler.jsonc` → `vars`

### แผนที่ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `src/app/page.tsx` | หน้าแรก Coming soon + ลิงก์ Privacy · Terms |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | นโยบายความเป็นส่วนตัว / ข้อตกลง (ติดต่อ hello@komoray.com) · ใช้ `src/components/LegalPage.tsx` |
| `src/app/admin/page.tsx` + `src/app/api/admin/jobs/route.ts` | หน้า admin: ทุกคลิป + สถานะ (done/working/failed/stuck) + error · ใช้รหัส `ADMIN_PASSWORD` (ชั่วคราว จนกว่าจะมี login) |
| `src/app/api/report/route.ts` | หน้าเว็บส่ง error ฝั่งเบราว์เซอร์มาเก็บที่ `logs/` ใน R2 (ลบเองหลัง 90 วัน) |
| `src/app/upload/page.tsx` | หน้าอัปโหลด: ลากวางไฟล์ + แถบความคืบหน้า → Find silences → Make video → ดู/ดาวน์โหลด + แจ้งเตือนบนจอ (ยังไม่ลิงก์จากหน้าแรก) |
| `src/app/api/upload-url/route.ts` | ออกลิงก์อัปโหลดชั่วคราว 10 นาที (mp4/mov ≤ 500 MB) |
| `src/app/api/analyze/route.ts` | POST: ส่งงานให้ Deepgram แบบ callback (ไม่รอ) · GET: ถามสถานะ (`analyze.json` → `edit.json` / `analyze-error.json`) |
| `src/app/api/analyze/callback/route.ts` | Deepgram ส่งผลมาที่นี่ (ตรวจลายเซ็น HMAC ด้วย `RENDER_TOKEN`) → หาช่วงเงียบ → บันทึก `edit.json` |
| `src/app/api/render/route.ts` | POST: สั่ง Modal ตัดคลิป · GET: ถามสถานะ (`render.json` → `final.mp4` / `render-error.json`) + ลิงก์ดู/ดาวน์โหลด 1 ชม. |
| `src/lib/r2.ts` | ทำลิงก์ชั่วคราว + อ่าน/เขียน/ลบไฟล์ใน R2 + `VIDEO_KEY`, `siblingKey` |
| `src/lib/callback.ts` | ลายเซ็นลับของลิงก์ callback |
| `src/lib/transcribe.ts` | **ไฟล์เดียวที่รู้จัก Deepgram** (เปลี่ยนเจ้าแก้ไฟล์นี้ไฟล์เดียว) |
| `src/lib/silences.ts` | กติกาช่วงเงียบ: ช่องว่าง > 0.4 วิ, เว้นระยะรอบคำ 0.1 วิ · `trimStretchedWords`: คำยาวได้ไม่เกิน 0.2 + 0.05×ตัวอักษร วิ (Deepgram ชอบลากหางคำท้ายประโยค) |
| `modal_app/render.py` | งานตัดคลิปบน Modal (FFmpeg) · deploy: `python -m modal deploy modal_app/render.py` · ทดสอบ: `python -m modal run modal_app/render.py --job job.json` · endpoint: `https://kamkamsongto--komoray-render-start.us-east.modal.run` |

`edit.json` = `{ source, duration, rules, cuts: [{start, end, reason}], words: [{text, start, end}] }`

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

---

## ⚠️ ติดอยู่ / เรื่องที่ต้องรู้

| เรื่อง | รายละเอียด | ต้องทำเมื่อไหร่ |
|---|---|---|
| 🔑 Google login ยังเป็นโหมด Testing | ล็อกอินได้เฉพาะ test users (ใส่ kamkamsongto@gmail.com แล้วหรือยัง ต้องถามโค้ช) · Publish ต้องกรอกหน้า Branding (home/privacy/terms, authorized domains `komoray.com` + `icjjeinussbapihdjiym.supabase.co`) · **ห้ามอัปโหลดโลโก้** (จะต้องรอ Google ตรวจหลายวัน) | ก่อนเปิดให้ beta ล็อกอิน |
| 🔒 หน้า admin ใช้รหัสผ่าน | ชั่วคราว · หลังมี login ให้เปิดได้เฉพาะ kamkamsongto@gmail.com แล้วเลิกใช้ `ADMIN_PASSWORD` | ตอนทำ login |
| 💸 Deepgram opt out อาจแพงขึ้น | ยังไม่รู้ตัวเลขจริง · เช็กใน Deepgram Console → Usage หลังมีคลิปใหม่ | ครั้งถัดไปที่ทดสอบ |
| 🌐 หน้า `/upload` เปิดให้ทุกคนใช้ได้ | ยังไม่มี login (มาวันที่ 31 ต.ค.) · **ไม่ใส่ปุ่มจากหน้าแรก** ส่งลิงก์ให้เฉพาะคน beta (ตัดสินใจ 29 ต.ค.) · R2 ลบไฟล์ใน `uploads/` อัตโนมัติหลัง 14 วันแล้ว (กฎ `beta-expire-14d`) | ใส่ปุ่มหลังมี login |
| 🇹🇭 ข้อความภาษาไทยจาก Deepgram ตัวอักษรแตก | เช่น `สํา` แทน `สำ` (เวลาของคำยังใช้ได้) | แก้พร้อมหน้า Script view (1 พ.ย.) |
| 🇹🇭 คลิปไทยเจอช่วงเงียบน้อย | มีช่วง 28.99–43.49 วิ (14.5 วิ) ในคลิปโค้ช รอโค้ชฟังว่าเงียบจริงไหม | รอคำตอบจากโค้ช |
| 🧹 ESLint พังมากับเทมเพลต | error "Converting circular structure to JSON" ไม่กระทบเว็บ | ทำเมื่อว่าง |
| 🖼️ Banner บน X | ใช้ภาพคนที่ AI สร้าง + ตัวเลขยอดไลก์ อาจทำให้เข้าใจผิดว่าเป็นลูกค้าจริง | แนะนำลบตัวเลข / เปลี่ยนเป็นภาพจริงภายหลัง |
| 📣 งานตลาด / launch / ติดต่อ creator | โค้ชสั่ง**ข้ามไปก่อน** (29 ต.ค.) · 0 โพสต์ · ยังไม่มี beta · soft launch จึงยังไม่เกิด | รอโค้ชตัดสินใจวันใหม่ |
| 💻 บทเรียน | เวลาทดสอบด้วย `next dev` เบื้องหลัง ต้องปิด process ให้หมด ไม่งั้น `npm run dev` ของโค้ชจะเปิดไม่ได้ | ทุกครั้งที่ทดสอบ |
| 🏠 Find silences บน localhost | Deepgram ส่งผล callback มาที่เครื่องในบ้านไม่ได้ จะค้างที่ Listening · ทดสอบบน komoray.com หรือจำลอง callback ด้วยลายเซ็น HMAC | ทุกครั้งที่ทดสอบในเครื่อง |
| 📦 ขนาดไฟล์ 500 MB | คลิป 4K ของมืออาชีพเกินแน่นอน · โค้ชเลือก**ยังไม่ขยาย**ตอนนี้ · ของจริงควรจำกัดตามความยาวคลิป/แพ็กเกจ + อัปโหลดแบบแบ่งชิ้น (multipart) | หลังมี login |

---

## ⏭️ ขั้นต่อไป


**งานถัดไป (เรียงตามลำดับ):**
1. **อีเมลส่งออก:** ตั้ง Gmail "Send mail as" hello@komoray.com (ต้องเปิด 2-Step + App password) + เพิ่ม SPF ของ Google · เปลี่ยนอีเมลในหน้า Google **Branding** เป็น hello@komoray.com
2. **Google Branding → Publish app** (หน้า privacy/terms ขึ้นเว็บแล้ว)
3. **โค้ดปุ่ม Sign in with Google** + ผูกคลิปกับ user + หน้า My Projects + ทดสอบ 2 บัญชีมองไม่เห็นงานกัน (วันที่ 11 ในชีต) · หน้า admin เปลี่ยนเป็นเช็กอีเมลแทนรหัส
4. ทดสอบคลิปที่เหลือ 6 คลิป + คลิปแนวนอน + .mov จาก iPhone (โค้ช)
5. งานที่ข้ามไว้: soft launch / แบบฟอร์ม feedback / ชวน beta (รอโค้ชบอกว่าจะกลับมาทำเมื่อไหร่)

**งานตลาด (วันละ ~30 นาที, เร่งด่วน):**
1. โพสต์แรก build in public บน X (โค้ชเล่าเป็นภาษาไทย Claude เกลาเป็นอังกฤษ)
2. รายชื่อครีเอเตอร์ talking head มืออาชีพ 50 คน
3. DM ชวน beta 10 คน (คอมเมนต์คุยก่อนแล้วค่อย DM)
4. หน้า waitlist บน komoray.com

**ทำได้เมื่อว่าง:** ตัวเล่นตัวอย่างที่ข้ามช่วงเงียบ (ช่วยเช็กจุดตัด)

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
- ก่อน Public launch: เพิ่มเจ้าถอดเสียงสำรองที่สลับอัตโนมัติถ้า Deepgram ล่ม (ยังไม่ยืนยันกับโค้ช) กันอีเมลขยะ · อีเมล (Resend) ใช้เฉพาะเรื่องสำคัญ: ฟีเจอร์ใหม่, ชวนอัปเกรด, waitlist, ต้อนรับ
