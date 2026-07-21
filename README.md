# ระบบแจ้งซ่อม + บำรุงรักษาเชิงป้องกัน (Maintenance Management System)

เว็บแอประบบ **Breakdown Maintenance (BM)** และ **Preventive Maintenance (PM)** สำหรับไลน์ผลิตโรงงานอุตสาหกรรม

- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework / build tool) — deploy บน GitHub Pages
- **Backend:** Google Apps Script (GAS) Web App — ไฟล์เดียว `gas/Code.gs` เป็น REST API
- **Database:** Google Sheets (ไฟล์ `Record_Downtime` เดิม)
- **Photo Storage:** Google Drive (โฟลเดอร์ `Maintenance_Photos/YYYY-MM/`)
- **UI:** ภาษาไทย, Mobile-first, ฟอนต์ Noto Sans Thai

---

## โครงสร้างไฟล์

```
index.html        แจ้งซ่อม (BM Form) — หน้าหลักสำหรับหน้างาน
jobs.html         บอร์ดงานซ่อม (สำหรับช่าง)
pm.html           PM Due List + Checklist
dashboard.html    Dashboard (Manager) — Chart.js
admin.html        จัดการ CONFIG / PM_MASTER / USERS
login.html        เข้าสู่ระบบ (ชื่อ + PIN)
css/style.css
js/config.js      *** แก้ GAS_URL ที่นี่ที่เดียว ***
js/api.js         fetch wrapper + cache + retry
js/auth.js        login/session (sessionStorage)
js/utils.js       วันที่ไทย, shift detect, image compress, normalize
js/bm.js jobs.js pm.js dashboard.js admin.js
gas/Code.gs       Backend ทั้งหมด
```

---

## ขั้นตอน Deploy

### 1) ตั้งค่า Backend (Google Apps Script)

1. เปิด Spreadsheet **Record_Downtime** → เมนู **Extensions ▸ Apps Script**
2. สร้างไฟล์สคริปต์ วางเนื้อหาทั้งหมดจาก [`gas/Code.gs`](gas/Code.gs)
3. ตั้งค่า **Script Properties** (Project Settings ▸ Script Properties):
   - `SPREADSHEET_ID` = id ของไฟล์ Record_Downtime (ดูจาก URL: `/d/<ID>/edit`)
     *(ถ้าสคริปต์ผูกกับ Spreadsheet อยู่แล้ว จะข้ามได้)*
   - `FOLDER_ID` = id ของโฟลเดอร์ Drive ที่จะเก็บรูป (ไม่ใส่ก็ได้ ระบบจะสร้าง `Maintenance_Photos` ที่ My Drive)
4. รันฟังก์ชัน **`ensureSheets`** หนึ่งครั้ง (เลือกจาก dropdown แล้วกด Run) เพื่อสร้างชีท
   `PM_MASTER`, `PM_RECORDS`, `CONFIG`, `USERS` พร้อม seed ค่าเริ่มต้น
   - ครั้งแรกจะขอสิทธิ์ (Authorize) เข้าถึง Sheets + Drive — กดอนุญาต
5. (ทางเลือก) รัน **`setupDailyTrigger`** หนึ่งครั้ง เพื่อตั้ง trigger สแกน Overdue ทุกวัน 06:00
6. **Deploy ▸ New deployment ▸ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด Deploy แล้ว **คัดลอก Web app URL** (ลงท้าย `/exec`)

> ทุกครั้งที่แก้ `Code.gs` ต้องกด **Deploy ▸ Manage deployments ▸ (edit) ▸ New version** เพื่อให้ URL เดิมใช้โค้ดใหม่

### 2) ตั้งค่า Frontend

แก้ [`js/config.js`](js/config.js) ใส่ URL ที่ได้จากขั้นตอนที่แล้ว:

```js
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycb..../exec',
  ...
};
```

### 3) เปิด GitHub Pages

1. Push โค้ดขึ้น repo
2. **Settings ▸ Pages ▸ Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main** / folder: **/(root)** → Save
3. เปิดใช้งานที่ `https://<user>.github.io/<repo>/` (หน้าแรก = `index.html`)

---

## บัญชีทดสอบ (seed)

| Emp_ID | ชื่อ | Role | PIN |
|---|---|---|---|
| 0001 | ผู้ดูแลระบบ | Manager | 1234 |
| 0002 | ช่างสมชาย | Technician | 1111 |
| 0003 | หัวหน้ากะ | Supervisor | 2222 |

> การแจ้งซ่อม (`index.html`) ไม่บังคับ login — เพื่อความเร็วหน้างาน
> หน้า `admin.html` เปิดเฉพาะ Role **Supervisor / Manager**

---

## หมายเหตุทางเทคนิค

- **MT Job No.** รูปแบบ `DDMMYYYY-n` generate อัตโนมัติ (running number ต่อวัน) โดยใช้ `LockService` กันเลขซ้ำ
- ชีท **`Record แจ้งซ่อม `** มี **space ต่อท้ายชื่อ** — โค้ดจับชื่อแบบ trim ให้แล้ว
- **`Record ซ่อม`** ระบบเขียนเฉพาะคอลัมน์ข้อมูลดิบ (หา/สร้างคอลัมน์ตามชื่อหัวตาราง ต่อท้ายอัตโนมัติ) ไม่ยุ่งกับคอลัมน์สูตรเดิม
- แถวขยะ (วันที่ 1899 / `#REF!`) ถูกกรองด้วยการเช็ค MT Job No. ตาม pattern `\d{8}-\d+`
- **Downtime_Min:** ถ้าเครื่องหยุด = `Finish − เวลาแจ้ง`, ถ้าไม่หยุด = เวลาซ่อมจริงที่ช่างกรอก
- **Main_Issue** normalize สะกดเก่าหลายแบบ → 4 ค่า (`Mechanical/Electrical/Software/Camera&Vision`)
- รูปเก็บเป็น URL `https://drive.google.com/thumbnail?id=<id>&sz=w800` แสดงใน `<img>` ได้ตรงๆ
- CORS: frontend เรียกด้วย `Content-Type: text/plain` เพื่อเลี่ยง preflight

## การแก้ปัญหาที่พบบ่อย

- **"ยังไม่ได้ตั้งค่า GAS_URL"** → แก้ `js/config.js`
- **"เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"** → ยังไม่ได้ Deploy เป็น *New version* หลังแก้โค้ด หรือ access ไม่ได้ตั้งเป็น Anyone
- **ไม่พบชีท** → รัน `ensureSheets` และตรวจ `SPREADSHEET_ID`
- **อัปโหลดรูปไม่ได้** → ตรวจสิทธิ์ Drive ตอน Authorize และค่า `FOLDER_ID`
