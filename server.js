/* YOUWIN shared server — one clock, one admin, every player. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT) || 8080;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "youwin2026";

const MODES = {
  "30s": { id: "30s", name: "WinGo 30 sec", short: "WIN GO 30 SEC", ms: 30000 },
  "1m": { id: "1m", name: "WinGo 1 Min", short: "WIN GO 1 MIN", ms: 60000 },
  "3m": { id: "3m", name: "WinGo 3 Min", short: "WIN GO 3 MIN", ms: 180000 },
  "5m": { id: "5m", name: "WinGo 5 Min", short: "WIN GO 5 MIN", ms: 300000 }
};

const NUMBER_COLORS = {
  0: ["violet"],
  1: ["green"],
  2: ["red"],
  3: ["green"],
  4: ["red", "violet"],
  5: ["violet"],
  6: ["red"],
  7: ["green"],
  8: ["red"],
  9: ["green", "violet"]
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
};

function emptyStore() {
  return {
    users: {},
    sessions: {},
    adminSessions: {},
    results: { "30s": [], "1m": [], "3m": [], "5m": [] },
    overrides: {},
    force: null,
    openBets: [],
    history: [],
    ledger: [],
    deposits: [],
    utrCodes: [],
    withdrawals: []
  };
}

let store = emptyStore();
const lastPeriod = {};
const sseClients = new Set();
let saveTimer = null;

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store = Object.assign(emptyStore(), parsed);
    store.users = store.users || {};
    store.sessions = store.sessions || {};
    store.adminSessions = store.adminSessions || {};
    store.results = Object.assign({ "30s": [], "1m": [], "3m": [], "5m": [] }, store.results || {});
    store.openBets = store.openBets || [];
    store.history = store.history || [];
    store.ledger = store.ledger || [];
    store.deposits = store.deposits || [];
    store.utrCodes = store.utrCodes || [];
    store.withdrawals = store.withdrawals || [];
    store.overrides = store.overrides || {};
  } catch (e) {
    store = emptyStore();
  }
}

function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store));
    } catch (e) {}
  }, 200);
}

function pad(n, w) {
  return String(n).padStart(w, "0");
}

function periodCode(mode, periodId) {
  const d = new Date(periodId * MODES[mode].ms);
  const stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2);
  return stamp + pad(periodId % 100000, 5);
}

function clock(mode, now) {
  const ms = MODES[mode].ms;
  const t = now == null ? Date.now() : now;
  const periodId = Math.floor(t / ms);
  const remaining = Math.max(0, periodId * ms + ms - t);
  return {
    mode,
    periodId,
    period: periodCode(mode, periodId),
    nextPeriodId: periodId + 1,
    nextPeriod: periodCode(mode, periodId + 1),
    remaining,
    lockMs: 5000,
    locked: remaining <= 5000
  };
}

function colorsOf(n) {
  return (NUMBER_COLORS[n] || ["green"]).slice();
}

function colorLabel(n) {
  return colorsOf(n).map((x) => x[0].toUpperCase() + x.slice(1)).join(" + ");
}

function sizeOf(n) {
  return n >= 5 ? "Big" : "Small";
}

function randomNumber() {
  return Math.floor(Math.random() * 10);
}

function payoutRate(pick) {
  const p = String(pick);
  if (p === "Green" || p === "Red" || p === "Big" || p === "Small") return 1.98;
  if (p === "Violet") return 5;
  if (/^\d$/.test(p)) return 8;
  return 1.98;
}

function pickHits(pick, number) {
  const n = Number(number);
  const colors = colorsOf(n);
  const p = String(pick);
  if (p === "Green") return colors.includes("green");
  if (p === "Red") return colors.includes("red");
  if (p === "Violet") return colors.includes("violet");
  if (p === "Big") return n >= 5;
  if (p === "Small") return n < 5;
  if (/^\d$/.test(p)) return Number(p) === n;
  return false;
}

function validPick(pick) {
  const p = String(pick);
  return p === "Green" || p === "Red" || p === "Violet" || p === "Big" || p === "Small" || /^\d$/.test(p);
}

function nid() {
  return Date.now() + "-" + crypto.randomBytes(4).toString("hex");
}

function hashPass(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), s, 32).toString("hex");
  return { salt: s, hash };
}

function checkPass(password, salt, hash) {
  try {
    return crypto.scryptSync(String(password), salt, 32).toString("hex") === hash;
  } catch (e) {
    return false;
  }
}

function publicUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    identity: u.identity,
    name: u.name,
    wallet: Number(u.wallet) || 0,
    banned: !!u.banned,
    lastLogin: u.lastLogin || "",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

function findUser(uid) {
  if (uid == null || uid === "") return null;
  return store.users[String(uid)] || null;
}

function findUserByIdentity(identity) {
  const id = String(identity || "").trim().toLowerCase();
  if (!id) return null;
  return Object.keys(store.users).map((k) => store.users[k]).find((u) => String(u.identity || "").toLowerCase() === id) || null;
}

function newUid() {
  let uid;
  do {
    uid = String(100000 + Math.floor(Math.random() * 900000));
  } while (store.users[uid]);
  return uid;
}

function token() {
  return crypto.randomBytes(24).toString("hex");
}

function getResults(mode) {
  return (store.results[mode] || []).slice();
}

function consumeOverride(mode, periodId) {
  const item = store.overrides[mode];
  if (!item) return null;
  if (item.periodId != null && Number(item.periodId) > Number(periodId)) return null;
  delete store.overrides[mode];
  return item;
}

function settle(mode, periodId, forcedNumber) {
  const list = store.results[mode] || [];
  const existing = list.find((r) => r.periodId === periodId);
  if (existing) return existing;
  const override = consumeOverride(mode, periodId);
  const number =
    forcedNumber != null ? Number(forcedNumber) : override ? Number(override.number) : randomNumber();
  const record = {
    mode,
    periodId,
    period: periodCode(mode, periodId),
    number,
    colors: colorsOf(number),
    size: sizeOf(number),
    source: override || forcedNumber != null ? "admin" : "auto",
    at: Date.now()
  };
  list.unshift(record);
  store.results[mode] = list.slice(0, 80);

  const keep = [];
  store.openBets.forEach((bet) => {
    if (bet.mode !== mode || Number(bet.periodId) !== Number(periodId)) {
      keep.push(bet);
      return;
    }
    const hit = pickHits(bet.pick, number);
    const pay = hit ? Number(bet.amount) * payoutRate(bet.pick) : 0;
    if (hit && pay > 0) {
      const user = findUser(bet.uid);
      if (user) {
        user.wallet = Number(user.wallet || 0) + pay;
        user.updatedAt = Date.now();
      }
    }
    store.history.unshift({
      ...bet,
      resultNumber: number,
      resultColors: record.colors,
      hit,
      payout: pay,
      settledAt: Date.now()
    });
  });
  store.openBets = keep;
  store.history = store.history.slice(0, 400);
  saveStore();
  return record;
}

function ensureHistory(mode, count) {
  const list = store.results[mode] || [];
  if (list.length >= count) return;
  const clk = clock(mode);
  let pid = clk.periodId - 1;
  while ((store.results[mode] || []).length < count && pid > 0) {
    if (!(store.results[mode] || []).some((r) => r.periodId === pid)) {
      settle(mode, pid);
    }
    pid -= 1;
  }
}

function periodBets(mode, periodId) {
  const pid = Number(periodId);
  const merged = [];
  const seen = {};
  function add(b) {
    if (!b || b.mode !== mode || Number(b.periodId) !== pid) return;
    const id = String(b.id);
    if (seen[id]) return;
    seen[id] = true;
    merged.push(b);
  }
  (store.ledger || []).forEach(add);
  (store.openBets || []).forEach(add);
  return merged;
}

function analyzeExposure(mode, periodId) {
  const bets = periodBets(mode, periodId);
  const spend = { Green: 0, Red: 0, Violet: 0, Big: 0, Small: 0 };
  for (let i = 0; i < 10; i++) spend[String(i)] = 0;
  let total = 0;
  const uids = {};
  bets.forEach((b) => {
    const amt = Number(b.amount) || 0;
    total += amt;
    const p = String(b.pick);
    if (spend[p] != null) spend[p] += amt;
    if (b.uid) uids[b.uid] = true;
  });
  const outcomes = [];
  for (let n = 0; n <= 9; n++) {
    let payout = 0;
    bets.forEach((b) => {
      if (pickHits(b.pick, n)) payout += (Number(b.amount) || 0) * payoutRate(b.pick);
    });
    outcomes.push({ number: n, colors: colorsOf(n), size: sizeOf(n), payout, profit: total - payout });
  }
  outcomes.sort((a, b) => a.payout - b.payout || b.profit - a.profit);
  const colorHot =
    spend.Green === 0 && spend.Red === 0 && spend.Violet === 0
      ? null
      : spend.Green >= spend.Red && spend.Green >= spend.Violet
        ? "Green"
        : spend.Red >= spend.Violet
          ? "Red"
          : "Violet";
  const sizeHot = spend.Big === 0 && spend.Small === 0 ? null : spend.Big >= spend.Small ? "Big" : "Small";
  let hotNumber = null;
  let hotNumberAmt = 0;
  for (let i = 0; i < 10; i++) {
    if (spend[String(i)] > hotNumberAmt) {
      hotNumberAmt = spend[String(i)];
      hotNumber = i;
    }
  }
  return {
    bets,
    count: bets.length,
    players: Object.keys(uids).length,
    spend,
    total,
    outcomes,
    best: outcomes[0],
    worst: outcomes[outcomes.length - 1],
    colorHot,
    sizeHot,
    oppositeColor: colorHot === "Green" ? "Red" : colorHot === "Red" ? "Green" : colorHot === "Violet" ? "Green / Red" : null,
    oppositeSize: sizeHot === "Big" ? "Small" : sizeHot === "Small" ? "Big" : null,
    hotNumber: hotNumberAmt > 0 ? hotNumber : null,
    hotNumberAmt
  };
}

function allClocks() {
  const out = {};
  Object.keys(MODES).forEach((m) => {
    out[m] = clock(m);
  });
  return out;
}

function broadcast(type) {
  const payload = "data: " + JSON.stringify({ type: type || "update", at: Date.now() }) + "\n\n";
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

function playSnap(user) {
  const results = {};
  Object.keys(MODES).forEach((m) => {
    results[m] = (store.results[m] || []).slice(0, 12);
  });
  const uid = user ? String(user.uid) : "";
  return {
    ok: true,
    serverNow: Date.now(),
    me: publicUser(user),
    results,
    clocks: allClocks(),
    openBets: uid ? store.openBets.filter((b) => String(b.uid) === uid) : [],
    history: uid ? store.history.filter((h) => String(h.uid) === uid).slice(0, 40) : [],
    overrides: {},
    force: null
  };
}

function adminSnap(mode) {
  const m = MODES[mode] ? mode : "30s";
  const clk = clock(m);
  const users = Object.keys(store.users)
    .map((k) => publicUser(store.users[k]))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const userMap = {};
  users.forEach((u) => {
    userMap[u.uid] = u;
  });
  const destId = clk.locked ? clk.nextPeriodId : clk.periodId;
  return {
    ok: true,
    serverNow: Date.now(),
    mode: m,
    clocks: allClocks(),
    results: store.results,
    overrides: store.overrides,
    force: store.force,
    users,
    userMap,
    deposits: store.deposits.slice(0, 80),
    withdrawals: store.withdrawals.slice(0, 80),
    utrCodes: store.utrCodes.slice(0, 80),
    exposure: analyzeExposure(m, destId),
    openCount: store.openBets.length
  };
}

function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function playerFromReq(req) {
  const t = bearer(req);
  const sess = t && store.sessions[t];
  if (!sess) return null;
  return findUser(sess.uid);
}

function adminFromReq(req) {
  const t = bearer(req);
  const sess = t && store.adminSessions[t];
  if (!sess) return false;
  if (Date.now() - sess.at > 8 * 60 * 60 * 1000) {
    delete store.adminSessions[t];
    return false;
  }
  return true;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function register(identity, password) {
  const id = String(identity || "").trim();
  const pass = String(password || "");
  if (!id || pass.length < 4) return { error: "Enter a valid phone/email and a password of 4+ characters." };
  if (findUserByIdentity(id)) return { error: "This phone/email is already registered. Log in instead." };
  const hp = hashPass(pass);
  const user = {
    uid: newUid(),
    identity: id,
    name: "YOUWIN USER",
    wallet: 0,
    banned: false,
    createdAt: Date.now(),
    lastLogin: new Date().toLocaleString(),
    updatedAt: Date.now(),
    salt: hp.salt,
    hash: hp.hash
  };
  store.users[user.uid] = user;
  const tok = token();
  store.sessions[tok] = { uid: user.uid, at: Date.now() };
  saveStore();
  return { ok: true, token: tok, me: publicUser(user) };
}

function login(identity, password) {
  const id = String(identity || "").trim();
  const pass = String(password || "");
  if (!id || pass.length < 4) return { error: "Enter a valid phone/email and a password of 4+ characters." };
  const user = findUserByIdentity(id);
  if (!user) return { error: "No account found. Tap Register." };
  if (user.banned) return { error: "This account is banned. Contact support." };
  if (!checkPass(pass, user.salt, user.hash)) return { error: "Wrong password." };
  user.lastLogin = new Date().toLocaleString();
  user.updatedAt = Date.now();
  const tok = token();
  store.sessions[tok] = { uid: user.uid, at: Date.now() };
  saveStore();
  return { ok: true, token: tok, me: publicUser(user) };
}

function placeBet(user, body) {
  if (!user) return { error: "Sign in to play" };
  if (user.banned) return { error: "This UID is banned" };
  const mode = body && body.mode;
  if (!MODES[mode]) return { error: "Unknown mode" };
  const pick = String((body && body.pick) || "");
  if (!validPick(pick)) return { error: "Select a colour, number or size first" };
  const amount = Number(body && body.amount) || 0;
  if (amount <= 0) return { error: "Enter an amount" };
  const clk = clock(mode);
  if (clk.locked) return { error: "Betting is locked for this period" };
  if (Number(user.wallet || 0) < amount) return { error: "Not enough balance" };
  user.wallet = Number(user.wallet || 0) - amount;
  user.updatedAt = Date.now();
  const bet = {
    id: nid(),
    uid: user.uid,
    identity: user.identity,
    mode,
    periodId: clk.periodId,
    period: clk.period,
    pick,
    amount,
    at: Date.now()
  };
  store.openBets.push(bet);
  store.ledger.unshift({
    id: bet.id,
    uid: bet.uid,
    identity: bet.identity,
    mode,
    periodId: bet.periodId,
    period: bet.period,
    pick,
    amount,
    at: bet.at
  });
  store.ledger = store.ledger.slice(0, 500);
  saveStore();
  broadcast("bet");
  return { ok: true, bet, me: publicUser(user) };
}

function submitDeposit(user, body) {
  if (!user) return { error: "Sign in to deposit" };
  const amount = Number(body && body.amount) || 0;
  const utr = String((body && body.utr) || "").replace(/\s+/g, "").trim();
  if (amount < 1) return { error: "Enter an amount" };
  if (utr.length < 8) return { error: "Enter a valid UTR (8+ characters)" };
  if (store.deposits.some((d) => String(d.utr).toLowerCase() === utr.toLowerCase())) {
    return { error: "This UTR is already submitted" };
  }
  const voucher = store.utrCodes.find((c) => String(c.code) === utr);
  if (voucher) {
    if (voucher.used) return { error: "This UTR is already used" };
    if (Number(voucher.amount) !== amount) {
      return { error: "Amount must be ₹" + Number(voucher.amount).toFixed(2) + " for this UTR" };
    }
    user.wallet = Number(user.wallet || 0) + amount;
    user.updatedAt = Date.now();
    voucher.used = true;
    voucher.usedBy = user.uid;
    voucher.usedAt = Date.now();
    const rec = {
      id: nid(),
      uid: user.uid,
      identity: user.identity,
      amount,
      utr,
      status: "approved",
      source: "utr-code",
      reviewedAt: Date.now(),
      at: Date.now()
    };
    store.deposits.unshift(rec);
    store.deposits = store.deposits.slice(0, 200);
    saveStore();
    broadcast("deposit");
    return rec;
  }
  const rec = {
    id: nid(),
    uid: user.uid,
    identity: user.identity,
    amount,
    utr,
    status: "pending",
    at: Date.now()
  };
  store.deposits.unshift(rec);
  store.deposits = store.deposits.slice(0, 200);
  saveStore();
  broadcast("deposit");
  return rec;
}

function submitWithdraw(user, body) {
  if (!user) return { error: "Sign in to withdraw" };
  const amount = Number(body && body.amount) || 0;
  const bank = String((body && body.bank) || "").trim();
  const name = String((body && body.name) || "").trim();
  const account = String((body && body.account) || "").replace(/\s+/g, "");
  const phone = String((body && body.phone) || "").trim();
  const email = String((body && body.email) || "").trim();
  const ifsc = String((body && body.ifsc) || "").trim().toUpperCase();
  if (amount < 1) return { error: "Enter an amount" };
  if (!bank) return { error: "Choose a bank" };
  if (name.length < 2) return { error: "Enter full recipient name" };
  if (account.length < 8) return { error: "Enter bank account number" };
  if (phone.length < 10) return { error: "Enter phone number" };
  if (!email.includes("@")) return { error: "Enter email" };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: "Enter a valid IFSC" };
  if (user.banned) return { error: "This UID is banned" };
  const wallet = Number(user.wallet || 0);
  if (wallet < amount) return { error: "Not enough balance" };
  user.wallet = wallet - amount;
  user.updatedAt = Date.now();
  const rec = {
    id: nid(),
    uid: user.uid,
    identity: user.identity,
    amount,
    bank,
    name,
    account,
    phone,
    email,
    ifsc,
    status: "pending",
    at: Date.now()
  };
  store.withdrawals.unshift(rec);
  store.withdrawals = store.withdrawals.slice(0, 200);
  saveStore();
  broadcast("withdraw");
  return rec;
}

function setProfile(user, body) {
  if (!user) return { error: "Sign in" };
  const name = String((body && body.name) || "").trim();
  if (name) user.name = name.slice(0, 32);
  user.updatedAt = Date.now();
  saveStore();
  return { ok: true, me: publicUser(user) };
}

function generateUtr(amount) {
  const amt = Number(amount) || 0;
  if (amt < 1) return { error: "Enter an amount" };
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 12; i++) code += String(Math.floor(Math.random() * 10));
  } while (store.utrCodes.some((u) => String(u.code) === code));
  const rec = {
    id: nid(),
    code,
    amount: amt,
    used: false,
    usedBy: "",
    usedAt: 0,
    at: Date.now()
  };
  store.utrCodes.unshift(rec);
  store.utrCodes = store.utrCodes.slice(0, 200);
  saveStore();
  broadcast("utr");
  return rec;
}

function setDepositStatus(id, status) {
  const rec = store.deposits.find((d) => String(d.id) === String(id));
  if (!rec) return { error: "Deposit not found" };
  if (rec.status !== "pending") return { error: "Already " + rec.status };
  if (status === "approved") {
    const user = findUser(rec.uid);
    if (!user) return { error: "UID not found" };
    user.wallet = Number(user.wallet || 0) + Number(rec.amount);
    user.updatedAt = Date.now();
  }
  rec.status = status;
  rec.reviewedAt = Date.now();
  saveStore();
  broadcast("deposit");
  return rec;
}

function setWithdrawStatus(id, status) {
  const rec = store.withdrawals.find((d) => String(d.id) === String(id));
  if (!rec) return { error: "Withdraw not found" };
  if (rec.status !== "pending") return { error: "Already " + rec.status };
  if (status === "rejected") {
    const user = findUser(rec.uid);
    if (user) {
      user.wallet = Number(user.wallet || 0) + Number(rec.amount);
      user.updatedAt = Date.now();
    }
  }
  rec.status = status;
  rec.reviewedAt = Date.now();
  saveStore();
  broadcast("withdraw");
  return rec;
}

function userAction(body) {
  const uid = String((body && body.uid) || "").trim();
  const user = findUser(uid);
  if (!user) return { error: "No account found for " + uid };
  const action = body && body.action;
  const amt = Number(body && body.amount) || 0;
  if (action === "add") user.wallet = Number(user.wallet || 0) + amt;
  else if (action === "remove") user.wallet = Math.max(0, Number(user.wallet || 0) - amt);
  else if (action === "set") user.wallet = Math.max(0, amt);
  else if (action === "ban") user.banned = true;
  else if (action === "unban") user.banned = false;
  else return { error: "Unknown action" };
  user.updatedAt = Date.now();
  saveStore();
  broadcast("user");
  return { ok: true, user: publicUser(user) };
}

function lockResult(body) {
  const mode = body && body.mode;
  if (!MODES[mode]) return { error: "Unknown mode" };
  const number = Number(body && body.number);
  if (!(number >= 0 && number <= 9)) return { error: "Pick a number" };
  const clk = clock(mode);
  const useNext = body && (body.target === "next" || clk.locked);
  const periodId = body.periodId != null ? Number(body.periodId) : useNext ? clk.nextPeriodId : clk.periodId;
  const period = periodCode(mode, periodId);
  const payload = {
    mode,
    periodId,
    period,
    number,
    colors: colorsOf(number),
    target: useNext ? "following period" : "this period",
    by: "admin",
    at: Date.now()
  };
  store.overrides[mode] = payload;
  store.force = {
    id: nid(),
    mode,
    periodId,
    number,
    revealNow: !!body.forceNow,
    at: Date.now()
  };
  if (body.forceNow) settle(mode, periodId, number);
  saveStore();
  broadcast("override");
  return { ok: true, override: payload, force: store.force };
}

function clearOverride(mode) {
  if (mode && store.overrides[mode]) delete store.overrides[mode];
  saveStore();
  broadcast("override");
  return { ok: true };
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    res.end();
    return;
  }
  const p = url.pathname;

  if (p === "/api/health" && req.method === "GET") {
    return send(res, 200, { ok: true, players: Object.keys(store.users).length });
  }

  if (p === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write("retry: 2000\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (p === "/api/register" && req.method === "POST") {
    const body = await readBody(req);
    const rec = register(body.identity, body.password);
    return send(res, rec.error ? 400 : 200, rec);
  }
  if (p === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const rec = login(body.identity, body.password);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/play" && req.method === "GET") {
    const user = playerFromReq(req);
    return send(res, 200, playSnap(user));
  }

  if (p === "/api/me" && req.method === "GET") {
    const user = playerFromReq(req);
    if (!user) return send(res, 401, { error: "Sign in" });
    if (user.banned) return send(res, 403, { error: "This UID is banned" });
    return send(res, 200, { ok: true, me: publicUser(user) });
  }

  if (p === "/api/profile" && req.method === "POST") {
    const user = playerFromReq(req);
    const body = await readBody(req);
    const rec = setProfile(user, body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/bet" && req.method === "POST") {
    const user = playerFromReq(req);
    const body = await readBody(req);
    const rec = placeBet(user, body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/deposit" && req.method === "POST") {
    const user = playerFromReq(req);
    const body = await readBody(req);
    const rec = submitDeposit(user, body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/withdraw" && req.method === "POST") {
    const user = playerFromReq(req);
    const body = await readBody(req);
    const rec = submitWithdraw(user, body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    if (String(body.user || "") === ADMIN_USER && String(body.pass || "") === ADMIN_PASS) {
      const tok = token();
      store.adminSessions[tok] = { at: Date.now() };
      saveStore();
      return send(res, 200, { ok: true, token: tok });
    }
    return send(res, 401, { error: "Access denied. Admin only." });
  }

  if (p === "/api/admin/state" && req.method === "GET") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const mode = url.searchParams.get("mode") || "30s";
    return send(res, 200, adminSnap(mode));
  }

  if (p === "/api/admin/lock" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    const rec = lockResult(body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/admin/clear" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    return send(res, 200, clearOverride(body.mode));
  }

  if (p === "/api/admin/utr" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    const rec = generateUtr(body.amount);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/admin/deposit" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    const rec = setDepositStatus(body.id, body.status);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/admin/withdraw" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    const rec = setWithdrawStatus(body.id, body.status);
    return send(res, rec.error ? 400 : 200, rec);
  }

  if (p === "/api/admin/user" && req.method === "POST") {
    if (!adminFromReq(req)) return send(res, 401, { error: "Admin sign in" });
    const body = await readBody(req);
    const rec = userAction(body);
    return send(res, rec.error ? 400 : 200, rec);
  }

  send(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  let rel = url.pathname;
  if (rel === "/") rel = "/index.html";
  const blocked = rel === "/server.js" || rel.startsWith("/data/") || rel.startsWith("/.");
  if (blocked) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const file = path.normalize(path.join(ROOT, decodeURIComponent(rel)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60"
    });
    res.end(buf);
  });
}

function tickModes() {
  Object.keys(MODES).forEach((mode) => {
    const c = clock(mode);
    if (lastPeriod[mode] == null) {
      lastPeriod[mode] = c.periodId;
      ensureHistory(mode, 8);
      return;
    }
    if (c.periodId !== lastPeriod[mode]) {
      settle(mode, lastPeriod[mode]);
      lastPeriod[mode] = c.periodId;
      broadcast("result");
    }
    const force = store.force;
    if (force && force.revealNow && force.mode === mode) {
      const pid = force.periodId != null ? Number(force.periodId) : c.periodId;
      settle(mode, pid, force.number);
      force.revealNow = false;
      saveStore();
      broadcast("force");
    }
  });
}

loadStore();
Object.keys(MODES).forEach((m) => ensureHistory(m, 8));

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", "http://" + host);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("YOUWIN live on 0.0.0.0:" + PORT);
});

setInterval(tickModes, 200);
setInterval(() => {
  sseClients.forEach((res) => {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      sseClients.delete(res);
    }
  });
}, 15000);
