/* Shared WinGo period + result engine (player + admin). */
(function (root) {
  const MODES = {
    "30s": { id: "30s", name: "WinGo 30 sec", short: "WIN GO 30 SEC", ms: 30000 },
    "1m": { id: "1m", name: "WinGo 1 Min", short: "WIN GO 1 MIN", ms: 60000 },
    "3m": { id: "3m", name: "WinGo 3 Min", short: "WIN GO 3 MIN", ms: 180000 },
    "5m": { id: "5m", name: "WinGo 5 Min", short: "WIN GO 5 MIN", ms: 300000 }
  };

  const KEYS = {
    overrides: "youwin_result_overrides",
    results: "youwin_settled_results",
    wallet: "youwin_wallet",
    auth: "youwin_auth",
    profile: "youwin_profile",
    bets: "youwin_open_bets",
    history: "youwin_play_history",
    adminSession: "youwin_admin_session",
    ping: "youwin_sync_ping",
    force: "youwin_force_cmd",
    users: "youwin_users",
    ledger: "youwin_bet_ledger",
    deposits: "youwin_deposits",
    utrCodes: "youwin_utr_codes",
    withdrawals: "youwin_withdrawals"
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

  const COLOR_NUMBERS = {
    green: [1, 3, 7, 9],
    red: [2, 4, 6, 8],
    violet: [0, 4, 5, 9]
  };

  const mem = {};

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    if (Object.prototype.hasOwnProperty.call(mem, key)) return mem[key];
    return fallback;
  }

  function channel() {
    try {
      if (!root.__youwinBC) root.__youwinBC = new BroadcastChannel("youwin-wingo");
      return root.__youwinBC;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    mem[key] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("youwin-store", { detail: { key, value } }));
    } catch (e) {}
  }

  function ping(type, payload) {
    const msg = { type: type || "update", payload: payload || null, at: Date.now(), n: Math.random() };
    write(KEYS.ping, msg);
    const ch = channel();
    if (ch) {
      try { ch.postMessage(msg); } catch (e) {}
    }
    return msg;
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
    const seq = pad(periodId % 100000, 5);
    return stamp + seq;
  }

  let timeOffset = 0;
  const snap = {
    ready: false,
    me: null,
    results: {},
    clocks: {},
    openBets: [],
    history: [],
    overrides: {},
    force: null,
    users: [],
    userMap: {},
    deposits: [],
    withdrawals: [],
    utrCodes: [],
    exposure: null
  };
  let playerToken = "";
  let adminToken = "";

  function nowMs() {
    return Date.now() + timeOffset;
  }

  function clock(mode, now) {
    const ms = MODES[mode].ms;
    const t = now == null ? nowMs() : now;
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
      locked: remaining <= 5000,
      progress: 1 - remaining / ms
    };
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(total / 60), 2) + ":" + pad(total % 60, 2);
  }

  function colorsOf(number) {
    return (NUMBER_COLORS[number] || ["green"]).slice();
  }

  function colorLabel(number) {
    return colorsOf(number).map((x) => x[0].toUpperCase() + x.slice(1)).join(" + ");
  }

  function sizeOf(number) {
    return number >= 5 ? "Big" : "Small";
  }

  function ballClass(number) {
    const c = colorsOf(number);
    if (c.length === 2) return c[0] + "-" + c[1] + "-ball";
    return c[0] + "-ball";
  }

  function resultClass(number) {
    const c = colorsOf(number);
    if (c[0] === "violet" || (c.length === 2 && c.includes("violet") && !c.includes("red"))) return "violet-result";
    if (c.includes("green") && !c.includes("red")) return "green-result";
    return "red-result";
  }

  function randomNumber(color) {
    if (color && COLOR_NUMBERS[color]) {
      const pool = COLOR_NUMBERS[color];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return Math.floor(Math.random() * 10);
  }

  function getOverrides() {
    if (snap.ready && snap.overrides) return snap.overrides;
    return read(KEYS.overrides, {});
  }

  function setOverride(mode, payload) {
    const all = getOverrides();
    all[mode] = payload;
    write(KEYS.overrides, all);
    ping("override", payload);
    return payload;
  }

  function clearOverride(mode) {
    const all = getOverrides();
    delete all[mode];
    write(KEYS.overrides, all);
    ping("override-clear", { mode });
  }

  function consumeOverride(mode, periodId) {
    const all = getOverrides();
    const item = all[mode];
    if (!item) return null;
    if (item.periodId != null && Number(item.periodId) > Number(periodId)) return null;
    delete all[mode];
    write(KEYS.overrides, all);
    ping("override-used", { mode, periodId, number: item.number });
    return item;
  }

  function peekOverride(mode, periodId) {
    const item = getOverrides()[mode];
    if (!item) return null;
    if (periodId != null && Number(item.periodId) > Number(periodId)) return null;
    return item;
  }

  function setForce(cmd) {
    write(KEYS.force, cmd);
    ping("force", cmd);
    return cmd;
  }

  function readForce() {
    if (snap.ready) return snap.force || null;
    return read(KEYS.force, null);
  }

  function getResults(mode) {
    if (snap.results && snap.results[mode]) return snap.results[mode];
    const all = read(KEYS.results, {});
    return all[mode] || [];
  }

  function pushResult(mode, record) {
    const all = read(KEYS.results, {});
    const list = all[mode] || [];
    if (list.some((r) => r.periodId === record.periodId)) return list;
    list.unshift(record);
    all[mode] = list.slice(0, 80);
    write(KEYS.results, all);
    ping("result", record);
    return all[mode];
  }

  function settle(mode, periodId, forcedNumber) {
    const existing = getResults(mode).find((r) => r.periodId === periodId);
    if (existing) return existing;
    if (snap.ready) {
      return {
        mode,
        periodId,
        period: periodCode(mode, periodId),
        number: 0,
        colors: colorsOf(0),
        size: sizeOf(0),
        source: "pending",
        at: Date.now()
      };
    }
    const override = consumeOverride(mode, periodId);
    const number = forcedNumber != null
      ? Number(forcedNumber)
      : (override ? Number(override.number) : randomNumber());
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
    pushResult(mode, record);
    return record;
  }

  function ensureHistory(mode, count) {
    if (snap.ready) return getResults(mode);
    const list = getResults(mode).slice();
    if (list.length >= count) return list;
    const clk = clock(mode);
    let pid = clk.periodId - 1;
    while (list.length < count && pid > 0) {
      if (!list.some((r) => r.periodId === pid)) {
        const number = randomNumber();
        const record = {
          mode,
          periodId: pid,
          period: periodCode(mode, pid),
          number,
          colors: colorsOf(number),
          size: sizeOf(number),
          source: "auto",
          at: pid * MODES[mode].ms + MODES[mode].ms
        };
        list.push(record);
        pushResult(mode, record);
      }
      pid -= 1;
    }
    return getResults(mode);
  }

  function getUsers() {
    const all = read(KEYS.users, {});
    return all && typeof all === "object" ? all : {};
  }

  function listUsers() {
    if (snap.ready && Array.isArray(snap.users)) return snap.users.slice();
    const all = getUsers();
    return Object.keys(all)
      .map((k) => all[k])
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function findUser(uid) {
    if (uid == null || uid === "") return null;
    const key = String(uid).trim();
    if (snap.me && String(snap.me.uid) === key) return snap.me;
    if (snap.userMap && snap.userMap[key]) return snap.userMap[key];
    const all = getUsers();
    if (all[key]) return all[key];
    return Object.keys(all).map((k) => all[k]).find((u) => String(u && u.uid) === key) || null;
  }

  function findUserByIdentity(identity) {
    if (!identity) return null;
    const id = String(identity).trim().toLowerCase();
    return listUsers().find((u) => String(u.identity || "").trim().toLowerCase() === id) || null;
  }

  function newUid() {
    const all = getUsers();
    let uid;
    do {
      uid = String(100000 + Math.floor(Math.random() * 900000));
    } while (all[uid]);
    return uid;
  }

  function upsertUser(user) {
    if (!user || !user.uid) return user;
    const all = getUsers();
    user.updatedAt = Date.now();
    all[String(user.uid)] = user;
    write(KEYS.users, all);
    ping("user", { uid: user.uid, wallet: user.wallet, banned: !!user.banned });
    return user;
  }

  function createUser(identity) {
    return upsertUser({
      uid: newUid(),
      identity: identity || "",
      name: "YOUWIN USER",
      wallet: 0,
      banned: false,
      createdAt: Date.now(),
      lastLogin: "",
      updatedAt: Date.now()
    });
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
    const colors = colorsOf(n).map((c) => c.toLowerCase());
    const p = String(pick);
    if (p === "Green") return colors.includes("green");
    if (p === "Red") return colors.includes("red");
    if (p === "Violet") return colors.includes("violet");
    if (p === "Big") return n >= 5;
    if (p === "Small") return n < 5;
    if (/^\d$/.test(p)) return Number(p) === n;
    return false;
  }

  function getLedger() {
    const list = read(KEYS.ledger, []);
    return Array.isArray(list) ? list : [];
  }

  function pushLedger(bet) {
    if (!bet) return getLedger();
    const list = getLedger();
    const id = bet.id != null ? String(bet.id) : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    if (list.some((b) => String(b.id) === id)) return list;
    list.unshift({
      id,
      uid: bet.uid || "",
      identity: bet.identity || "",
      mode: bet.mode,
      periodId: bet.periodId,
      period: bet.period,
      pick: String(bet.pick),
      amount: Number(bet.amount) || 0,
      at: bet.at || Date.now()
    });
    write(KEYS.ledger, list.slice(0, 500));
    ping("bet", { id, pick: bet.pick, amount: bet.amount, mode: bet.mode, periodId: bet.periodId });
    return list;
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
    getLedger().forEach(add);
    const open = read(KEYS.bets, []);
    (Array.isArray(open) ? open : []).forEach(add);
    return merged;
  }

  function analyzeExposure(mode, periodId) {
    if (snap.ready && snap.exposure) return snap.exposure;
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
      outcomes.push({
        number: n,
        colors: colorsOf(n),
        size: sizeOf(n),
        payout,
        profit: total - payout
      });
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

  function listDeposits() {
    if (snap.ready && Array.isArray(snap.deposits)) return snap.deposits;
    const list = read(KEYS.deposits, []);
    return Array.isArray(list) ? list : [];
  }

  function listUtrCodes() {
    if (snap.ready && Array.isArray(snap.utrCodes)) return snap.utrCodes;
    const list = read(KEYS.utrCodes, []);
    return Array.isArray(list) ? list : [];
  }

  function generateUtr(amount) {
    const amt = Number(amount) || 0;
    if (amt < 1) return { error: "Enter an amount" };
    const existing = listUtrCodes();
    let code = "";
    do {
      code = "";
      for (let i = 0; i < 12; i++) code += String(Math.floor(Math.random() * 10));
    } while (existing.some((u) => String(u.code) === code));
    const rec = {
      id: Date.now() + "-" + Math.random().toString(16).slice(2),
      code,
      amount: amt,
      used: false,
      usedBy: "",
      usedAt: 0,
      at: Date.now()
    };
    existing.unshift(rec);
    write(KEYS.utrCodes, existing.slice(0, 200));
    ping("utr", rec);
    return rec;
  }

  function submitDeposit(payload) {
    const amount = Number(payload && payload.amount) || 0;
    const utr = String((payload && payload.utr) || "").replace(/\s+/g, "").trim();
    const uid = payload && payload.uid ? String(payload.uid) : "";
    if (amount < 1) return { error: "Enter an amount" };
    if (!uid) return { error: "Sign in to deposit" };
    if (utr.length < 8) return { error: "Enter a valid UTR (8+ characters)" };
    const all = listDeposits();
    if (all.some((d) => String(d.utr).toLowerCase() === utr.toLowerCase())) {
      return { error: "This UTR is already submitted" };
    }
    const codes = listUtrCodes();
    const voucher = codes.find((c) => String(c.code) === utr);
    if (voucher) {
      if (voucher.used) return { error: "This UTR is already used" };
      if (Number(voucher.amount) !== amount) {
        return { error: "Amount must be ₹" + Number(voucher.amount).toFixed(2) + " for this UTR" };
      }
      const user = findUser(uid);
      if (!user) return { error: "UID not found" };
      user.wallet = Number(user.wallet || 0) + amount;
      upsertUser(user);
      voucher.used = true;
      voucher.usedBy = uid;
      voucher.usedAt = Date.now();
      write(KEYS.utrCodes, codes);
      const rec = {
        id: Date.now() + "-" + Math.random().toString(16).slice(2),
        uid,
        identity: (payload && payload.identity) || "",
        amount,
        utr,
        status: "approved",
        source: "utr-code",
        reviewedAt: Date.now(),
        at: Date.now()
      };
      all.unshift(rec);
      write(KEYS.deposits, all.slice(0, 200));
      ping("deposit", rec);
      return rec;
    }
    const rec = {
      id: Date.now() + "-" + Math.random().toString(16).slice(2),
      uid,
      identity: (payload && payload.identity) || "",
      amount,
      utr,
      status: "pending",
      at: Date.now()
    };
    all.unshift(rec);
    write(KEYS.deposits, all.slice(0, 200));
    ping("deposit", rec);
    return rec;
  }

  function listWithdrawals() {
    const list = read(KEYS.withdrawals, []);
    return Array.isArray(list) ? list : [];
  }

  function submitWithdraw(payload) {
    const amount = Number(payload && payload.amount) || 0;
    const uid = payload && payload.uid ? String(payload.uid) : "";
    const bank = String((payload && payload.bank) || "").trim();
    const name = String((payload && payload.name) || "").trim();
    const account = String((payload && payload.account) || "").replace(/\s+/g, "");
    const phone = String((payload && payload.phone) || "").trim();
    const email = String((payload && payload.email) || "").trim();
    const ifsc = String((payload && payload.ifsc) || "").trim().toUpperCase();
    if (!uid) return { error: "Sign in to withdraw" };
    if (amount < 1) return { error: "Enter an amount" };
    if (!bank) return { error: "Choose a bank" };
    if (name.length < 2) return { error: "Enter full recipient name" };
    if (account.length < 8) return { error: "Enter bank account number" };
    if (phone.length < 10) return { error: "Enter phone number" };
    if (!email.includes("@")) return { error: "Enter email" };
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: "Enter a valid IFSC" };
    const user = findUser(uid);
    if (!user) return { error: "UID not found" };
    if (user.banned) return { error: "This UID is banned" };
    const wallet = Number(user.wallet || 0);
    if (wallet < amount) return { error: "Not enough balance" };
    user.wallet = wallet - amount;
    upsertUser(user);
    const rec = {
      id: Date.now() + "-" + Math.random().toString(16).slice(2),
      uid,
      identity: (payload && payload.identity) || "",
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
    const all = listWithdrawals();
    all.unshift(rec);
    write(KEYS.withdrawals, all.slice(0, 200));
    ping("withdraw", rec);
    return rec;
  }

  function setWithdrawStatus(id, status) {
    const all = listWithdrawals();
    const rec = all.find((d) => String(d.id) === String(id));
    if (!rec) return { error: "Withdraw not found" };
    if (rec.status !== "pending") return { error: "Already " + rec.status };
    if (status === "rejected") {
      const user = findUser(rec.uid);
      if (user) {
        user.wallet = Number(user.wallet || 0) + Number(rec.amount);
        upsertUser(user);
      }
    }
    rec.status = status;
    rec.reviewedAt = Date.now();
    write(KEYS.withdrawals, all);
    ping("withdraw", rec);
    return rec;
  }

  function setDepositStatus(id, status) {
    const all = listDeposits();
    const rec = all.find((d) => String(d.id) === String(id));
    if (!rec) return { error: "Deposit not found" };
    if (rec.status !== "pending") return { error: "Already " + rec.status };
    if (status === "approved") {
      const user = findUser(rec.uid);
      if (!user) return { error: "UID not found" };
      user.wallet = Number(user.wallet || 0) + Number(rec.amount);
      upsertUser(user);
    }
    rec.status = status;
    rec.reviewedAt = Date.now();
    write(KEYS.deposits, all);
    ping("deposit", rec);
    return rec;
  }

  root.YouWinGame = {
    MODES,
    KEYS,
    NUMBER_COLORS,
    COLOR_NUMBERS,
    read,
    write,
    clock,
    formatTime,
    periodCode,
    colorsOf,
    colorLabel,
    sizeOf,
    ballClass,
    resultClass,
    randomNumber,
    getOverrides,
    setOverride,
    clearOverride,
    consumeOverride,
    peekOverride,
    setForce,
    readForce,
    ping,
    channel,
    getResults,
    pushResult,
    settle,
    ensureHistory,
    getUsers,
    listUsers,
    findUser,
    findUserByIdentity,
    upsertUser,
    newUid,
    createUser,
    payoutRate,
    pickHits,
    getLedger,
    pushLedger,
    periodBets,
    analyzeExposure,
    listDeposits,
    submitDeposit,
    setDepositStatus,
    listUtrCodes,
    generateUtr,
    listWithdrawals,
    submitWithdraw,
    setWithdrawStatus,
    snap,
    me,
    getOpenBets,
    getPlayHistory,
    pullPlay,
    pullAdmin,
    apiRegister,
    apiLogin,
    apiBet,
    apiDeposit,
    apiWithdraw,
    apiProfile,
    apiAdminLogin,
    apiLock,
    apiClear,
    apiGenerateUtr,
    apiReviewDeposit,
    apiReviewWithdraw,
    apiUserAction,
    listenLive
  };
})(window);
