# Komoray: บันทึกความคืบหน้า

อัปเดตล่าสุด: **28 ต.ค. 2026** (เก็บงานของวันที่ 27 ต.ค.)
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
- **DNS** อยู่ที่ Cloudflare (โดเมนซื้อที่ Namecheap) · ห้ามลบ MX/TXT (ระบบส่งต่ออีเมลของ Namecheap)

### กุญแจและความลับ
- ในเครื่อง: ไฟล์ `.dev.vars` (อยู่ใน `.gitignore` ไม่ขึ้น GitHub)
- บนเว็บจริง: Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DEEPGRAM_API_KEY` (ตั้งด้วย `npx wrangler secret`, wrangler login แล้ว)
- ค่าที่ไม่ลับ (`R2_ACCOUNT_ID`, `R2_BUCKET`) อยู่ใน `wrangler.jsonc` → `vars`

### แผนที่ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `src/app/page.tsx` | หน้าแรก Coming soon |
| `src/app/upload/page.tsx` | หน้าอัปโหลด + แถบความคืบหน้า + ปุ่ม Find silences (ยังไม่ลิงก์จากหน้าแรก) |
| `src/app/api/upload-url/route.ts` | ออกลิงก์อัปโหลดชั่วคราว 10 นาที (mp4/mov ≤ 500 MB) |
| `src/app/api/analyze/route.ts` | ส่งลิงก์คลิปให้ Deepgram → หาช่วงเงียบ → บันทึก `edit.json` ข้างคลิปใน R2 |
| `src/lib/r2.ts` | ทำลิงก์ชั่วคราว + เขียนไฟล์ลง R2 |
| `src/lib/transcribe.ts` | **ไฟล์เดียวที่รู้จัก Deepgram** (เปลี่ยนเจ้าแก้ไฟล์นี้ไฟล์เดียว) |
| `src/lib/silences.ts` | กติกาช่วงเงียบ: ช่องว่าง > 0.4 วิ, เว้นระยะรอบคำ 0.1 วิ |
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

---

## ⚠️ ติดอยู่ / เรื่องที่ต้องรู้

| เรื่อง | รายละเอียด | ต้องทำเมื่อไหร่ |
|---|---|---|
| 🔐 กุญแจ R2 เคยหลุดในภาพหน้าจอ | โค้ชเลือกยังไม่เปลี่ยน (ความเสี่ยงต่ำ มีแค่คลิปทดสอบ) | **ก่อน soft launch 30 ต.ค.** |
| 🌐 หน้า `/upload` เปิดให้ทุกคนใช้ได้ | ยังไม่มี login (มาวันที่ 31 ต.ค.) · ยังไม่มีกฎลบคลิปเก่าอัตโนมัติใน R2 | ตั้งกฎลบอัตโนมัติก่อน soft launch |
| 🇹🇭 ข้อความภาษาไทยจาก Deepgram ตัวอักษรแตก | เช่น `สํา` แทน `สำ` (เวลาของคำยังใช้ได้) | แก้พร้อมหน้า Script view (1 พ.ย.) |
| 🇹🇭 คลิปไทยเจอช่วงเงียบน้อย | มีช่วง 28.99–43.49 วิ (14.5 วิ) ในคลิปโค้ช รอโค้ชฟังว่าเงียบจริงไหม | รอคำตอบจากโค้ช |
| 🧹 ESLint พังมากับเทมเพลต | error "Converting circular structure to JSON" ไม่กระทบเว็บ | ทำเมื่อว่าง |
| ✏️ Bio บน X | ต้องแก้ "We **turns**" เป็น "We **turn**" และใส่ Website `komoray.com` + Location `Thailand 🇹🇭` (ยังไม่ได้ยืนยันว่าแก้แล้ว) | ด่วน ก่อนโพสต์แรก |
| 🖼️ Banner บน X | ใช้ภาพคนที่ AI สร้าง + ตัวเลขยอดไลก์ อาจทำให้เข้าใจผิดว่าเป็นลูกค้าจริง | แนะนำลบตัวเลข / เปลี่ยนเป็นภาพจริงภายหลัง |
| 📣 งานตลาดยังไม่เริ่ม | 0 โพสต์ · ยังไม่มีรายชื่อครีเอเตอร์ · ยังไม่ได้ DM · ยังไม่มีหน้า waitlist | **ด่วน: ต้องมี beta 10–20 คนภายใน 30 ต.ค.** |
| 💻 บทเรียน | เวลาทดสอบด้วย `next dev` เบื้องหลัง ต้องปิด process ให้หมด ไม่งั้น `npm run dev` ของโค้ชจะเปิดไม่ได้ | ทุกครั้งที่ทดสอบ |

---

## ⏭️ ขั้นต่อไป


| วัน | งาน (ตามชีต) | เสร็จเมื่อ |
|---|---|---|
| **พ. 28/10** | หน้าสถานะงาน + ปุ่มดาวน์โหลด + อีเมลแจ้ง (Resend) | ได้อีเมลพร้อมลิงก์ดาวน์โหลดจริง |
| พฤ. 29/10 | ทดสอบ 10 คลิป แก้ทุกจุดที่พัง + เปลี่ยนกุญแจ R2 + กฎลบคลิปอัตโนมัติ | 10 คลิปผ่าน |
| **ศ. 30/10** | **Soft launch** ให้ beta 10–20 คน + แบบฟอร์ม feedback | มีคนนอกใช้จริง ≥ 5 คน |
| ส. 31/10 | Google login (Supabase) · ต้องสมัคร Supabase ก่อน | |

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
