(function () {
  const G = window.YouWinGame;
  if (!G) {
    console.error("YOUWIN: game-core failed to load");
    return;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    mode: "30s",
    pick: null,
    stake: 1,
    unit: 1,
    qty: 1,
    multiplier: 1,
    lastSettled: {},
    shownResults: {},
    lastForceId: null,
    authMode: "login",
    authMethod: "phone"
  };

  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function wallet() {
    const me = G.me && G.me();
    if (me) return Number(me.wallet) || 0;
    return Number(G.read(G.KEYS.wallet, 0));
  }

  function setWallet(n) {
    const value = Math.max(0, Number(n) || 0);
    G.write(G.KEYS.wallet, value);
    renderWallet();
  }

  function renderWallet() {
    $$("[data-wallet]").forEach((el) => {
      el.textContent = money(wallet());
    });
  }

  function profile() {
    const me = G.me && G.me();
    if (me) {
      return { name: me.name || "YOUWIN USER", uid: me.uid, lastLogin: me.lastLogin || "—" };
    }
    return G.read(G.KEYS.profile, null) || {
      name: "YOUWIN USER",
      uid: "",
      lastLogin: "—"
    };
  }

  function saveProfile(p) {
    G.write(G.KEYS.profile, p);
  }

  function renderProfile() {
    const p = profile();
    const name = $("#profileName");
    const uid = $("#profileUid");
    const login = $("#lastLogin");
    if (name) name.textContent = p.name;
    if (uid) uid.textContent = p.uid;
    if (login) login.textContent = "Last login: " + p.lastLogin;
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    $$(".nav-item[data-nav]").forEach((n) => n.classList.toggle("active", n.dataset.nav + "Screen" === id));
  }

  function bets() {
    if (G.getOpenBets) return G.getOpenBets();
    return G.read(G.KEYS.bets, []);
  }

  function setBets(list) {
    G.write(G.KEYS.bets, list);
  }

  function history() {
    if (G.getPlayHistory) return G.getPlayHistory();
    return G.read(G.KEYS.history, []);
  }

  function pushHistory(item) {
    const list = history();
    list.unshift(item);
    G.write(G.KEYS.history, list.slice(0, 80));
  }

  function pickWins(pick, result) {
    const n = result.number;
    const colors = result.colors.map((c) => c.toLowerCase());
    if (pick === "Green") return colors.includes("green");
    if (pick === "Red") return colors.includes("red");
    if (pick === "Violet") return colors.includes("violet");
    if (pick === "Big") return n >= 5;
    if (pick === "Small") return n < 5;
    if (/^\d$/.test(String(pick))) return Number(pick) === n;
    return false;
  }

  function payoutRate(pick) {
    if (pick === "Green" || pick === "Red" || pick === "Big" || pick === "Small") return 1.98;
    if (pick === "Violet") return 5;
    if (/^\d$/.test(String(pick))) return 8;
    return 1.98;
  }

  function currentStake() {
    return state.stake * state.unit * state.qty * state.multiplier;
  }

  function setQty(n) {
    const value = Math.max(1, Math.min(99999, Math.floor(Number(n) || 1)));
    state.qty = value;
    const el = $("#betQuantity");
    if (el && String(el.value) !== String(value)) el.value = value;
    updateStakeUi();
    return value;
  }

  function updateStakeUi() {
    const amount = currentStake();
    const stakeEl = $("#stakeValue");
    const place = $("#placeBet");
    const confirm = $("#confirmBet");
    if (stakeEl) stakeEl.textContent = "₹" + amount;
    if (place) place.textContent = "Place pick · ₹" + amount;
    if (confirm) confirm.textContent = "Total amount ₹" + money(amount);
    const selected = $("#selectedPick");
    if (selected) selected.textContent = state.pick || "None yet";
  }

  function pickTone(pick) {
    const p = String(pick);
    if (p === "Green" || p === "1" || p === "3" || p === "7") return "green";
    if (p === "Red" || p === "2" || p === "6" || p === "8") return "red";
    if (p === "Violet" || p === "0" || p === "5") return "violet";
    if (p === "4") return "red";
    if (p === "9") return "green";
    if (p === "Big") return "big";
    if (p === "Small") return "small";
    return "red";
  }

  function pickOdds(pick) {
    const rate = payoutRate(pick);
    return "Odds 1:" + rate;
  }

  function setPick(pick, openSheet) {
    state.pick = String(pick);
    $$("[data-pick]").forEach((btn) => btn.classList.toggle("active", btn.dataset.pick === state.pick));
    updateStakeUi();
    if (openSheet !== false) openBetModal();
  }

  function openBetModal() {
    if (!state.pick) {
      toast("Select a colour, number or size first");
      return;
    }
    const clk = G.clock(state.mode);
    if (clk.locked) {
      toast("Betting is locked for this period");
      return;
    }
    $("#betModalTitle").textContent = G.MODES[state.mode].name;
    $("#betModalSelection").textContent = "Select " + state.pick;
    const odds = $("#betModalOdds");
    if (odds) odds.textContent = pickOdds(state.pick);
    const head = document.querySelector(".bet-sheet-head");
    if (head) head.className = "bet-sheet-head " + pickTone(state.pick);
    $("#betModal").hidden = false;
    setQty(state.qty);
    updateStakeUi();
  }

  function closeBetModal() {
    $("#betModal").hidden = true;
  }

  function placeBet() {
    if (!$("#agreeRules").checked) {
      toast("Please agree to the rules");
      return;
    }
    const clk = G.clock(state.mode);
    if (clk.locked) {
      toast("Betting is locked for this period");
      closeBetModal();
      return;
    }
    const amount = currentStake();
    if (amount <= 0) return;
    if (wallet() < amount) {
      toast("Not enough balance");
      return;
    }
    if (!G.apiBet) {
      toast("Server not ready");
      return;
    }
    G.apiBet({ mode: state.mode, pick: state.pick, amount }).then((data) => {
      if (data && data.error) return toast(data.error);
      closeBetModal();
      renderWallet();
      toast("Pick placed on " + state.pick + " · ₹" + money(amount));
    }).catch(() => toast("Cannot reach server"));
  }

  function settleOpenBets(result) {
    const mine = history().filter((h) => h.mode === result.mode && Number(h.periodId) === Number(result.periodId));
    let won = 0;
    let lost = 0;
    let payout = 0;
    mine.forEach((h) => {
      if (h.hit) {
        won += 1;
        payout += Number(h.payout) || 0;
      } else {
        lost += 1;
      }
    });
    renderWallet();
    return { won, lost, payout };
  }

  function renderResults() {
    G.ensureHistory(state.mode, 8);
    const list = G.getResults(state.mode).slice(0, 10);
    const row = $("#resultRow");
    if (!row) return;
    row.innerHTML = list
      .map((r) => `<span class="result ${G.resultClass(r.number)}">${r.number}</span>`)
      .join("");
    const last = list[0];
    const line = $("#roundResult");
    if (line) {
      line.textContent = last
        ? "Last: " + last.number + " · " + G.colorLabel(last.number) + " · " + last.size
        : "No completed round yet";
    }
  }

  function renderMine() {
    const box = $("#mineList");
    if (!box) return;
    const items = history().filter((h) => h.mode === state.mode);
    if (!items.length) {
      box.innerHTML = '<p class="empty-tip">No picks this mode yet.</p>';
      return;
    }
    box.innerHTML = items.slice(0, 12).map((h) => {
      const cls = (h.resultColors && h.resultColors[0]) || "green";
      return `<div class="history-card">
        <div><span class="history-game-dot ${cls}-dot">W</span>
        <span><strong>${h.pick}</strong><small>${h.period}</small></span></div>
        <b class="history-result ${cls}-text">${h.resultNumber == null ? "…" : h.resultNumber}</b>
        <span class="history-time">${h.hit ? "Win ₹" + money(h.payout) : "Lose ₹" + money(h.amount)}</span>
      </div>`;
    }).join("");
  }

  function renderActivity() {
    const box = $("#activityList");
    if (!box) return;
    const items = history();
    if (!items.length) {
      box.innerHTML = '<div class="empty-tip"><p>No picks yet. Open WinGo to play a round.</p></div>';
      return;
    }
    box.innerHTML = items
      .slice(0, 12)
      .map((h) => {
        const cls = (h.resultColors && h.resultColors[0]) || "green";
        return `<div class="history-card">
          <div><span class="history-game-dot ${cls}-dot">W</span>
          <span><strong>${G.MODES[h.mode].name}</strong><small>Period ${h.period} · Pick ${h.pick}</small></span></div>
          <b class="history-result ${cls}-text">${h.resultNumber}</b>
          <span class="history-time">${h.hit ? "Win ₹" + money(h.payout) : "Lose ₹" + money(h.amount)}</span>
        </div>`;
      })
      .join("");
  }

  function resultKey(result) {
    return result.mode + ":" + result.periodId;
  }

  function hideResult() {
    const overlay = $("#resultOverlay");
    if (overlay) overlay.hidden = true;
    clearTimeout(hideResult._t);
  }

  function showResult(result, settlement) {
    const overlay = $("#resultOverlay");
    const meta = $("#resultMeta");
    const title = $("#resultTitle");
    const period = $("#resultPeriodLabel");
    const bonus = $("#resultBonus");
    if (!overlay) return;
    const won = !!(settlement && settlement.won);
    overlay.className = "result-overlay " + (won ? "is-win" : "is-lose");
    if (title) title.textContent = won ? "Congratulations on your winning" : "Better luck next time";
    if (meta) {
      meta.innerHTML =
        result.colors.map((c) => `<span class="result-chip ${c}">${c}</span>`).join("") +
        `<span class="result-chip num">${result.number}</span>` +
        `<span class="result-chip ${result.size.toLowerCase()}">${result.size}</span>`;
    }
    if (bonus) bonus.textContent = "₹" + money(won ? settlement.payout : 0);
    if (period) period.textContent = "Issue: " + G.MODES[result.mode].name + " " + result.period;
    overlay.hidden = false;
    clearTimeout(hideResult._t);
    hideResult._t = setTimeout(hideResult, 2000);
  }

  function isGameOpen(mode) {
    const app = $("#mainApp");
    const game = $("#gameScreen");
    if (!app || app.hidden) return false;
    if (!game || !game.classList.contains("active")) return false;
    if (mode && mode !== state.mode) return false;
    return true;
  }

  function reveal(result, forcePopup) {
    const key = resultKey(result);
    const settlement = settleOpenBets(result);
    renderResults();
    renderActivity();
    renderWallet();
    renderAdminBanner();
    if (state.shownResults[key]) return settlement;
    state.shownResults[key] = true;
    const played = !!(settlement && (settlement.won || settlement.lost));
    if (forcePopup || (isGameOpen(result.mode) && played)) {
      showResult(result, settlement);
    }
    return settlement;
  }

  function renderAdminBanner() {
    const banner = $("#adminSetBanner");
    const preview = $("#adminSetPreview");
    if (!banner) return;
    const queued = G.peekOverride(state.mode);
    if (queued) {
      banner.hidden = false;
      if (preview) preview.textContent = queued.number + " · " + G.colorLabel(queued.number);
    } else {
      banner.hidden = true;
    }
  }

  function applyForce() {
    const force = G.readForce();
    if (!force || !force.id || force.id === state.lastForceId) return;
    if (force.mode && force.mode !== state.mode) return;
    state.lastForceId = force.id;
    renderAdminBanner();
    const periodId = force.periodId != null ? Number(force.periodId) : G.clock(state.mode).periodId;
    const result = G.getResults(force.mode || state.mode).find((r) => Number(r.periodId) === periodId);
    if (result && result.source !== "pending") reveal(result, isGameOpen(result.mode));
  }

  function tick() {
    const clk = G.clock(state.mode);
    const timer = $("#timer");
    const period = $("#period");
    const msg = $("#roundMessage");
    const status = $("#roundStatus");
    const box = $("#gameTitle");
    const place = $("#placeBet");
    const clockText = G.formatTime(clk.remaining);
    if (timer) timer.textContent = clockText;
    const digits = $("#timerDigits");
    if (digits) {
      const parts = clockText.replace(":", "").split("");
      digits.innerHTML = "<b>" + parts[0] + "</b><b>" + parts[1] + "</b><i>:</i><b>" + parts[2] + "</b><b>" + parts[3] + "</b>";
    }
    if (period) period.textContent = clk.period;
    if (status) status.classList.toggle("locked", clk.locked);
    if (box) box.classList.toggle("is-locked", clk.locked);
    if (msg) msg.textContent = clk.locked ? "Betting locked" : "Betting is open";
    if (place) place.disabled = clk.locked || !state.pick;

    renderAdminBanner();
    applyForce();

    Object.keys(G.MODES).forEach((mode) => {
      const c = G.clock(mode);
      const prev = state.lastSettled[mode];
      if (prev == null) {
        state.lastSettled[mode] = c.periodId;
        return;
      }
      if (c.periodId !== prev) {
        const result = G.getResults(mode).find((r) => Number(r.periodId) === Number(prev));
        state.lastSettled[mode] = c.periodId;
        if (result && result.source !== "pending") reveal(result);
      }
    });
    if (clk.periodId === state.lastSettled[state.mode]) renderResults();
  }

  function setMode(mode) {
    state.mode = mode;
    $$(".round-tab").forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle("active", on);
      const orb = t.querySelector(".round-orb");
      if (orb) orb.className = "round-orb " + (on ? "red-orb" : "grey-orb");
    });
    $("#roundModeName").textContent = G.MODES[mode].short;
    $("#betGameName").textContent = G.MODES[mode].name;
    renderResults();
    tick();
  }

  function syncAccount() {
    const p = G.read(G.KEYS.profile, null);
    if (!p || !p.uid) return;
    const u = G.findUser(p.uid);
    if (!u) return;
    if (u.banned) {
      toast("This UID is banned");
      logout();
      return true;
    }
    if (Number(u.wallet) !== wallet()) {
      G.write(G.KEYS.wallet, Number(u.wallet) || 0);
      renderWallet();
    }
    if (u.name && u.name !== p.name) {
      p.name = u.name;
      saveProfile(p);
      renderProfile();
    }
    return false;
  }

  function ensureUserRecord() {}

  function enterApp() {
    if (syncAccount()) return;
    $("#authGate").hidden = true;
    $("#mainApp").hidden = false;
    renderWallet();
    renderProfile();
    renderResults();
    renderActivity();
    tick();
  }

  function logout() {
    localStorage.removeItem(G.KEYS.auth);
    $("#mainApp").hidden = true;
    $("#authGate").hidden = false;
    toast("Signed out");
  }

  function handleAuth(e) {
    e.preventDefault();
    const identity = $("#authIdentity").value.trim();
    const password = $("#authPassword").value;
    const status = $("#authStatus");
    if (!identity || password.length < 4) {
      status.textContent = "Enter a valid phone/email and a password of 4+ characters.";
      return;
    }
    const fn = state.authMode === "register" ? G.apiRegister : G.apiLogin;
    if (!fn) {
      status.textContent = "Server not ready";
      return;
    }
    status.textContent = "Please wait…";
    fn(identity, password).then((data) => {
      if (data && data.error) {
        status.textContent = data.error;
        return;
      }
      status.textContent = "";
      G.pullPlay().then(() => {
        enterApp();
        toast(state.authMode === "register" ? "New account · ₹0.00" : "Welcome back");
      });
    }).catch(() => {
      status.textContent = "Cannot reach server";
    });
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-auth-method]");
      if (tab) {
        state.authMethod = tab.dataset.authMethod;
        $$(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
        const phone = state.authMethod === "phone";
        $("#identityLabel").textContent = phone ? "Phone number" : "Email";
        $("#authIdentity").type = phone ? "tel" : "email";
        $("#authIdentity").placeholder = phone ? "Please enter the phone number" : "Please enter your email";
        $("#countryCode").style.display = phone ? "" : "none";
      }

      const nav = e.target.closest("[data-nav]");
      if (nav) showScreen(nav.dataset.nav + "Screen");

      const open = e.target.closest("[data-open]");
      if (open && open.dataset.open === "game") showScreen("gameScreen");

      const modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) setMode(modeBtn.dataset.mode);

      const pickBtn = e.target.closest("[data-pick]");
      if (pickBtn) setPick(pickBtn.dataset.pick);

      const hist = e.target.closest("[data-hist]");
      if (hist) {
        $$("[data-hist]").forEach((b) => b.classList.toggle("active", b === hist));
        const tab = hist.dataset.hist;
        const g = $("#histGame");
        const c = $("#histChart");
        const m = $("#histMine");
        if (g) g.hidden = tab !== "game";
        if (c) c.hidden = tab !== "chart";
        if (m) m.hidden = tab !== "mine";
        if (tab === "mine") renderMine();
      }

      const stakeBtn = e.target.closest("[data-stake]");
      if (stakeBtn) {
        state.stake = Number(stakeBtn.dataset.stake);
        $$(".multiplier").forEach((b) => b.classList.toggle("active", b === stakeBtn));
        updateStakeUi();
      }

      const bal = e.target.closest("[data-balance]");
      if (bal) {
        state.unit = Number(bal.dataset.balance);
        $$(".balance-choice").forEach((b) => b.classList.toggle("active", b === bal));
        updateStakeUi();
      }

      const mul = e.target.closest("[data-bet-multiplier]");
      if (mul) {
        state.multiplier = Number(mul.dataset.betMultiplier);
        $$(".bet-multiplier").forEach((b) => b.classList.toggle("active", b === mul));
        updateStakeUi();
      }

      const dep = e.target.closest("[data-deposit-amount]");
      if (dep) {
        $("#depositAmount").value = dep.dataset.depositAmount;
        $$(".deposit-amount-choice").forEach((b) => b.classList.toggle("active", b === dep));
      }

      const action = e.target.closest("[data-action]");
      if (!action) return;
      const act = action.dataset.action;
      if (act === "back") showScreen("homeScreen");
      if (act === "history") {
        showScreen("activityScreen");
        renderActivity();
      }
      if (act === "support" || act === "detail" || act === "settings" || act === "notifications" || act === "gifts" || act === "stats" || act === "language" || act === "vip" || act === "transactions" || act === "deposit-history" || act === "withdraw-history" || act === "filter" || act === "pre-sale") {
        toast("Coming soon");
      }
      if (act === "refresh") {
        if (G.pullPlay) {
          G.pullPlay().then(() => {
            renderWallet();
            renderProfile();
            toast("Balance refreshed");
          });
        } else {
          renderWallet();
          toast("Balance refreshed");
        }
      }
      if (act === "withdraw" || act === "withdraw-modal") {
        $("#walletModal").hidden = true;
        $("#modalBackdrop").hidden = true;
        const wm = $("#withdrawModal");
        if (wm) wm.hidden = false;
      }
      if (act === "deposit" || act === "deposit-modal") {
        $("#walletModal").hidden = true;
        $("#modalBackdrop").hidden = true;
        $("#depositModal").hidden = false;
      }
      if (act === "wallet") {
        $("#walletModal").hidden = false;
        $("#modalBackdrop").hidden = false;
      }
      if (act === "close-modal") {
        $("#walletModal").hidden = true;
        $("#modalBackdrop").hidden = true;
      }
      if (act === "how") $("#howModal").hidden = false;
      if (act === "close-how") $("#howModal").hidden = true;
      if (act === "close-bet") closeBetModal();
      if (act === "close-name") $("#nameModal").hidden = true;
      if (act === "close-deposit") $("#depositModal").hidden = true;
      if (act === "close-withdraw") {
        const wm = $("#withdrawModal");
        if (wm) wm.hidden = true;
      }
      if (act === "close-result") hideResult();
      if (act === "edit-name") {
        $("#nameInput").value = profile().name;
        $("#nameModal").hidden = false;
      }
      if (act === "save-name") {
        const name = $("#nameInput").value.trim();
        if (G.apiProfile) {
          G.apiProfile(name).then((data) => {
            if (data && data.error) return toast(data.error);
            renderProfile();
            $("#nameModal").hidden = true;
            toast("Name saved");
          });
        } else {
          const p = profile();
          p.name = name || p.name;
          saveProfile(p);
          renderProfile();
          $("#nameModal").hidden = true;
          toast("Name saved");
        }
      }
      if (act === "copy") {
        const id = profile().uid;
        navigator.clipboard.writeText(id).then(() => toast("UID copied")).catch(() => toast(id));
      }
      if (act === "copy-upi") {
        navigator.clipboard.writeText("9332521547@yespop").then(() => toast("UPI ID copied")).catch(() => toast("9332521547@yespop"));
      }
      if (act === "submit-deposit") {
        const amt = Number($("#depositAmount").value || 0);
        const utr = ($("#utrInput").value || "").trim();
        if (amt < 1) return toast("Enter an amount");
        if (!utr) return toast("Enter UTR / reference");
        const p = profile();
        const auth = G.read(G.KEYS.auth, null);
        const rec = G.submitDeposit({
          uid: p.uid || (auth && auth.uid) || "",
          identity: (auth && auth.identity) || "",
          amount: amt,
          utr
        });
        if (rec && rec.error) return toast(rec.error);
        $("#depositModal").hidden = true;
        $("#utrInput").value = "";
        if (rec.status === "approved") {
          const u = G.findUser(p.uid || (auth && auth.uid) || "");
          if (u) {
            G.write(G.KEYS.wallet, Number(u.wallet) || 0);
            renderWallet();
          }
          toast("₹" + money(amt) + " added to wallet");
        } else {
          toast("Deposit submitted. Waiting for confirmation.");
        }
      }
      if (act === "submit-withdraw") {
        const p = profile();
        const auth = G.read(G.KEYS.auth, null);
        const rec = G.submitWithdraw({
          uid: p.uid || (auth && auth.uid) || "",
          identity: (auth && auth.identity) || "",
          amount: Number(($("#wdAmount") || {}).value || 0),
          bank: ($("#wdBank") || {}).value || "",
          name: ($("#wdName") || {}).value || "",
          account: ($("#wdAccount") || {}).value || "",
          phone: ($("#wdPhone") || {}).value || "",
          email: ($("#wdEmail") || {}).value || "",
          ifsc: ($("#wdIfsc") || {}).value || ""
        });
        const st = $("#wdStatus");
        if (rec && rec.error) {
          if (st) st.textContent = rec.error;
          return toast(rec.error);
        }
        if (st) st.textContent = "";
        const u = G.findUser(p.uid || (auth && auth.uid) || "");
        if (u) {
          G.write(G.KEYS.wallet, Number(u.wallet) || 0);
          renderWallet();
        }
        const wm = $("#withdrawModal");
        if (wm) wm.hidden = true;
        toast("Withdraw request submitted");
      }
      if (act === "random") {
        setPick(String(Math.floor(Math.random() * 10)));
      }
      if (act === "claim") toast("Reward claimed");
      if (act === "share") toast("Invite link copied");
      if (act === "logout") logout();
      if (act === "bet-minus") setQty(state.qty - 1);
      if (act === "bet-plus") setQty(state.qty + 1);
    });

    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on("#placeBet", "click", openBetModal);
    on("#confirmBet", "click", placeBet);
    on("#authForm", "submit", handleAuth);
    on("#authRegisterSwitch", "click", () => {
      state.authMode = state.authMode === "login" ? "register" : "login";
      $("#authTitle").textContent = state.authMode === "login" ? "Log in" : "Register";
      $("#authSubmit").textContent = state.authMode === "login" ? "Log in" : "Register";
      $("#authRegisterSwitch").textContent = state.authMode === "login" ? "Register" : "Have an account? Log in";
    });
    on("#passwordToggle", "click", () => {
      const input = $("#authPassword");
      if (input) input.type = input.type === "password" ? "text" : "password";
    });
    on("#betQuantity", "input", () => {
      const el = $("#betQuantity");
      if (!el) return;
      const raw = el.value;
      if (raw === "") return;
      state.qty = Math.max(1, Math.min(99999, Math.floor(Number(raw) || 1)));
      updateStakeUi();
    });
    on("#betQuantity", "blur", () => setQty($("#betQuantity") ? $("#betQuantity").value : 1));
    on("#forgotAuth", "click", () => toast("Please contact customer service"));
    on("#modalBackdrop", "click", () => {
      const w = $("#walletModal");
      const b = $("#modalBackdrop");
      if (w) w.hidden = true;
      if (b) b.hidden = true;
    });

    window.addEventListener("storage", () => {
      if (syncAccount()) return;
      renderResults();
      renderWallet();
      renderAdminBanner();
      applyForce();
    });
    window.addEventListener("youwin-store", () => {
      renderAdminBanner();
      applyForce();
    });
    const ch = G.channel();
    if (ch) {
      ch.addEventListener("message", () => {
        renderResults();
        renderAdminBanner();
        applyForce();
      });
    }
  }

  function boot() {
    try {
      bind();
      updateStakeUi();
      const start = () => {
        if (G.read(G.KEYS.auth, null)) enterApp();
      };
      if (G.pullPlay) {
        G.pullPlay().then(start).catch(start);
      } else start();
      if (G.listenLive) {
        G.listenLive(() => {
          if (!G.pullPlay) return;
          G.pullPlay().then(() => {
            renderWallet();
            renderResults();
            renderActivity();
            renderAdminBanner();
            applyForce();
          });
        });
      }
      setInterval(function () {
        try { tick(); } catch (err) { console.error("YOUWIN tick", err); }
      }, 250);
      setInterval(function () {
        if (G.pullPlay) G.pullPlay().then(() => { renderWallet(); renderResults(); }).catch(() => {});
      }, 2000);
    } catch (err) {
      console.error("YOUWIN boot", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
