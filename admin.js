(function () {
  const G = window.YouWinGame;
  if (!G) {
    console.error("YOUWIN admin: game-core failed to load");
    return;
  }
  const ADMIN_USER = "admin";
  const ADMIN_PASS = "youwin2026";
  const SESSION_KEY = G.KEYS.adminSession;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    mode: "30s",
    number: 7,
    target: "current",
    built: false
  };

  function authed() {
    try {
      const rec = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      return rec && rec.ok === true && rec.token && Date.now() - rec.at < 1000 * 60 * 60 * 8;
    } catch (e) {
      return false;
    }
  }

  function ballClass(n) {
    return "n" + n;
  }

  function status(msg, ok) {
    const el = $("#lockStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? "#18b566" : "#ff8b90";
  }

  function enter() {
    $("#adminGate").hidden = true;
    $("#adminApp").hidden = false;
    buildOnce();
    if (G.pullAdmin) {
      G.pullAdmin(state.mode).then(() => renderAll()).catch(() => renderAll());
    } else renderAll();
  }

  function buildOnce() {
    if (state.built) return;
    const modeBox = $("#modeGrid");
    modeBox.innerHTML = Object.values(G.MODES)
      .map((m) => `<button class="mode-card" data-mode="${m.id}" type="button">
        <b><i class="live"></i>${m.name}</b>
        <small data-mode-period="${m.id}"></small>
        <strong data-mode-time="${m.id}">00:00</strong>
      </button>`)
      .join("");
    const numBox = $("#numberGrid");
    numBox.innerHTML = Array.from({ length: 10 }, (_, n) =>
      `<button class="num ${ballClass(n)}" data-number="${n}" type="button">${n}</button>`
    ).join("");
    state.built = true;
  }

  function renderPreview() {
    const n = state.number;
    const colors = G.colorsOf(n);
    const ball = $("#previewBall");
    ball.className = "preview-ball " + ballClass(n);
    ball.textContent = n;
    $("#previewText").textContent = n + " · " + G.colorLabel(n) + " · " + G.sizeOf(n);
    $("#previewBadges").innerHTML =
      colors.map((c) => `<span class="badge ${c}">${c}</span>`).join("") +
      `<span class="badge" style="background:#2b3344">${G.sizeOf(n)}</span>`;
    $$("[data-color]").forEach((btn) => btn.classList.toggle("active", colors.includes(btn.dataset.color)));
    $$("[data-number]").forEach((btn) => btn.classList.toggle("active", Number(btn.dataset.number) === n));
  }

  function renderClock() {
    Object.values(G.MODES).forEach((m) => {
      const clk = G.clock(m.id);
      const card = document.querySelector('.mode-card[data-mode="' + m.id + '"]');
      if (card) card.classList.toggle("active", state.mode === m.id);
      const p = document.querySelector('[data-mode-period="' + m.id + '"]');
      const t = document.querySelector('[data-mode-time="' + m.id + '"]');
      if (p) p.textContent = clk.period.slice(-8);
      if (t) t.textContent = G.formatTime(clk.remaining);
    });
    const clk = G.clock(state.mode);
    $("#curPeriod").textContent = clk.period;
    $("#nextPeriod").textContent = clk.nextPeriod;
    $("#curTime").textContent = G.formatTime(clk.remaining);
    $("#curStatus").textContent = clk.locked ? "Locked (last 5s)" : "Betting open";
    $("#curStatus").className = clk.locked ? "locked-tag" : "";
    const label = $("#targetNextLabel");
    if (label) label.textContent = "Period " + clk.period;
    const btn = $("#lockBtn");
    if (btn) btn.textContent = "Send " + state.number + " · " + G.colorLabel(state.number) + " to WinGo";
  }

  function renderQueue() {
    const all = G.getOverrides();
    const box = $("#queueList");
    const items = Object.keys(all);
    if (!items.length) {
      box.innerHTML = '<p class="empty">No result is queued. WinGo will draw a random number.</p>';
      return;
    }
    box.innerHTML = items
      .map((mode) => {
        const item = all[mode];
        const n = Number(item.number);
        return `<div class="row">
          <span class="mini ${ballClass(n)}">${n}</span>
          <div><b>${G.MODES[mode].name}</b><small>Period ${item.period} · ${G.colorLabel(n)}</small></div>
          <button class="chip-btn" data-clear="${mode}" type="button">Remove</button>
        </div>`;
      })
      .join("");
  }

  function renderHistory() {
    const list = G.getResults(state.mode).slice(0, 8);
    const box = $("#historyList");
    if (!list.length) {
      box.innerHTML = '<p class="empty">No settled periods yet for this mode.</p>';
      return;
    }
    box.innerHTML = list
      .map((r) => `<div class="row">
        <span class="mini ${ballClass(r.number)}">${r.number}</span>
        <div><b>${r.number} · ${G.colorLabel(r.number)}</b><small>${r.period} · ${r.source === "admin" ? "admin set" : "auto"}</small></div>
        <span>${r.size}</span>
      </div>`)
      .join("");
  }

  function money(n) {
    return "₹" + Number(n || 0).toFixed(2);
  }

  function uidStatus(msg, ok) {
    const el = $("#uidStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? "#18b566" : "#ff8b90";
  }

  function showUser(user) {
    const card = $("#uidCard");
    if (!card || !user) return;
    card.hidden = false;
    $("#uUid").textContent = user.uid;
    $("#uIdentity").textContent = user.identity || "—";
    $("#uName").textContent = user.name || "YOUWIN USER";
    $("#uWallet").textContent = money(user.wallet);
    $("#uBanned").textContent = user.banned ? "BANNED" : "Active";
    $("#uBanned").className = user.banned ? "banned-flag" : "active-flag";
    $("#uLogin").textContent = user.lastLogin || "—";
    card.dataset.uid = user.uid;
  }

  function currentUser() {
    const card = $("#uidCard");
    if (!card || card.hidden || !card.dataset.uid) return null;
    return G.findUser(card.dataset.uid);
  }

  function renderUsers() {
    const box = $("#userTable");
    if (!box) return;
    const list = G.listUsers();
    if (!list.length) {
      box.innerHTML = '<tr><td colspan="5">No player accounts yet. Register on the player site first.</td></tr>';
      return;
    }
    box.innerHTML = list.map((u) => `<tr>
      <td>${u.uid}</td>
      <td>${u.identity || "—"}</td>
      <td>${money(u.wallet)}</td>
      <td class="${u.banned ? "banned-flag" : "active-flag"}">${u.banned ? "Banned" : "Active"}</td>
      <td><button type="button" data-open-uid="${u.uid}">Open</button></td>
    </tr>`).join("");
  }

  function findUid() {
    const q = ($("#uidSearch").value || "").trim();
    if (!q) {
      uidStatus("Enter a UID", false);
      return;
    }
    const user = G.findUser(q) || G.listUsers().find((u) => String(u.uid).endsWith(q) || u.identity === q);
    if (!user) {
      $("#uidCard").hidden = true;
      uidStatus("No account found for " + q, false);
      return;
    }
    showUser(user);
    uidStatus("Loaded UID " + user.uid, true);
  }

  function changeMoney(kind) {
    const user = currentUser();
    if (!user) return uidStatus("Find a UID first", false);
    const amt = Number($("#uidAmount").value || 0);
    if (kind !== "set" && amt <= 0) return uidStatus("Enter an amount", false);
    const apply = (u) => {
      if (!u) return;
      showUser(u);
      renderUsers();
      uidStatus((kind === "add" ? "Added " : kind === "remove" ? "Removed " : "Set ") + money(kind === "set" ? u.wallet : amt) + " · UID " + u.uid, true);
    };
    if (G.apiUserAction) {
      G.apiUserAction({ uid: user.uid, action: kind, amount: amt }).then((rec) => {
        if (rec && rec.error) return uidStatus(rec.error, false);
        apply(rec.user || G.findUser(user.uid));
      }).catch(() => uidStatus("Cannot reach server", false));
      return;
    }
    if (kind === "add") user.wallet = Number(user.wallet || 0) + amt;
    if (kind === "remove") user.wallet = Math.max(0, Number(user.wallet || 0) - amt);
    if (kind === "set") user.wallet = Math.max(0, amt);
    G.upsertUser(user);
    apply(user);
  }

  function setBanned(flag) {
    const user = currentUser();
    if (!user) return uidStatus("Find a UID first", false);
    if (G.apiUserAction) {
      G.apiUserAction({ uid: user.uid, action: flag ? "ban" : "unban" }).then((rec) => {
        if (rec && rec.error) return uidStatus(rec.error, false);
        const u = rec.user || G.findUser(user.uid);
        if (u) showUser(u);
        renderUsers();
        uidStatus(flag ? "UID banned" : "UID unbanned", true);
      }).catch(() => uidStatus("Cannot reach server", false));
      return;
    }
    user.banned = !!flag;
    G.upsertUser(user);
    showUser(user);
    renderUsers();
    uidStatus(flag ? "UID banned" : "UID unbanned", true);
  }

  function barRow(label, amount, max, cls, hot) {
    const pct = max > 0 && amount > 0 ? Math.max(4, Math.round((amount / max) * 100)) : 0;
    return `<div class="risk-row ${cls || ""} ${hot ? "hot" : ""}">
      <span class="risk-lab">${label}</span>
      <div class="risk-track"><i style="width:${pct}%"></i></div>
      <b>${money(amount)}</b>
    </div>`;
  }

  function renderRisk() {
    if (!G.analyzeExposure) return;
    const dest = targetPeriod();
    const x = G.analyzeExposure(state.mode, dest.periodId);
    $$(".risk-mode").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === state.mode));
    const sub = $("#riskSub");
    if (sub) {
      const name = G.MODES[state.mode] ? G.MODES[state.mode].name : state.mode;
      const sec = G.MODES[state.mode] ? Math.round(G.MODES[state.mode].ms / 1000) + "s" : "";
      sub.textContent = name + " · " + sec + " · " + dest.period;
    }
    const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
    setText("#riskTotal", money(x.total));
    setText("#riskCount", x.count + " / " + x.players);
    const best = x.best;
    setText("#riskPayout", money(best ? best.payout : 0));
    const keepEl = $("#riskKeep");
    if (keepEl) {
      keepEl.textContent = money(best ? best.profit : 0);
      keepEl.className = best && best.profit >= 0 ? "keep-up" : "keep-down";
    }

    const colorMax = Math.max(x.spend.Green, x.spend.Red, x.spend.Violet, x.spend.Big, x.spend.Small, 0);
    const bars = $("#riskBars");
    if (bars) {
      bars.innerHTML =
        barRow("Green", x.spend.Green, colorMax, "green", x.colorHot === "Green") +
        barRow("Red", x.spend.Red, colorMax, "red", x.colorHot === "Red") +
        barRow("Violet", x.spend.Violet, colorMax, "violet", x.colorHot === "Violet") +
        barRow("Big", x.spend.Big, colorMax, "big", x.sizeHot === "Big") +
        barRow("Small", x.spend.Small, colorMax, "small", x.sizeHot === "Small");
    }

    const nums = $("#riskNums");
    if (nums) {
      const nMax = Math.max.apply(null, Array.from({ length: 10 }, (_, i) => x.spend[String(i)]));
      nums.innerHTML = Array.from({ length: 10 }, (_, n) => {
        const amt = x.spend[String(n)];
        const cls = [
          "risk-num",
          "n" + n,
          x.hotNumber === n ? "hot" : "",
          best && best.number === n ? "best" : ""
        ].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" data-number="${n}">
          <b>${n}</b><small>${money(amt)}</small>
        </button>`;
      }).join("");
    }

    const ball = $("#sugBall");
    const text = $("#sugText");
    const badges = $("#sugBadges");
    const why = $("#sugWhy");
    const applyBtn = $("#applySuggest");
    const sendBtn = $("#sendSuggest");
    if (!x.count) {
      if (ball) { ball.className = "preview-ball"; ball.textContent = "—"; }
      if (text) text.textContent = "Waiting for bets";
      if (badges) badges.innerHTML = "";
      if (why) why.textContent = "As soon as players bet on Green, Red, Violet, Big, Small or a number, the opposite / cheapest house result is shown here.";
      if (applyBtn) applyBtn.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      return;
    }

    const n = best.number;
    if (ball) { ball.className = "preview-ball " + ballClass(n); ball.textContent = n; }
    if (text) text.textContent = n + " · " + G.colorLabel(n) + " · " + G.sizeOf(n);
    if (badges) {
      badges.innerHTML =
        G.colorsOf(n).map((c) => `<span class="badge ${c}">${c}</span>`).join("") +
        `<span class="badge" style="background:#2b3344">${G.sizeOf(n)}</span>`;
    }
    const bits = [];
    if (x.colorHot) bits.push("most colour money is on " + x.colorHot + " (" + money(x.spend[x.colorHot]) + ")");
    if (x.sizeHot) bits.push("most size money is on " + x.sizeHot + " (" + money(x.spend[x.sizeHot]) + ")");
    if (x.hotNumber != null) bits.push("hottest number is " + x.hotNumber + " (" + money(x.hotNumberAmt) + ")");
    const opp = [];
    if (x.oppositeColor) opp.push(x.oppositeColor);
    if (x.oppositeSize) opp.push(x.oppositeSize);
    if (why) {
      why.textContent =
        (bits.length ? "Players loaded " + bits.join(", ") + ". " : "") +
        (opp.length ? "Opposite side: " + opp.join(" + ") + ". " : "") +
        "Cheapest house result is " + n + " · " + G.colorLabel(n) + " · " + G.sizeOf(n) +
        ". Payout " + money(best.payout) + " vs worst " + money(x.worst.payout) +
        " if you set " + x.worst.number + ".";
    }
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.dataset.suggest = String(n);
      applyBtn.textContent = "Use " + n + " · " + G.colorLabel(n);
    }
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.dataset.suggest = String(n);
    }
  }

  function renderDeposits() {
    const box = $("#depositTable");
    if (!box || !G.listDeposits) return;
    const list = G.listDeposits();
    if (!list.length) {
      box.innerHTML = '<tr><td colspan="6">No deposit requests yet.</td></tr>';
      return;
    }
    box.innerHTML = list.slice(0, 30).map((d) => {
      const when = d.at ? new Date(d.at).toLocaleString() : "—";
      const pending = d.status === "pending";
      const stClass = d.status === "approved" ? "active-flag" : d.status === "rejected" ? "banned-flag" : "";
      const actions = pending
        ? `<button type="button" data-approve-dep="${d.id}">Approve</button> <button type="button" data-reject-dep="${d.id}">Reject</button>`
        : "—";
      return `<tr>
        <td>${when}</td>
        <td>${d.uid || "—"}</td>
        <td>${money(d.amount)}</td>
        <td>${d.utr || "—"}</td>
        <td class="${stClass}">${d.status || "pending"}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("");
  }

  function utrStatus(msg, ok) {
    const el = $("#utrStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? "#18b566" : "#ff8b90";
  }

  function renderUtr() {
    const unusedBox = $("#utrUnusedTable");
    const usedBox = $("#utrUsedTable");
    if (!unusedBox || !G.listUtrCodes) return;
    const list = G.listUtrCodes();
    const unused = list.filter((c) => !c.used);
    const used = list.filter((c) => c.used);
    unusedBox.innerHTML = unused.length
      ? unused.slice(0, 40).map((c) => `<tr>
          <td><b>${c.code}</b></td>
          <td>${money(c.amount)}</td>
          <td>${c.at ? new Date(c.at).toLocaleString() : "—"}</td>
          <td><button type="button" data-copy-utr="${c.code}">Copy</button></td>
        </tr>`).join("")
      : '<tr><td colspan="4">No unused codes. Generate one above.</td></tr>';
    if (usedBox) {
      usedBox.innerHTML = used.length
        ? used.slice(0, 40).map((c) => `<tr>
            <td>${c.code}</td>
            <td>${money(c.amount)}</td>
            <td>${c.usedBy || "—"}</td>
            <td>${c.usedAt ? new Date(c.usedAt).toLocaleString() : "—"}</td>
          </tr>`).join("")
        : '<tr><td colspan="4">None used yet.</td></tr>';
    }
  }

  function makeUtr() {
    const amount = Number(($("#utrAmount") || {}).value || 0);
    const done = (rec) => {
      if (rec && rec.error) {
        utrStatus(rec.error, false);
        return;
      }
      const fresh = $("#utrFresh");
      if (fresh) fresh.hidden = false;
      const code = $("#utrFreshCode");
      const amt = $("#utrFreshAmt");
      if (code) code.textContent = rec.code;
      if (amt) amt.textContent = money(rec.amount);
      utrStatus("UTR " + rec.code + " for " + money(rec.amount) + " — give this to the player. Wallet is not credited yet.", true);
      renderUtr();
    };
    if (G.apiGenerateUtr) {
      G.apiGenerateUtr(amount).then(done).catch(() => utrStatus("Cannot reach server", false));
      return;
    }
    if (!G.generateUtr) return;
    done(G.generateUtr(amount));
  }

  function copyUtr(code) {
    const text = String(code || (($("#utrFreshCode") || {}).textContent || "")).trim();
    if (!text || text === "—") return utrStatus("Generate a UTR first", false);
    const done = () => utrStatus("Copied " + text, true);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => utrStatus(text, true));
    } else {
      utrStatus(text, true);
    }
  }

  function renderWithdrawals() {
    const box = $("#withdrawTable");
    if (!box || !G.listWithdrawals) return;
    const list = G.listWithdrawals();
    if (!list.length) {
      box.innerHTML = '<tr><td colspan="7">No withdraw requests yet.</td></tr>';
      return;
    }
    box.innerHTML = list.slice(0, 40).map((w) => {
      const when = w.at ? new Date(w.at).toLocaleString() : "—";
      const pending = w.status === "pending";
      const stClass = w.status === "approved" ? "active-flag" : w.status === "rejected" ? "banned-flag" : "";
      const actions = pending
        ? `<button type="button" data-approve-wd="${w.id}">Approve</button> <button type="button" data-reject-wd="${w.id}">Reject</button>`
        : "—";
      const acc = String(w.account || "");
      const accShort = acc.length > 4 ? "••••" + acc.slice(-4) : acc;
      return `<tr>
        <td>${when}</td>
        <td>${w.uid || "—"}</td>
        <td>${money(w.amount)}</td>
        <td>${w.bank || "—"}<br><small>${accShort}</small></td>
        <td>${w.name || "—"}<br><small>${w.ifsc || ""} · ${w.phone || ""}</small></td>
        <td class="${stClass}">${w.status || "pending"}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("");
  }

  function afterReview(rec) {
    if (rec && rec.error) {
      uidStatus(rec.error, false);
      return;
    }
    renderDeposits();
    renderWithdrawals();
    renderUsers();
    renderUtr();
    const card = $("#uidCard");
    if (card && !card.hidden && rec && rec.uid === card.dataset.uid) {
      const user = G.findUser(rec.uid);
      if (user) showUser(user);
    }
  }

  function reviewWithdraw(id, status) {
    if (G.apiReviewWithdraw) {
      G.apiReviewWithdraw(id, status).then(afterReview).catch(() => uidStatus("Cannot reach server", false));
      return;
    }
    if (!G.setWithdrawStatus) return;
    afterReview(G.setWithdrawStatus(id, status));
  }

  function reviewDeposit(id, status) {
    if (G.apiReviewDeposit) {
      G.apiReviewDeposit(id, status).then(afterReview).catch(() => uidStatus("Cannot reach server", false));
      return;
    }
    if (!G.setDepositStatus) return;
    afterReview(G.setDepositStatus(id, status));
  }

  function applySuggestion(send) {
    const btn = $("#applySuggest");
    const n = Number((btn && btn.dataset.suggest) != null ? btn.dataset.suggest : state.number);
    if (n >= 0 && n <= 9) {
      state.number = n;
      renderPreview();
      renderClock();
    }
    if (send) lockResult(false);
    else status("Suggested " + state.number + " · " + G.colorLabel(state.number) + " selected. Send when ready.", true);
  }

  function renderAll() {
    renderPreview();
    renderClock();
    renderQueue();
    renderHistory();
    renderUsers();
    renderRisk();
    renderDeposits();
    renderUtr();
    renderWithdrawals();
  }

  function targetPeriod() {
    const clk = G.clock(state.mode);
    if (state.target === "next" || clk.locked) {
      return { periodId: clk.nextPeriodId, period: clk.nextPeriod, label: "following period" };
    }
    return { periodId: clk.periodId, period: clk.period, label: "this period" };
  }

  function lockResult(forceNow) {
    const dest = targetPeriod();
    const payload = {
      mode: state.mode,
      periodId: dest.periodId,
      period: dest.period,
      number: state.number,
      target: state.target,
      forceNow: !!forceNow
    };
    const done = () => {
      renderQueue();
      renderHistory();
      status(
        "Sent to WinGo: " + state.number + " · " + G.colorLabel(state.number) +
          " · " + dest.period + (forceNow ? " (shown now)" : " (shows when timer ends)"),
        true
      );
    };
    if (G.apiLock) {
      G.apiLock(payload).then((rec) => {
        if (rec && rec.error) return status(rec.error, false);
        done();
      }).catch(() => status("Cannot reach server", false));
      return;
    }
    G.setOverride(state.mode, payload);
    G.setForce({
      id: Date.now() + "-" + Math.random().toString(16).slice(2),
      mode: state.mode,
      periodId: dest.periodId,
      number: state.number,
      revealNow: !!forceNow,
      at: Date.now()
    });
    done();
  }

  function bind() {
    $("#adminLogin").addEventListener("submit", (e) => {
      e.preventDefault();
      const user = $("#adminUser").value.trim();
      const pass = $("#adminPass").value;
      const fail = () => { $("#adminStatus").textContent = "Access denied. Admin only."; };
      if (G.apiAdminLogin) {
        $("#adminStatus").textContent = "Signing in…";
        G.apiAdminLogin(user, pass).then((rec) => {
          if (rec && rec.error) {
            $("#adminStatus").textContent = rec.error;
            return;
          }
          $("#adminStatus").textContent = "";
          enter();
        }).catch(fail);
        return;
      }
      if (user === ADMIN_USER && pass === ADMIN_PASS) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ok: true, at: Date.now() }));
        $("#adminStatus").textContent = "";
        enter();
      } else fail();
    });

    document.addEventListener("click", (e) => {
      const mode = e.target.closest("[data-mode]");
      if (mode) {
        state.mode = mode.dataset.mode;
        if (G.pullAdmin) G.pullAdmin(state.mode).then(() => renderAll()).catch(() => renderAll());
        else renderAll();
      }
      const num = e.target.closest("[data-number]");
      if (num) {
        state.number = Number(num.dataset.number);
        renderPreview();
        renderClock();
      }
      const col = e.target.closest("[data-color]");
      if (col) {
        const color = col.dataset.color;
        if (!G.colorsOf(state.number).includes(color)) {
          state.number = G.COLOR_NUMBERS[color][0];
        }
        renderPreview();
        renderClock();
      }
      const target = e.target.closest("[data-target]");
      if (target) {
        state.target = target.dataset.target;
        $$(".target").forEach((t) => t.classList.toggle("active", t === target));
        renderClock();
        renderRisk();
      }
      const clear = e.target.closest("[data-clear]");
      if (clear) {
        const mode = clear.dataset.clear;
        if (G.apiClear) {
          G.apiClear(mode).then(() => { renderQueue(); status("Queue cleared", true); });
        } else {
          G.clearOverride(mode);
          renderQueue();
          status("Queue cleared", true);
        }
      }
      const openUid = e.target.closest("[data-open-uid]");
      if (openUid) {
        $("#uidSearch").value = openUid.dataset.openUid;
        findUid();
      }
      const approveDep = e.target.closest("[data-approve-dep]");
      if (approveDep) reviewDeposit(approveDep.dataset.approveDep, "approved");
      const rejectDep = e.target.closest("[data-reject-dep]");
      if (rejectDep) reviewDeposit(rejectDep.dataset.rejectDep, "rejected");
      const approveWd = e.target.closest("[data-approve-wd]");
      if (approveWd) reviewWithdraw(approveWd.dataset.approveWd, "approved");
      const rejectWd = e.target.closest("[data-reject-wd]");
      if (rejectWd) reviewWithdraw(rejectWd.dataset.rejectWd, "rejected");
      const copyCode = e.target.closest("[data-copy-utr]");
      if (copyCode) copyUtr(copyCode.dataset.copyUtr);
    });

    const findBtn = $("#uidFind");
    if (findBtn) findBtn.addEventListener("click", findUid);
    const search = $("#uidSearch");
    if (search) search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findUid(); } });
    const addBtn = $("#uidAdd");
    if (addBtn) addBtn.addEventListener("click", () => changeMoney("add"));
    const remBtn = $("#uidRemove");
    if (remBtn) remBtn.addEventListener("click", () => changeMoney("remove"));
    const setBtn = $("#uidSet");
    if (setBtn) setBtn.addEventListener("click", () => changeMoney("set"));
    const banBtn = $("#uidBan");
    if (banBtn) banBtn.addEventListener("click", () => setBanned(true));
    const unbanBtn = $("#uidUnban");
    if (unbanBtn) unbanBtn.addEventListener("click", () => setBanned(false));

    const applySug = $("#applySuggest");
    if (applySug) applySug.addEventListener("click", () => applySuggestion(false));
    const sendSug = $("#sendSuggest");
    if (sendSug) sendSug.addEventListener("click", () => applySuggestion(true));
    const genUtr = $("#utrGenerate");
    if (genUtr) genUtr.addEventListener("click", makeUtr);
    const copyLast = $("#utrCopy");
    if (copyLast) copyLast.addEventListener("click", () => copyUtr());

    $("#lockBtn").addEventListener("click", () => lockResult(false));
    const nowBtn = $("#forceBtn");
    if (nowBtn) nowBtn.addEventListener("click", () => lockResult(true));
    $("#clearBtn").addEventListener("click", () => {
      if (G.apiClear) {
        G.apiClear(state.mode).then(() => { renderQueue(); status("Queue cleared", true); });
      } else {
        G.clearOverride(state.mode);
        renderQueue();
        status("Queue cleared", true);
      }
    });
    $("#adminLogout").addEventListener("click", () => {
      sessionStorage.removeItem(SESSION_KEY);
      $("#adminApp").hidden = true;
      $("#adminGate").hidden = false;
    });

    window.addEventListener("storage", renderAll);
    setInterval(() => {
      try {
        renderClock();
        renderQueue();
        renderHistory();
        renderUsers();
        renderRisk();
        renderDeposits();
        renderUtr();
        renderWithdrawals();
      } catch (err) {}
    }, 250);
  }

  function start() {
    try {
      bind();
      if (authed()) enter();
    } catch (err) {
      console.error("YOUWIN admin boot", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
