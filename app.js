import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// اتصال به Postgres (Railway مقدار DATABASE_URL می‌دهد)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// کلید ساده برای امن‌کردن API نوشتنی
const API_KEY = process.env.API_KEY || "SuperSecret123";

// اگر جدول‌ها نبودند، بساز
await pool.query(`
CREATE TABLE IF NOT EXISTS readings(
  id bigserial primary key,
  device text,
  ts timestamptz default now(),
  temp real, hum real, soil_pct int, ldr_pct int, pump int, fan int
);
CREATE TABLE IF NOT EXISTS commands(
  device text primary key,
  updated timestamptz default now(),
  manualpump int default -1,
  manualfans int default -1
);
`);

// دریافت داده از ESP32 (POST)
app.post("/api/ingest", async (req,res)=>{
  if (req.get("x-api-key") !== API_KEY) return res.status(401).json({error:"bad key"});
  const d = req.body || {};
  await pool.query(
    "INSERT INTO readings(device,temp,hum,soil_pct,ldr_pct,pump,fan) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [d.device||"esp32", d.temp, d.hum, d.soil_pct, d.ldr_pct, d.pump, d.fan]
  );
  res.json({ok:true});
});

// تاریخچه‌ی داده برای نمودار/گزارش
app.get("/api/history", async (req,res)=>{
  const { device="esp32", limit=200 } = req.query;
  const q = await pool.query(
    "SELECT ts,temp,hum,soil_pct,ldr_pct,pump,fan FROM readings WHERE device=$1 ORDER BY ts DESC LIMIT $2",
    [device, limit]
  );
  res.json(q.rows.reverse());
});

// تنظیم فرمان‌ها از داشبورد (POST)
app.post("/api/cmd", async (req,res)=>{
  if (req.get("x-api-key") !== API_KEY) return res.status(401).json({error:"bad key"});
  const { device="esp32", manualPump=-1, manualFans=-1 } = req.body;
  await pool.query(
    `INSERT INTO commands(device,manualpump,manualfans,updated)
     VALUES($1,$2,$3,now())
     ON CONFLICT (device) DO UPDATE SET manualpump=EXCLUDED.manualpump, manualfans=EXCLUDED.manualfans, updated=now()`,
    [device, manualPump, manualFans]
  );
  res.json({ok:true});
});

// گرفتن آخرین فرمان‌ها توسط ESP32 (GET)
app.get("/api/cmd", async (req,res)=>{
  const { device="esp32" } = req.query;
  const q = await pool.query("SELECT manualpump, manualfans FROM commands WHERE device=$1", [device]);
  res.json(q.rows[0] || { manualpump:-1, manualfans:-1 });
});

// یک داشبورد خیلی ساده برای تست
app.get("/", (req,res)=> res.send(`
<!doctype html><meta charset="utf-8">
<title>Greenhouse</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css">
<div class="container py-4">
  <h3 class="mb-3">داشبورد (نسخه‌ی سادهٔ سرور)</h3>
  <div class="mb-2">
    <button class="btn btn-success me-2" onclick="setCmd(1,-1)">Pump ON</button>
    <button class="btn btn-danger  me-2" onclick="setCmd(0,-1)">Pump OFF</button>
    <button class="btn btn-secondary me-4" onclick="setCmd(-1,-1)">Pump AUTO</button>
    <button class="btn btn-success me-2" onclick="setCmd(-1,1)">Fans ON</button>
    <button class="btn btn-danger  me-2" onclick="setCmd(-1,0)">Fans OFF</button>
    <button class="btn btn-secondary" onclick="setCmd(-1,-1)">Fans AUTO</button>
  </div>
  <pre id="out" class="bg-light p-3 rounded border" style="max-height:50vh; overflow:auto"></pre>
</div>
<script>
const KEY = "${process.env.API_KEY||"SuperSecret123"}";
async function setCmd(p,f){
  await fetch('/api/cmd',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':KEY},
    body:JSON.stringify({device:'esp32',manualPump:p,manualFans:f})});
}
async function refresh(){
  const r = await fetch('/api/history?limit=50');
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
}
setInterval(refresh, 2000); refresh();
</script>
`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("listening on", PORT));
