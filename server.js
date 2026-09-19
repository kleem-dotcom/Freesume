require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const { resumeHTML } = require("./pdf-template");
const fs = require("fs");
const path = require("path");
const Razorpay = require("razorpay");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DATABASE_URL = process.env.DATABASE_URL;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  if (req.path === "/api/webhook" && req.method === "POST") return next();
  return express.json({ limit: "1mb" })(req, res, next);
});

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const ENTITLEMENT_SECRET = process.env.ENTITLEMENT_SECRET || KEY_SECRET || "dev-only-change-me";
const STORE_FILE = path.join(__dirname, "data", "payments.json");
const allowedTemplates = new Set(["editorial", "executive", "creative"]);
const prices = { editorial: 1000, executive: 1000, creative: 1000 };

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined, max: 5 }) : null;
let dbReady = false;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS resumes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL, payment_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, template TEXT NOT NULL,
      amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY, event TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS downloads (
      id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      template TEXT NOT NULL, downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id, downloaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_user_template ON payments(user_id, template, status);
  `);
  dbReady = true;
}

fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); }
  catch { return { users: {}, sessions: {}, resumes: {}, orders: {}, payments: {}, webhookEvents: {}, downloads: {} }; }
}
let store = loadStore();
function saveStore() {
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function randomId(prefix="id") { return `${prefix}_${crypto.randomBytes(18).toString("hex")}`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function verifyPassword(password, record) {
  try {
    const actual = crypto.scryptSync(password, record.salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(record.hash, "hex"));
  } catch { return false; }
}
function parseCookies(header="") {
  return Object.fromEntries(header.split(";").map(x=>x.trim().split("=")).filter(x=>x.length===2));
}
function sign(value) { return crypto.createHmac("sha256", ENTITLEMENT_SECRET).update(value).digest("base64url"); }
function entitlementCookie(template, paymentId) { const p=`${template}|${paymentId}`; return `${Buffer.from(p).toString("base64url")}.${sign(p)}`; }
function setEntitlement(res, template, paymentId) {
  res.setHeader("Set-Cookie", `freesume_entitlement=${entitlementCookie(template,paymentId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${IS_PRODUCTION?"; Secure":""}`);
}
function safeUser(u,id) { return { id, email:u.email, name:u.name, createdAt:u.createdAt }; }

async function getUserById(id) {
  if (!id) return null;
  if (pool && dbReady) {
    const r=await pool.query("SELECT id,email,name,created_at AS \"createdAt\",salt,password_hash AS hash FROM users WHERE id=$1",[id]);
    return r.rows[0] || null;
  }
  const u=store.users[id]; return u ? {...u, id} : null;
}
async function currentUser(req) {
  const sid=parseCookies(req.headers.cookie||"").freesume_session;
  if (!sid) return null;
  if (pool && dbReady) {
    const r=await pool.query("SELECT u.id,u.email,u.name,u.created_at AS \"createdAt\",u.salt,u.password_hash AS hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1",[sid]);
    const row=r.rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt).getTime()<=Date.now()) { await pool.query("DELETE FROM sessions WHERE id=$1",[sid]); return null; }
    return row;
  }
  const s=store.sessions[sid]; if(!s) return null;
  if(Date.parse(s.expiresAt)<=Date.now()){delete store.sessions[sid];saveStore();return null;}
  const u=store.users[s.userId]; return u ? {...u,id:s.userId} : null;
}
async function requireUser(req,res) { const u=await currentUser(req); if(!u){res.status(401).json({error:"Please sign in first."});return null;} return u; }
async function userHasTemplate(userId, template) {
  if (pool && dbReady) { const r=await pool.query("SELECT 1 FROM payments WHERE user_id=$1 AND template=$2 AND status='verified' LIMIT 1",[userId,template]); return !!r.rowCount; }
  return Object.values(store.payments).some(p=>p.userId===userId&&p.template===template&&p.status==="verified");
}
async function setSession(res,userId) {
  const sid=randomId("sess"), expiresAt=new Date(Date.now()+30*86400000);
  if(pool&&dbReady) await pool.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)",[sid,userId,expiresAt]);
  else {store.sessions[sid]={userId,expiresAt:expiresAt.toISOString()};saveStore();}
  res.setHeader("Set-Cookie",`${"freesume_session"}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30*86400}${IS_PRODUCTION?"; Secure":""}`);
}
async function clearSession(req,res){
  const sid=parseCookies(req.headers.cookie||"").freesume_session;
  if(pool&&dbReady) await pool.query("DELETE FROM sessions WHERE id=$1",[sid]);
  else if(sid){delete store.sessions[sid];saveStore();}
  res.setHeader("Set-Cookie",`freesume_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${IS_PRODUCTION?"; Secure":""}`);
}

if (!KEY_ID || !KEY_SECRET) console.warn("Razorpay keys are not configured.");
if (IS_PRODUCTION && !DATABASE_URL) console.warn("DATABASE_URL is missing: production will use ephemeral local JSON storage.");
if (IS_PRODUCTION && ENTITLEMENT_SECRET === "dev-only-change-me") console.warn("ENTITLEMENT_SECRET must be configured in production.");
const razorpay=KEY_ID&&KEY_SECRET?new Razorpay({key_id:KEY_ID,key_secret:KEY_SECRET}):null;

app.post("/api/auth/register",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase(), name=String(req.body.name||"").trim(), password=String(req.body.password||"");
    if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2||password.length<8)return res.status(400).json({error:"Use a valid email, name, and password of at least 8 characters."});
    const id=randomId("user"), hp=hashPassword(password), createdAt=new Date();
    if(pool&&dbReady){
      try{await pool.query("INSERT INTO users(id,email,name,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)",[id,email,name,hp.salt,hp.hash,createdAt]);await pool.query("INSERT INTO resumes(user_id,data) VALUES($1,$2)",[id,{}]);}
      catch(e){if(e.code==="23505")return res.status(409).json({error:"An account with that email already exists."});throw e;}
    } else {if(Object.values(store.users).some(u=>u.email===email))return res.status(409).json({error:"An account with that email already exists."});store.users[id]={email,name,salt:hp.salt,hash:hp.hash,createdAt:createdAt.toISOString()};store.resumes[id]={data:null,updatedAt:createdAt.toISOString()};saveStore();}
    await setSession(res,id);res.json({user:safeUser({email,name,createdAt},id)});
  }catch(e){console.error(e);res.status(500).json({error:"Could not create account."});}
});

app.post("/api/auth/login",async(req,res)=>{
  try{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");let u=null;
    if(pool&&dbReady){const r=await pool.query("SELECT id,email,name,salt,password_hash AS hash,created_at AS \"createdAt\" FROM users WHERE email=$1",[email]);u=r.rows[0];}
    else {const e=Object.entries(store.users).find(([,x])=>x.email===email);if(e)u={...e[1],id:e[0]};}
    if(!u||!verifyPassword(password,u))return res.status(401).json({error:"Email or password is incorrect."});await setSession(res,u.id);res.json({user:safeUser(u,u.id)});
  }catch(e){console.error(e);res.status(500).json({error:"Could not sign in."});}
});
app.post("/api/auth/logout",async(req,res)=>{await clearSession(req,res);res.json({ok:true});});
app.get("/api/me",async(req,res)=>{const u=await currentUser(req);res.json({user:u?safeUser(u,u.id):null});});

app.get("/api/resume",async(req,res)=>{const u=await requireUser(req,res);if(!u)return;if(pool&&dbReady){const r=await pool.query("SELECT data,updated_at AS \"updatedAt\" FROM resumes WHERE user_id=$1",[u.id]);return res.json({resume:r.rows[0]||{data:null}});}res.json({resume:store.resumes[u.id]||{data:null}});});
app.put("/api/resume",async(req,res)=>{const u=await requireUser(req,res);if(!u)return;const data=req.body||{},now=new Date();if(pool&&dbReady){await pool.query("INSERT INTO resumes(user_id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at",[u.id,data,now]);return res.json({ok:true,updatedAt:now.toISOString()});}store.resumes[u.id]={data,updatedAt:now.toISOString()};saveStore();res.json({ok:true,updatedAt:now.toISOString()});});
app.get("/api/premium-access",async(req,res)=>{const u=await currentUser(req),template=String(req.query.template||"");if(!u)return res.json({allowed:false,reason:"login_required"});res.json({allowed:allowedTemplates.has(template)&&await userHasTemplate(u.id,template)});});
app.get("/api/download-history",async(req,res)=>{const u=await requireUser(req,res);if(!u)return;if(pool&&dbReady){const r=await pool.query("SELECT template,downloaded_at AS at FROM downloads WHERE user_id=$1 ORDER BY downloaded_at DESC LIMIT 25",[u.id]);return res.json({downloads:r.rows});}res.json({downloads:(store.downloads&&store.downloads[u.id])||[]});});
app.get("/api/download-access",async(req,res)=>{const template=String(req.query.template||"essential");if(template==="essential")return res.json({allowed:true});const u=await requireUser(req,res);if(!u)return;if(!allowedTemplates.has(template)||!await userHasTemplate(u.id,template))return res.status(403).json({allowed:false,error:"Premium template not unlocked for this account."});res.json({allowed:true});});
app.get("/healthz",async(req,res)=>{try{if(pool&&dbReady)await pool.query("SELECT 1");res.json({ok:true,service:"freesume",database:pool?"postgres":"local"});}catch(e){res.status(503).json({ok:false,service:"freesume",database:"unhealthy"});}});

async function getResumeData(userId){
  if(pool&&dbReady){const r=await pool.query("SELECT data FROM resumes WHERE user_id=$1",[userId]);return r.rows[0]?.data||{};}
  return store.resumes[userId]?.data||{};
}

app.post("/api/download-pdf",async(req,res)=>{
  const template=String(req.body?.template||"essential");if(template!=="essential"&&!allowedTemplates.has(template))return res.status(400).json({error:"Invalid template."});
  const u=template==="essential"?await currentUser(req):await requireUser(req,res);if(template!=="essential"&&(!u||!await userHasTemplate(u.id,template)))return res.status(403).json({error:"Premium template not unlocked for this account."});
  const saved=u?await getResumeData(u.id):{};const resume={...saved,template};if(!u&&req.body?.data)Object.assign(resume,req.body.data);
  let browser;try{browser=await puppeteer.launch({headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]});const page=await browser.newPage();await page.setContent(resumeHTML(resume),{waitUntil:"networkidle0"});const pdf=await page.pdf({format:"A4",printBackground:true,preferCSSPageSize:true,margin:{top:"0mm",right:"0mm",bottom:"0mm",left:"0mm"}});
    if(u){if(pool&&dbReady)await pool.query("INSERT INTO downloads(user_id,template) VALUES($1,$2)",[u.id,template]);else{store.downloads=store.downloads||{};store.downloads[u.id]=store.downloads[u.id]||[];store.downloads[u.id].unshift({template,at:new Date().toISOString()});store.downloads[u.id]=store.downloads[u.id].slice(0,25);saveStore();}}
    res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="FREESUME-${template}.pdf"`);res.setHeader("Cache-Control","private, no-store");res.end(pdf);
  }catch(e){console.error("PDF generation failed",e);res.status(500).json({error:"PDF generation failed. Please try again."});}finally{if(browser)await browser.close().catch(()=>{});}
});

app.post("/api/webhook",express.raw({type:"application/json"}),async(req,res)=>{
  if(!WEBHOOK_SECRET)return res.status(503).send("Webhook secret not configured.");const signature=req.headers["x-razorpay-signature"];if(!signature)return res.status(400).send("Missing webhook signature.");const expected=crypto.createHmac("sha256",WEBHOOK_SECRET).update(req.body).digest("hex");if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(400).send("Invalid webhook signature.");
  try{const event=JSON.parse(req.body.toString("utf8"));const eventId=req.headers["x-razorpay-event-id"]||crypto.createHash("sha256").update(req.body).digest("hex");if(pool&&dbReady){const ins=await pool.query("INSERT INTO webhook_events(event_id,event) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING",[eventId,event.event]);if(!ins.rowCount)return res.json({received:true,duplicate:true});}else{if(store.webhookEvents[eventId])return res.json({received:true,duplicate:true});store.webhookEvents[eventId]={event:event.event,receivedAt:new Date().toISOString()};saveStore();}console.log("Razorpay webhook:",event.event);return res.json({received:true});}catch(e){console.error(e);return res.status(400).send("Invalid webhook payload.");}
});

app.use(express.static(__dirname));

app.post("/api/create-order",async(req,res)=>{try{const user=await requireUser(req,res);if(!user)return;const template=String(req.body.template||"");if(!allowedTemplates.has(template))return res.status(400).json({error:"Invalid premium template."});if(!razorpay)return res.status(503).json({error:"Razorpay is not configured on the server."});const amount=prices[template],receipt=`fs_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;const order=await razorpay.orders.create({amount,currency:"INR",receipt,notes:{product:"FREESUME premium template",template,userId:user.id}});if(pool&&dbReady)await pool.query("INSERT INTO orders(id,user_id,template,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6)",[order.id,user.id,template,amount,"INR","created"]);else{store.orders[order.id]={userId:user.id,template,amount,currency:"INR",status:"created",createdAt:new Date().toISOString()};saveStore();}res.json({keyId:KEY_ID,orderId:order.id,amount:order.amount,currency:order.currency});}catch(e){console.error(e);res.status(500).json({error:"Could not create payment order."});}});

app.post("/api/verify-payment",async(req,res)=>{try{const {razorpay_order_id:orderId,razorpay_payment_id:paymentId,razorpay_signature:signature,template}=req.body;if(!orderId||!paymentId||!signature||!allowedTemplates.has(template))return res.status(400).json({verified:false,error:"Missing or invalid payment data."});const user=await requireUser(req,res);if(!user)return;let order;if(pool&&dbReady){const r=await pool.query("SELECT * FROM orders WHERE id=$1",[orderId]);order=r.rows[0];}else order=store.orders[orderId];if(!order||order.user_id&&order.user_id!==user.id||order.userId&&order.userId!==user.id||order.template!==template||order.status!=="created")return res.status(400).json({verified:false,error:"Order could not be matched to this template."});const expected=crypto.createHmac("sha256",KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return res.status(400).json({verified:false,error:"Payment signature could not be verified."});const verifiedAt=new Date();
    if(pool&&dbReady){const client=await pool.connect();try{await client.query("BEGIN");const up=await client.query("UPDATE orders SET status='verified',payment_id=$1,verified_at=$2 WHERE id=$3 AND status='created' RETURNING id",[paymentId,verifiedAt,orderId]);if(!up.rowCount){await client.query("ROLLBACK");return res.json({verified:true,template});}await client.query("INSERT INTO payments(payment_id,order_id,user_id,template,amount,currency,status,verified_at) VALUES($1,$2,$3,$4,$5,$6,'verified',$7) ON CONFLICT(payment_id) DO NOTHING",[paymentId,orderId,user.id,template,order.amount,order.currency,verifiedAt]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
    else{order.status="verified";order.paymentId=paymentId;order.verifiedAt=verifiedAt.toISOString();store.payments[paymentId]={orderId,userId:user.id,template,amount:order.amount,currency:order.currency,status:"verified",verifiedAt:order.verifiedAt};saveStore();}
    setEntitlement(res,template,paymentId);res.json({verified:true,template});
  }catch(e){console.error(e);res.status(500).json({verified:false,error:"Payment verification failed."});}});

app.get("/api/entitlement",async(req,res)=>{const c=parseCookies(req.headers.cookie||"").freesume_entitlement;if(!c)return res.json({authenticated:false,template:null});const [b,s]=c.split(".");if(!b||!s)return res.json({authenticated:false,template:null});let p;try{p=Buffer.from(b,"base64url").toString("utf8");}catch{return res.json({authenticated:false,template:null});}const exp=sign(p);if(s.length!==exp.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(exp)))return res.json({authenticated:false,template:null});const [template,paymentId]=p.split("|");if(!allowedTemplates.has(template)||!paymentId)return res.json({authenticated:false,template:null});let valid=false;if(pool&&dbReady){const r=await pool.query("SELECT 1 FROM payments WHERE payment_id=$1 AND template=$2 AND status='verified' LIMIT 1",[paymentId,template]);valid=!!r.rowCount;}else valid=!!store.payments[paymentId]&&store.payments[paymentId].template===template&&store.payments[paymentId].status==="verified";res.json({authenticated:valid,template:valid?template:null});});

initDb().then(()=>app.listen(PORT,HOST,()=>console.log(`FREESUME. running at http://${HOST}:${PORT} | DB: ${pool?"PostgreSQL":"local JSON"}`))).catch(err=>{console.error("Database initialization failed",err);process.exit(1);});
