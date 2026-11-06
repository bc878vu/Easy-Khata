/* Easy Khata — food money ledger.
   Vanilla JS + Supabase (GoTrue auth + PostgREST), the proven pattern
   from Diesel Converter. No framework, no eval. */
(function () {
  "use strict";
  var cfg = window.EASY_KHATA_CONFIG || {};
  var API = cfg.SUPABASE_URL;
  var ANON = cfg.SUPABASE_ANON_KEY;
  var SESSION_KEY = "easykhata_auth";
  var ADMIN_EMAIL = cfg.ADMIN_EMAIL || "";
  var APP_URL = "https://easy-khata-asad2327s-projects.vercel.app";
  // v21: share messages mein ab DIRECT app URL — is.gd short link se WhatsApp
  // par koi preview nahi banta tha aur user ke phone par link kaam bhi nahi kar
  // raha tha; direct URL + index.html ke OG tags se ab preview card banta hai.
  var APP_SHORT_URL = APP_URL;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtRs(n) {
    var v = Math.round(Number(n) * 100) / 100;
    return "Rs " + v.toLocaleString("en-US");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    return p[2] + "-" + p[1] + "-" + p[0];
  }
  function fmtDateLong(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Number(p[2]) + " " + months[Number(p[1]) - 1] + " " + p[0];
  }
  function monthName(iso) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var p = String(iso || "").slice(0, 7).split("-");
    if (p.length < 2) return "";
    return months[Number(p[1]) - 1] + " " + p[0];
  }
  /* Pakistani number to WhatsApp format: 03001234567 -> 923001234567 */
  function normPhone(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("92") === 0 && d.length === 12) return d;
    if (d.charAt(0) === "0" && d.length === 11) return "92" + d.slice(1);
    if (d.length === 10 && d.charAt(0) === "3") return "92" + d;
    return "";
  }
  function waLink(phone, text) {
    return "https://wa.me/" + normPhone(phone) + "?text=" + encodeURIComponent(text);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); resolve(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  /* ---------- session ---------- */
  var session = null;
  try {
    var stored = window.localStorage.getItem(SESSION_KEY);
    if (stored) session = JSON.parse(stored);
  } catch (e) { session = null; }
  function saveSession(s) {
    session = s || null;
    try {
      if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function myId() { return session && session.user ? session.user.id : ""; }
  function isAdmin() {
    return !!ADMIN_EMAIL && session && session.user && session.user.email === ADMIN_EMAIL;
  }
  function myName() {
    if (!session || !session.user) return "";
    var m = session.user.user_metadata || {};
    return m.full_name || session.user.email || "";
  }
  function authToken() { return session && session.access_token ? session.access_token : ANON; }

  /* ---------- Supabase helpers ---------- */
  function authCall(path, body) {
    return fetch(API + "/auth/v1" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON,
        "Authorization": "Bearer " + ANON
      },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  function sb(path, opts) {
    opts = opts || {};
    var headers = {
      "apikey": ANON,
      "Authorization": "Bearer " + authToken(),
      "Content-Type": "application/json"
    };
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    return fetch(API + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        return { ok: r.ok, status: r.status, body: j, raw: t };
      });
    });
  }

  /* ---------- state ---------- */
  var profiles = [];   // {id, name, email, phone}
  var txns = [];       // {id, payer_id, receiver_id, amount, note, txn_date, created_by, created_at}
  var adminUsers = []; // admin_list_users RPC rows {id, name, email, phone, created_at, blocked, records}
  var adminCurrentUser = null;
  var dbReady = false;
  var authMode = "login";
  var editingId = null;
  var txnSearchText = "";
  var txnFilterPerson = "";
  var txnFromDate = "";
  var txnToDate = "";
  var splitMode = false;
  var myPhone = "";
  var detailPersonId = null;
  var peopleSearchText = "";

  /* ---------- offline mode + sync (v22) ----------
     Internet na ho to data localStorage mein save hota hai aur app poori
     tarah offline chalti hai; online hote hi outbox sync ho jata hai.
     Admin kaam (RPCs) online-only hain — un ke liye internet chahiye. */
  var offlineMode = false;   // true jab cache se dikhaya ja raha ho
  var syncing = false;       // flushOutbox guard (ek waqt mein aik sync)
  var CACHE_KEY = "easykhata_cache_v1";
  var OUTBOX_KEY = "easykhata_outbox_v1";
  var OUTBOX_MAX = 200;
  function newUuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function isOffline() { return !navigator.onLine; }
  function loadOutbox() {
    try {
      var raw = window.localStorage.getItem(OUTBOX_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveOutbox(ops) {
    try { window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops || [])); } catch (e) {}
    renderOffline();
  }
  function queueOp(op) {
    var ops = loadOutbox();
    ops.push(op);
    if (ops.length > OUTBOX_MAX) {
      ops = ops.slice(ops.length - OUTBOX_MAX);
      try { console.warn("Easy Khata: outbox full — sab se purane ops hata diye."); } catch (e) {}
    }
    saveOutbox(ops);
  }
  function saveCache() {
    // Khali data se acha cache kharab na ho — sirf tab save karein jab
    // profiles maujood hon (kamyab load ka nishan). Naya user bhi apni
    // profile rakhta hai, is liye kamyab load par profiles hamesha non-empty
    // hoti hai; loadNotifs/loadContacts loadAll se pehle chal jayein to bhi
    // cache mehfooz rehta hai.
    if (!profiles || !profiles.length) return;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        profiles: profiles, txns: txns, contacts: myContacts, notifs: notifs, savedAt: Date.now()
      }));
    } catch (e) {}
  }
  function loadCache() {
    try {
      var raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !Array.isArray(c.profiles) || !Array.isArray(c.txns)) return null;
      return c;
    } catch (e) { return null; }
  }
  // Pending insert hata dein (server par kabhi gaya hi nahi) — delete/update op nahi chahiye.
  function removePendingInsert(table, id) {
    var ops = loadOutbox();
    var kept = [], removed = false;
    ops.forEach(function (o) {
      if (o.op === "insert" && o.table === table && o.id === id) removed = true;
      else kept.push(o);
    });
    if (removed) saveOutbox(kept);
    return removed;
  }

  function profileName(id) {
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === id) return profiles[i].name || profiles[i].email || "Unknown";
    }
    for (var j = 0; j < myContacts.length; j++) {
      if (myContacts[j].id === id) return myContacts[j].name || "Unknown";
    }
    return id === myId() ? myName() : "Naam nahi mila";
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var a = parts[0].charAt(0);
    var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }
  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return "";
      var h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
      var ap = h >= 12 ? "PM" : "AM";
      var hh = h % 12; if (hh === 0) hh = 12;
      return hh + ":" + m + " " + ap;
    } catch (e) { return ""; }
  }
  function peopleMap() {
    // Shared per-person totals (given/taken + first/last transaction date).
    var me = myId();
    var map = {};
    profiles.forEach(function (p) {
      if (p.id !== me) map[p.id] = { name: p.name || p.email, phone: p.phone || "", given: 0, taken: 0, first: null, last: null };
    });
    myContacts.forEach(function (c) {
      map[c.id] = { name: c.name || "Unknown", phone: c.phone || "", given: 0, taken: 0, manual: true, first: null, last: null };
    });
    function bump(p, d) {
      if (!d) return;
      if (!p.first || d < p.first) p.first = d;
      if (!p.last || d > p.last) p.last = d;
    }
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var d = String(t.txn_date || "");
      if (t.payer_id === me && map[t.receiver_id]) { map[t.receiver_id].given += a; bump(map[t.receiver_id], d); }
      if (t.receiver_id === me && map[t.payer_id]) { map[t.payer_id].taken += a; bump(map[t.payer_id], d); }
    });
    return map;
  }
  function personTxns(id) {
    // This person's records, newest first (txns are already sorted desc).
    return txns.filter(function (t) { return t.payer_id === id || t.receiver_id === id; });
  }

  /* ---------- settled-history lock ----------
     Jo hisaab settle ho jaye, woh history mein save rehta hai — edit/delete nahi ho sakta.
     Rule: settlement record (note "Settled up" se shuru) hamesha locked.
     Har dost ke liye: un ki LATEST settlement ki date nikalo; us date tak ke (aur us se
     pehle ke) saare records locked history hain. Us date ke BAAD ke records normal hain
     (editable/deletable) — agle settlement tak. Net 0 bina settlement ke lock NAHI karta. */
  var lockedCache = null;
  function isSettlementNote(note) {
    return String(note || "").indexOf("Settled up") === 0;
  }
  function pairKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }
  function computeLockedIds() {
    // Per unordered pair of people: latest settlement date; every record of that
    // pair dated on/before it is locked history. Settlement rows are always locked.
    var latestByPair = {};
    txns.forEach(function (t) {
      if (!isSettlementNote(t.note)) return;
      var d = String(t.txn_date || "");
      var k = pairKey(t.payer_id, t.receiver_id);
      if (d && (!latestByPair[k] || d > latestByPair[k])) latestByPair[k] = d;
    });
    var locked = {};
    txns.forEach(function (t) {
      if (isSettlementNote(t.note)) { locked[t.id] = true; return; }
      var latest = latestByPair[pairKey(t.payer_id, t.receiver_id)];
      if (latest && String(t.txn_date || "") <= latest) locked[t.id] = true;
    });
    return locked;
  }
  function isTxnLocked(t) {
    if (!t) return false;
    if (!lockedCache) lockedCache = computeLockedIds();
    return !!lockedCache[t.id];
  }
  var LOCK_MSG = "Settled hisaab ko edit/delete nahi kar sakte — ye history hai.";

  /* ---------- auth UI ---------- */
  function setAuthMsg(text, ok) {
    var el = $("authMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function setTxnMsg(text, ok) {
    var el = $("txnMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function renderAuthMode() {
    $("tabLogin").className = "tab" + (authMode === "login" ? " active" : "");
    $("tabSignup").className = "tab" + (authMode === "signup" ? " active" : "");
    $("signupNameRow").hidden = authMode !== "signup";
    $("signupPhoneRow").hidden = authMode !== "signup";
    $("forgotRow").hidden = authMode !== "login";
    $("authSubmitBtn").textContent = authMode === "signup" ? "Account banayein" : "Login karein";
    $("authPassword").setAttribute("autocomplete", authMode === "signup" ? "new-password" : "current-password");
    setAuthMsg("");
  }
  function hideSplash() {
    // Splash sirf tab chhupta hai jab app ready ho (auth ya khata dikhe).
    // 6-second inline fallback bhi hai (index.html) agar JS atak jaye.
    var s = $("splash");
    if (s) s.classList.add("hide");
  }
  function showAuth() {
    hideSplash();
    teardownRealtime();
    if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
    $("authWrap").hidden = false;
    $("appShell").hidden = true;
    $("authBox").hidden = false;
    $("fabAdd").hidden = true;
    $("authForm").hidden = false;
    $("forgotBox").hidden = true;
    $("resetBox").hidden = true;
    renderAuthMode();
  }
  function showApp() {
    hideSplash();
    $("authWrap").hidden = true;
    $("appShell").hidden = false;
    renderAccount();
    showView("khata");
    $("txnDate").value = todayLocal();
    loadNotifs();
    refreshPushState().then(function () { maybeAskPushPermission(); });
    setupRealtime();
    try {
      var view = new URLSearchParams(window.location.search).get("view");
      if (view === "notifs") {
        window.history.replaceState(null, "", window.location.pathname);
        showNotifView();
      }
    } catch (e) {}
    if (notifTimer) clearInterval(notifTimer);
    notifTimer = setInterval(function () { if (session) loadNotifs(); }, 30000);
  }
  /* ---------- views (bottom nav: Khata | Account) ---------- */
  var currentView = "khata";
  function showView(name) {
    currentView = name;
    $("khataView").hidden = name !== "khata";
    $("personDetailView").hidden = name !== "detail";
    $("accountView").hidden = name !== "account";
    $("notifView").hidden = name !== "notifs";
    $("adminView").hidden = name !== "admin";
    $("adminUserView").hidden = name !== "adminUser";
    $("navKhata").classList.toggle("active", name === "khata" || name === "detail");
    $("navAccount").classList.toggle("active", name === "account" || name === "admin" || name === "adminUser");
    $("fabAdd").hidden = name !== "khata";
    window.scrollTo(0, 0);
  }
  function showAppView() {
    showView("khata");
  }
  function showAdminView() {
    if (!isAdmin()) return;
    showView("admin");
    renderAdmin();
  }

  function authErrorText(res) {
    // Show the server's real reason — a generic line had hidden the real error (2026-11-05).
    var raw = res.body && (res.body.msg || res.body.message || res.body.error_description || res.body.error);
    var m = typeof raw === "string" ? raw : "";
    if (/invalid login/i.test(m)) return "Email ya password ghalat hai.";
    if (/already registered|already exists/i.test(m)) return "Is email par account pehle se hai — login karein.";
    if (/email not confirmed/i.test(m)) return "Email confirm nahi hui — inbox mein confirmation link check karein, phir login karein.";
    if (/only request this after|too many requests|rate limit/i.test(m) || res.status === 429) return "Thori der ruk kar dobara try karein.";
    if (/sending.*(mail|email)|confirmation.*(mail|email)|smtp/i.test(m)) return "Confirmation email bhejne mein masla hua — thori der baad dobara try karein.";
    if (/password/i.test(m) && /short|least|6/i.test(m)) return "Password kam se kam 6 harf ka ho.";
    if (/email/i.test(m) && /invalid/i.test(m)) return "Sahi email likhein.";
    if (!m) { try { console.warn("EasyKhata auth error", res.status, res.body); } catch (e) {} }
    return m || "Kuch ghalat ho gaya — dobara try karein.";
  }

  function ensureProfile() {
    var u = session.user;
    // Check first: if the profile already exists, leave it alone.
    // (Old code overwrote it on every login with the signup-time name/number —
    // a number changed in settings reverted to the old one on next login.)
    return sb("khata_profiles?id=eq." + encodeURIComponent(u.id) + "&select=id", {}).then(function (res) {
      if (res.ok && res.body && res.body.length) return;
      var meta = u.user_metadata || {};
      var name = meta.full_name || "";
      var phone = meta.phone || "";
      var body = { id: u.id, name: name, email: u.email || "", phone: phone || null };
      return sb("khata_profiles?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: body
      }).then(function (res2) {
        if (res2.ok) return;
        // If the phone column doesn't exist yet (v2 SQL not run), save without the phone.
        if (res2.body && res2.body.code === "42703") {
          delete body.phone;
          return sb("khata_profiles?on_conflict=id", {
            method: "POST",
            prefer: "resolution=merge-duplicates,return=minimal",
            body: body
          }).then(function (res3) {
            if (!res3.ok) throw new Error("profile save failed");
          });
        }
        throw new Error("profile save failed");
      });
    });
  }

  function afterAuth(res) {
    // Signup with email confirmation on: no session is returned.
    // GoTrue's confirmation-pending response is a bare user object (top-level id/email),
    // NOT wrapped as {user: ...} — so check both shapes, otherwise even a successful
    // signup showed "Something went wrong" (2026-11-05, Yasir case).
    var body = res.body || {};
    if (!body.access_token) {
      var pendingUser = body.user || (body.id && body.email ? body : null);
      if (pendingUser) {
        setAuthMsg("Account ban gaya! Confirmation link aap ke email par bhej diya hai — us par click karein, phir login karein.", true);
        authMode = "login";
        renderAuthMode();
        return;
      }
      setAuthMsg(authErrorText(res), false);
      return;
    }
    saveSession(res.body);
    setAuthMsg("Ho gaya!", true);
    ensureProfile().catch(function () {}).then(function () {
      showApp();
      loadAll();
    });
  }

  function doAuth() {
    var email = $("authEmail").value.trim();
    var password = $("authPassword").value;
    var name = $("authName").value.trim();
    var phone = $("authPhone").value.trim();
    if (!email || !password) { setAuthMsg("Email aur password zaroori hain.", false); return; }
    if (authMode === "signup" && !name) { setAuthMsg("Apna naam likhein.", false); return; }
    if (authMode === "signup" && phone && !normPhone(phone)) { setAuthMsg("Sahi phone number likhein (example: 0300 1234567).", false); return; }
    if (password.length < 6) { setAuthMsg("Password kam se kam 6 harf ka ho.", false); return; }
    var btn = $("authSubmitBtn");
    btn.disabled = true;
    var p = authMode === "signup"
      ? authCall("/signup", { email: email, password: password, data: { full_name: name, phone: phone || "", app: "easy-khata" } })
      : authCall("/token?grant_type=password", { email: email, password: password });
    p.then(function (res) {
      btn.disabled = false;
      if (!res.ok && !(res.body && res.body.access_token)) {
        setAuthMsg(authErrorText(res), false);
        // If the email is already registered, switch straight to login mode —
        // so the user doesn't have to tap signup again.
        var raw = res.body && (res.body.msg || res.body.message || "");
        if (/already registered|already exists/i.test(raw)) {
          authMode = "login";
          renderAuthMode();
        }
        return;
      }
      afterAuth(res);
    }).catch(function () {
      btn.disabled = false;
      setAuthMsg("Internet ya server se rabta nahi ho raha.", false);
    });
  }

  /* ---------- forgot password / reset ---------- */
  function setForgotMsg(text, ok) {
    var el = $("forgotMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function setResetMsg(text, ok) {
    var el = $("resetMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function showForgot(show) {
    $("authForm").hidden = show;
    $("forgotBox").hidden = !show;
    if (show) {
      $("resetBox").hidden = true;
      setForgotMsg("");
      var em = $("authEmail").value.trim();
      if (em) $("forgotEmail").value = em;
    }
  }
  function wireEye(btnId, inputId) {
    var b = $(btnId), inp = $(inputId);
    if (!b || !inp) return;
    b.addEventListener("click", function () {
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.textContent = show ? "🙈" : "👁️";
      b.setAttribute("title", show ? "Hide password" : "Show password");
    });
  }
  function doForgot() {
    var email = $("forgotEmail").value.trim();
    if (!email) { setForgotMsg("Apna email likhein.", false); return; }
    var btn = $("forgotSendBtn");
    btn.disabled = true;
    authCall("/recover", { email: email, redirect_to: window.location.origin + "/" })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setForgotMsg(authErrorText(res), false); return; }
        setForgotMsg("Reset link bhej diya — apna inbox (aur spam/junk bhi) check karein.", true);
      }).catch(function () {
        btn.disabled = false;
        setForgotMsg("Internet ya server se rabta nahi ho raha.", false);
      });
  }
  function updatePassword(pw) {
    return fetch(API + "/auth/v1/user", {
      method: "PUT",
      headers: { "apikey": ANON, "Authorization": "Bearer " + authToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, body: null }; });
    });
  }
  function setPassMsg(text, ok) {
    var el = $("passMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function doChangePass() {
    var p1 = $("newPass1").value;
    var p2 = $("newPass2").value;
    if (!p1 || p1.length < 6) { setPassMsg("Password kam se kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setPassMsg("Dono password aik jaise hon.", false); return; }
    var btn = $("savePassBtn");
    btn.disabled = true;
    updatePassword(p1).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setPassMsg(authErrorText(res), false); return; }
      $("newPass1").value = "";
      $("newPass2").value = "";
      setPassMsg("Password badal gaya!", true);
    }).catch(function () {
      btn.disabled = false;
      setPassMsg("Internet ya server se rabta nahi ho raha.", false);
    });
  }
  function doReset() {
    var p1 = $("resetPassword").value;
    var p2 = $("resetPassword2").value;
    if (!p1 || p1.length < 6) { setResetMsg("Password kam se kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setResetMsg("Dono password aik jaise hon.", false); return; }
    var btn = $("resetBtn");
    btn.disabled = true;
    updatePassword(p1).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setResetMsg(authErrorText(res), false); return; }
      $("resetPassword").value = "";
      $("resetPassword2").value = "";
      saveSession(null);
      showAuth();
      setAuthMsg("Password badal gaya — naye password se login karein.", true);
    }).catch(function () {
      btn.disabled = false;
      setResetMsg("Internet ya server se rabta nahi ho raha.", false);
    });
  }
  // If the app is opened from an email reset/confirm link, grab that session.
  function handleAuthHash() {
    var h = window.location.hash || "";
    if (h.indexOf("access_token=") === -1) return false;
    var params = {};
    h.slice(1).split("&").forEach(function (kv) {
      var p = kv.split("=");
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    if (!params.access_token) return false;
    saveSession({ access_token: params.access_token, refresh_token: params.refresh_token || "", user: null, token_type: params.token_type || "bearer", expires_in: Number(params.expires_in || 3600) });
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) {}
    if (params.type === "recovery") {
      showAuth();
      $("resetBox").hidden = false;
      return true;
    }
    authValidate();
    return true;
  }

  function authValidate() {
    if (!session || !session.access_token) { showAuth(); return; }
    fetch(API + "/auth/v1/user", {
      headers: { "apikey": ANON, "Authorization": "Bearer " + session.access_token }
    }).then(function (r) {
      if (r.ok) return r.json();
      if (session.refresh_token) {
        return authCall("/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
          .then(function (res) {
            if (res.ok && res.body && res.body.access_token) { saveSession(res.body); return res.body.user; }
            throw new Error("expired");
          });
      }
      throw new Error("expired");
    }).then(function (user) {
      if (user && session) { session.user = user; saveSession(session); }
      showApp();
      loadAll();
    }).catch(function () {
      saveSession(null);
      showAuth();
    });
  }

  /* ---------- data ---------- */
  function tableMissing(res) {
    if (res.status === 404) return true;
    var code = res.body && res.body.code;
    return code === "PGRST205" || code === "42P01";
  }

  function profilesQuery(withPhone) {
    return sb("khata_profiles?select=id,name,email,created_at" + (withPhone ? ",phone" : "") + "&order=name.asc");
  }

  // Outbox sync: pending ops ko order mein server par bhejein.
  // Settled-lock rejection = op drop karein (kabhi accept nahi hoga),
  // network error = ruk jayein (ops queued rahein, baad mein retry).
  function flushOutbox() {
    if (syncing) return Promise.resolve(false);
    var ops = loadOutbox();
    if (!ops.length || !navigator.onLine) return Promise.resolve(false);
    syncing = true;
    setTxnMsg("Sync ho raha hai…", true);
    var done = 0, skipped = 0, skippedSettled = 0;
    function dropOp(key) {
      var rest = loadOutbox().filter(function (o) { return o.key !== key; });
      saveOutbox(rest);
    }
    function next(i) {
      if (i >= ops.length) {
        syncing = false;
        renderOffline();
        if (loadOutbox().length) return flushOutbox(); // sync ke dauran naye ops aa gaye
        loadAll();
        var msg = "Sync ho gaya! " + done + " record sync hue.";
        if (skipped) msg += " " + skipped + " skip hue" + (skipped === skippedSettled ? " (settled history)." : ".");
        setTxnMsg(msg, true);
        return Promise.resolve(true);
      }
      var op = ops[i];
      var p;
      if (op.op === "insert") {
        p = sb(op.table, { method: "POST", prefer: "return=representation", body: op.body });
      } else if (op.op === "update") {
        p = sb(op.table + "?id=eq." + encodeURIComponent(op.id), { method: "PATCH", prefer: "return=minimal", body: op.body });
      } else {
        p = sb(op.table + "?id=eq." + encodeURIComponent(op.id), { method: "DELETE" });
      }
      return p.then(function (res) {
        if (res.ok) {
          done++;
          dropOp(op.key);
          if (op.op === "insert" && op.table === "khata_transactions" && op.body) {
            try {
              var other = op.body.payer_id === myId() ? op.body.receiver_id : op.body.payer_id;
              if (other && other !== myId()) {
                var isSettle = String(op.body.note || "").indexOf("Settled up") === 0;
                sendNotif(other, isSettle ? "settle" : "record", op.body);
                triggerPush(other, isSettle ? "Hisaab barabar ho gaya" : myName() + " ne record add kiya", notifBodyFor(op.body, other));
              }
            } catch (e) {}
          }
          return next(i + 1);
        }
        if (res.status === 401 || res.status === 403) {
          syncing = false;
          renderOffline();
          setTxnMsg("Sync ruk gaya — dobara login karein.", false);
          return Promise.resolve(false);
        }
        var errMsg = (res.body && res.body.message) || "";
        if (op.op === "insert" && (res.status === 409 || errMsg.indexOf("duplicate") !== -1)) {
          done++; // record pehle hi server par hai (lost response ke baad retry) — duplicate nahi
          dropOp(op.key);
          return next(i + 1);
        }
        skipped++;
        if (errMsg.indexOf("Settled") !== -1) skippedSettled++;
        dropOp(op.key);
        return next(i + 1);
      }).catch(function () {
        syncing = false;
        renderOffline();
        setTxnMsg("Sync ruk gaya — internet aate hi dobara hoga.", false);
        return Promise.resolve(false);
      });
    }
    return next(0);
  }
  // Offline write helpers: record local state mein lagayein + outbox mein queue karein.
  function offlineTxnInsert(body) {
    var rec = {
      id: body.id || newUuid(),
      payer_id: body.payer_id, receiver_id: body.receiver_id,
      amount: body.amount, note: body.note, txn_date: body.txn_date,
      created_by: body.created_by, created_at: body.created_at || new Date().toISOString()
    };
    txns.unshift(rec);
    queueOp({ key: newUuid(), op: "insert", table: "khata_transactions", id: rec.id, body: rec, ts: Date.now() });
    saveCache();
    renderAll();
    return rec;
  }
  function applyTxnUpdateLocal(id, body) {
    for (var j = 0; j < txns.length; j++) {
      if (txns[j].id === id) {
        txns[j].payer_id = body.payer_id;
        txns[j].receiver_id = body.receiver_id;
        txns[j].amount = body.amount;
        txns[j].note = body.note;
        txns[j].txn_date = body.txn_date;
        break;
      }
    }
    saveCache();
    renderAll();
  }
  function offlineTxnUpdate(id, body) {
    // Agar is record ka pending insert hai to usi ki body update karein (alag update op nahi).
    var ops = loadOutbox();
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].op === "insert" && ops[i].table === "khata_transactions" && ops[i].id === id) {
        ops[i].body.payer_id = body.payer_id;
        ops[i].body.receiver_id = body.receiver_id;
        ops[i].body.amount = body.amount;
        ops[i].body.note = body.note;
        ops[i].body.txn_date = body.txn_date;
        ops[i].ts = Date.now();
        saveOutbox(ops);
        applyTxnUpdateLocal(id, body);
        return;
      }
    }
    queueOp({ key: newUuid(), op: "update", table: "khata_transactions", id: id, body: body, ts: Date.now() });
    applyTxnUpdateLocal(id, body);
  }
  function offlineTxnDelete(id) {
    // Pending insert hai to use hata dein (server par kabhi gaya hi nahi — delete op nahi chahiye).
    if (!removePendingInsert("khata_transactions", id)) {
      queueOp({ key: newUuid(), op: "delete", table: "khata_transactions", id: id, ts: Date.now() });
    }
    txns = txns.filter(function (t) { return t.id !== id; });
    saveCache();
    renderAll();
  }
  function offlineContactInsert(body) {
    var rec = {
      id: body.id || newUuid(),
      owner_id: body.owner_id, name: body.name, phone: body.phone || null,
      created_at: body.created_at || new Date().toISOString(), manual: true
    };
    myContacts.push(rec);
    queueOp({ key: newUuid(), op: "insert", table: "khata_contacts", id: rec.id, body: { id: rec.id, owner_id: rec.owner_id, name: rec.name, phone: rec.phone }, ts: Date.now() });
    saveCache();
    return rec;
  }

  function loadAll() {
    setTxnMsg("");
    profilesQuery(true).then(function (res) {
      // If the phone column doesn't exist yet (v2 SQL not run), load without the phone.
      if (!res.ok && res.body && res.body.code === "42703") return profilesQuery(false);
      return res;
    }).then(function (res) {
      if (!res.ok) {
        if (tableMissing(res)) {
          dbReady = false;
          $("setupBox").hidden = false;
          $("authWrap").hidden = true;
          $("appShell").hidden = true;
          return null;
        }
        throw new Error("profiles load failed");
      }
      dbReady = true;
      $("setupBox").hidden = true;
      profiles = res.body || [];
      return sb("khata_transactions?select=*&order=txn_date.desc&order=created_at.desc&limit=500");
    }).then(function (res) {
      if (!res) return;
      if (!res.ok) throw new Error("txns load failed");
      txns = res.body || [];
      rtLastFetch = Date.now();
      offlineMode = false;
      renderAll();
      loadNotifs();
      loadContacts();
      saveCache();
      flushOutbox();
    }).catch(function () {
      // Offline: aakhri save hua data dikhayein (agar cache hai).
      var c = loadCache();
      if (c) {
        offlineMode = true;
        dbReady = true;
        profiles = c.profiles || [];
        txns = c.txns || [];
        myContacts = (c.contacts || []).map(function (x) { x.manual = true; return x; });
        notifs = c.notifs || [];
        renderAll();
        renderNotifBadge();
        setTxnMsg("Offline — aakhri save hua data dikhaya ja raha hai.", false);
        renderOffline();
        return;
      }
      setTxnMsg("Records load nahi hue — refresh karein.", false);
    });
  }

  function renderAll() {
    lockedCache = computeLockedIds(); // settled-history lock map, fresh on every data change
    renderSummary();
    renderMonthStats();
    renderInsights();
    renderPeople();
    renderPersonSelect();
    renderTxnFilterOptions();
    renderTxns();
    fillMyPhone();
    renderAccount();
    renderAdmin();
  }

  /* ---------- notifications ---------- */
  var notifs = [];
  var notifTimer = null;

  /* ---------- realtime (live updates, like Gmail) ----------
     Supabase Realtime over the supabase-js CDN build. The app's own data
     calls stay on raw PostgREST (sb()); Realtime is only a "something
     changed" signal that triggers a quiet re-fetch. If the CDN fails to
     load (offline) or Realtime is unavailable, everything still works
     with the manual Refresh button + the visibility re-fetch below. */
  var rtChannel = null;
  var rtTimer = null;
  var rtLastFetch = 0;
  function liveReload() {
    // Quiet background refresh: no messages, no error popups.
    var ind = $("liveUpdating");
    var slowTimer = setTimeout(function () { if (ind) ind.hidden = false; }, 800);
    var done = function () {
      clearTimeout(slowTimer);
      if (ind) ind.hidden = true;
      rtLastFetch = Date.now();
    };
    refreshTxns().then(function () { loadNotifs(); loadContacts(); done(); }).catch(function () { done(); });
  }
  function scheduleLiveReload() {
    if (rtTimer) clearTimeout(rtTimer);
    rtTimer = setTimeout(function () { rtTimer = null; liveReload(); }, 300);
  }
  function setupRealtime() {
    try {
      if (!window.supabase || !window.supabase.createClient) return; // CDN failed / offline
      if (rtChannel) return; // already subscribed
      var client = window.supabase.createClient(API, ANON);
      try {
        // Authenticate the realtime connection with the user's token so RLS
        // lets the channel see their own rows.
        if (session && session.access_token && client.realtime && client.realtime.setAuth) {
          client.realtime.setAuth(session.access_token);
        }
      } catch (e) {}
      rtChannel = client.channel("easy-khata-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_transactions" }, function () { scheduleLiveReload(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_notifications" }, function () { scheduleLiveReload(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_contacts" }, function () { scheduleLiveReload(); })
        .subscribe();
    } catch (e) { rtChannel = null; }
  }
  function teardownRealtime() {
    try {
      if (rtTimer) { clearTimeout(rtTimer); rtTimer = null; }
      if (rtChannel) { rtChannel.unsubscribe(); rtChannel = null; }
    } catch (e) { rtChannel = null; }
  }
  document.addEventListener("visibilitychange", function () {
    // Re-fetch when the tab becomes visible again (catches changes made
    // elsewhere while the tab was hidden). Throttled: at most once per 30s.
    if (!document.hidden && session && Date.now() - rtLastFetch > 30000) scheduleLiveReload();
  });
  function fmtNotifTime(ts) {
    try {
      var d = new Date(ts);
      var dd = String(d.getDate()).padStart(2, "0");
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      var hh = String(d.getHours()).padStart(2, "0");
      var mi = String(d.getMinutes()).padStart(2, "0");
      return dd + "-" + mm + "-" + d.getFullYear() + " " + hh + ":" + mi;
    } catch (e) { return fmtDate(ts); }
  }
  function notifBodyFor(t, recipientId) {
    var actor = myName();
    var other = t.payer_id === recipientId ? profileName(t.receiver_id) : profileName(t.payer_id);
    var a = fmtRs(t.amount);
    var note = t.note || "Food";
    var date = fmtDate(t.txn_date);
    if (t.payer_id === recipientId) return "Aap ne " + other + " ko " + a + " diye — " + note + " · " + date;
    return actor + " ne aap ko " + a + " diye — " + note + " · " + date;
  }
  function sendNotif(userId, kind, txn) {
    if (!userId || userId === myId() || !txn) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === userId) real = true; });
    if (!real) return; // a manual contact has no account — no notification can go to them
    var title = kind === "settle" ? "Hisaab barabar ho gaya"
      : kind === "admin" ? "Admin ne record add kiya"
      : myName() + " ne record add kiya";
    sb("khata_notifications", { method: "POST", body: {
      user_id: userId, actor_id: myId(), txn_id: txn.id || null, kind: kind,
      title: title, body: notifBodyFor(txn, userId)
    } }).catch(function () {});
  }
  function loadNotifs() {
    if (!session || !session.access_token) return;
    sb("khata_notifications?select=*&user_id=eq." + encodeURIComponent(myId()) + "&order=created_at.desc&limit=50")
      .then(function (res) {
        if (!res.ok) return;
        notifs = Array.isArray(res.body) ? res.body : [];
        renderNotifBadge();
        if (!$("notifView").hidden) renderNotifList();
        saveCache();
      }).catch(function () {});
  }
  function unreadNotifCount() {
    var n = 0;
    notifs.forEach(function (x) { if (!x.is_read) n++; });
    return n;
  }
  function renderNotifBadge() {
    var n = unreadNotifCount();
    var b = $("notifBadge");
    b.textContent = n > 99 ? "99+" : String(n);
    b.hidden = n === 0;
  }
  function renderNotifList() {
    if (!notifs.length) {
      $("notifList").innerHTML = '<p class="empty">Abhi koi notification nahi.</p>';
      return;
    }
    var html = "";
    notifs.forEach(function (x) {
      html += '<div class="notif' + (x.is_read ? "" : " unread") + '" data-notif="' + esc(x.id) + '">' +
        '<div class="notif-title">' + esc(x.title || "") + '</div>' +
        '<div class="notif-body">' + esc(x.body || "") + '</div>' +
        '<div class="notif-time">' + esc(fmtNotifTime(x.created_at)) + '</div></div>';
    });
    $("notifList").innerHTML = html;
  }
  function markNotifRead(id) {
    sb("khata_notifications?id=eq." + encodeURIComponent(id), { method: "PATCH", body: { is_read: true } })
      .then(function () { loadNotifs(); }).catch(function () {});
  }
  function markAllNotifRead() {
    sb("khata_notifications?user_id=eq." + encodeURIComponent(myId()) + "&is_read=eq.false", { method: "PATCH", body: { is_read: true } })
      .then(function () { loadNotifs(); }).catch(function () {});
  }
  function showNotifView() {
    showView("notifs");
    loadNotifs();
  }

  /* ---------- manual contacts ---------- */
  var myContacts = [];
  function loadContacts() {
    if (!session || !session.access_token) return Promise.resolve(0);
    return sb("khata_contacts?select=*&owner_id=eq." + encodeURIComponent(myId()) + "&order=created_at.asc")
      .then(function (res) {
        if (!res.ok) return 0;
        myContacts = (Array.isArray(res.body) ? res.body : []).map(function (c) { c.manual = true; return c; });
        renderSummary(); // BUGFIX (v19): contacts Total Balance ko badalte hain — summary yahan dobara chahiye, warna manual dost (Ayaz) cards mein nahi aate
        renderPeople();
        renderPersonSelect();
        renderTxnFilterOptions();
        // BUGFIX (v21): ledger contacts se PEHLE render ho jata hai (loadAll mein
        // renderAll loadContacts se pehle chal jata hai), is liye manual doston
        // (Ayaz) ke naam pehle "Private contact" dikhte the aur wahi stuck rehta
        // tha — contacts aate hi ledger dobara render karein.
        renderTxns();
        saveCache();
        return maybeLinkContacts();
      }).catch(function () { return 0; });
  }
  function contactPhoneMatch(a, b) {
    var na = normPhone(a), nb = normPhone(b);
    return !!(na && nb && na === nb);
  }
  function maybeLinkContacts() {
    // For each of my manual contacts: has a real profile been created on this number?
    var jobs = [];
    myContacts.forEach(function (c) {
      if (!c.phone) return;
      var target = null;
      profiles.forEach(function (p) {
        if (p.id !== myId() && contactPhoneMatch(c.phone, p.phone)) target = p;
      });
      if (!target) return;
      jobs.push(linkContactToProfile(c, target));
    });
    if (!jobs.length) return Promise.resolve(0);
    return Promise.all(jobs).then(function (results) {
      var merged = 0;
      results.forEach(function (r) { if (r) merged++; });
      if (merged) refreshTxns();
      return merged;
    });
  }
  function linkContactToProfile(c, target) {
    var me = myId();
    return sb("khata_transactions?payer_id=eq." + encodeURIComponent(c.id) + "&created_by=eq." + encodeURIComponent(me),
      { method: "PATCH", body: { payer_id: target.id } })
      .then(function () {
        return sb("khata_transactions?receiver_id=eq." + encodeURIComponent(c.id) + "&created_by=eq." + encodeURIComponent(me),
          { method: "PATCH", body: { receiver_id: target.id } });
      }).then(function () {
        return sb("khata_contacts?id=eq." + encodeURIComponent(c.id), { method: "DELETE" });
      }).then(function () {
        myContacts = myContacts.filter(function (x) { return x.id !== c.id; });
        return true;
      }).catch(function () { return false; });
  }
  function refreshTxns() {
    return sb("khata_transactions?select=*&order=txn_date.desc&order=created_at.desc&limit=500")
      .then(function (res) {
        if (!res.ok) return;
        txns = res.body || [];
        renderAll();
      }).catch(function () {});
  }
  function setContactMsg(text, ok) {
    var el = $("contactMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function addContact() {
    var name = $("newContactName").value.trim();
    var phoneRaw = $("newContactPhone").value.trim();
    if (!name) { setContactMsg("Dost ka naam likhein.", false); return; }
    var phone = phoneRaw ? normPhone(phoneRaw) : "";
    if (phoneRaw && !phone) { setContactMsg("Sahi phone number likhein (example: 0300 1234567).", false); return; }
    var dupProfile = null;
    profiles.forEach(function (p) { if (phone && contactPhoneMatch(phone, p.phone)) dupProfile = p; });
    if (dupProfile) { setContactMsg("Ye number pehle se app par hai (" + (dupProfile.name || dupProfile.email) + ") — unhein seedha chunein.", false); return; }
    var dupContact = null;
    myContacts.forEach(function (c) { if (phone && contactPhoneMatch(phone, c.phone)) dupContact = c; });
    if (dupContact) { setContactMsg("Ye number pehle se aap ke contacts mein hai (" + (dupContact.name || "") + ").", false); return; }
    var btn = $("saveContactBtn");
    btn.disabled = true;
    var contactBody = { id: newUuid(), owner_id: myId(), name: name, phone: phone || null };
    if (isOffline()) {
      var createdOffline = offlineContactInsert(contactBody);
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost offline add ho gaya — online hote hi sync hoga.", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      $("txnPerson").value = createdOffline.id;
      btn.disabled = false;
      return;
    }
    sb("khata_contacts", { method: "POST", prefer: "return=representation", body: contactBody }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setContactMsg("Dost save nahi hua — dobara try karein.", false); return; }
      var created = res.body && res.body[0];
      if (created) { created.manual = true; myContacts.push(created); }
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost add ho gaya!", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      if (created) $("txnPerson").value = created.id;
    }).catch(function () {
      btn.disabled = false;
      var createdOffline = offlineContactInsert(contactBody);
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost offline add ho gaya — online hote hi sync hoga.", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      $("txnPerson").value = createdOffline.id;
    });
  }
  function deleteContact(id) {
    var c = null;
    myContacts.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    // My own manual contact — can be deleted even with records (user request 2026-11-05).
    // If there are records, those are deleted first (only the ones I created), then the contact.
    // BUT: settled history can never be deleted — if any record is locked, refuse.
    var count = 0, hasLocked = false;
    txns.forEach(function (t) {
      if (t.payer_id === id || t.receiver_id === id) { count++; if (isTxnLocked(t)) hasLocked = true; }
    });
    if (hasLocked) { setPeopleMsg("Is dost ka settled hisaab history mein save hai — usay delete nahi kar sakte.", false); return; }
    var text = count > 0
      ? "'" + (c.name || "") + "' — contacts se remove karein? Un ke " + count + " records bhi delete ho jayenge — ye wapas nahi hoga."
      : "'" + (c.name || "") + "' ko contacts se remove karein?";
    askConfirm("Dost remove karein?", text, "Remove karein", function () {
      var deleteRowOffline = function () {
        // Pending contact insert hai to use hata dein (delete op nahi chahiye).
        if (!removePendingInsert("khata_contacts", id)) {
          queueOp({ key: newUuid(), op: "delete", table: "khata_contacts", id: id, ts: Date.now() });
        }
        myContacts = myContacts.filter(function (x) { return x.id !== id; });
        saveCache();
        renderSummary();
        renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
        setPeopleMsg("Contact offline remove ho gaya — online hote hi sync hoga.", true);
      };
      var deleteTxnsOffline = function () {
        // Sirf apne banaye hue records (online version ki tarah) — locked wale pehle hi rok diye gaye.
        var mine = txns.filter(function (t) { return t.created_by === myId() && (t.payer_id === id || t.receiver_id === id); });
        mine.forEach(function (t) { offlineTxnDelete(t.id); });
      };
      if (isOffline()) {
        deleteTxnsOffline();
        deleteRowOffline();
        return;
      }
      var deleteRow = function () {
        sb("khata_contacts?id=eq." + encodeURIComponent(id), { method: "DELETE" })
          .then(function (res) {
            if (!res.ok) { setPeopleMsg("Contact delete nahi hua.", false); return; }
            myContacts = myContacts.filter(function (x) { return x.id !== id; });
            renderSummary();
            renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
            setPeopleMsg("Contact remove ho gaya.", true);
          }).catch(function () {
            deleteTxnsOffline();
            deleteRowOffline();
          });
      };
      if (count === 0) { deleteRow(); return; }
      sb("khata_transactions?created_by=eq." + encodeURIComponent(myId()) + "&or=(payer_id.eq." + encodeURIComponent(id) + ",receiver_id.eq." + encodeURIComponent(id) + ")", { method: "DELETE" })
        .then(function (res) {
          if (!res.ok) { setPeopleMsg("Records delete nahi hue — dobara try karein.", false); return; }
          refreshTxns();
          deleteRow();
        }).catch(function () {
          deleteTxnsOffline();
          deleteRowOffline();
        });
    });
  }
  function pickContact() {
    if (!navigator.contacts || !navigator.contacts.select) return;
    navigator.contacts.select(["name", "tel"], { multiple: false })
      .then(function (list) {
        if (!list || !list.length) return;
        var c = list[0];
        if (c.name && c.name.length) $("newContactName").value = c.name[0] || "";
        if (c.tel && c.tel.length) $("newContactPhone").value = c.tel[0] || "";
      }).catch(function () {});
  }

  /* ---------- push notifications (even when the app is closed) ---------- */
  var pushSupported = ("Notification" in window) && ("serviceWorker" in navigator) && ("PushManager" in window);
  var pushState = "unknown";
  function pushVapidKey() { return (window.EASY_KHATA_CONFIG && window.EASY_KHATA_CONFIG.VAPID_PUBLIC_KEY) || ""; }
  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function savePushSub(sub) {
    var k = sub.toJSON();
    return sb("khata_push_subs?on_conflict=endpoint", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: myId(), endpoint: sub.endpoint, p256dh: k.keys.p256dh, auth: k.keys.auth }
    });
  }
  // v22: Account mein "Notifications On karein" button wapas — user khud
  // on kar sakta hai (user gesture se Chrome permission prompt dikhata hai;
  // app open par bina gesture ke prompt aksar chhup jata hai — yahi asal
  // masla tha). Label pushState ke mutabiq badalta hai.
  function updatePushToggleLabel() {
    var el = $("acctPushLabel");
    if (!el) return;
    if (!pushSupported) { el.textContent = "Notifications: Is browser mein nahi"; return; }
    if (pushState === "on") el.textContent = "Notifications: On ✓";
    else if (pushState === "denied") el.textContent = "Notifications: Blocked — browser settings se on karein";
    else el.textContent = "Notifications On karein";
  }
  function setPushMsg(text, ok) {
    var el = $("pushMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  // serviceWorker.ready kabhi resolve na ho (SW register fail) to push flow
  // hang na ho — timeout ke baad null milta hai.
  function swReady(timeoutMs) {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (resolve) { setTimeout(function () { resolve(null); }, timeoutMs || 4000); })
    ]);
  }
  // v23: Firebase Cloud Messaging (FCM) — closed-app popup ke liye.
  // Config config.js mein hai (public-by-design). Jab tak config ya SDK na
  // ho, ye branch bilkul inert hai aur VAPID path chalta hai.
  function fcmConfig() {
    var f = cfg.FIREBASE;
    if (!f || !f.apiKey || !f.projectId || !f.messagingSenderId || !f.appId) return null;
    return f;
  }
  function fcmSupported() {
    return !!(fcmConfig() && cfg.FCM_VAPID_KEY && window.firebase && window.firebase.messaging &&
      typeof window.firebase.messaging.isSupported === "function" && window.firebase.messaging.isSupported());
  }
  var fcmMsg = null;
  function fcmMessaging() {
    if (fcmMsg) return fcmMsg;
    var app = (window.firebase.apps && window.firebase.apps.length)
      ? window.firebase.app()
      : window.firebase.initializeApp(fcmConfig());
    fcmMsg = window.firebase.messaging(app);
    return fcmMsg;
  }
  var fcmReg = null;
  function fcmServiceWorker() {
    if (fcmReg) return Promise.resolve(fcmReg);
    return navigator.serviceWorker.register("firebase-messaging-sw.js", { scope: "/firebase-cloud-messaging-push-scope" })
      .then(function (reg) { fcmReg = reg; return reg; });
  }
  function saveFcmToken(token) {
    return sb("khata_push_subs?on_conflict=fcm_token", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: myId(), fcm_token: token }
    }).then(function (res) { if (!res.ok) throw new Error("save failed"); });
  }
  // FCM token ki maujoodgi check (self-heal: token milte hi DB mein save).
  function fcmTokenState() {
    var messaging;
    try { messaging = fcmMessaging(); } catch (e) { return Promise.resolve("off"); }
    return fcmServiceWorker().then(function (reg) {
      return messaging.getToken({ vapidKey: cfg.FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    }).then(function (token) {
      if (!token) return "off";
      pushState = "on"; updatePushToggleLabel();
      saveFcmToken(token).catch(function () {});
      return "on";
    }).catch(function () { return "off"; });
  }
  function enablePushFcm() {
    var p = (window.Notification && Notification.permission === "granted")
      ? Promise.resolve("granted")
      : Notification.requestPermission();
    return p.then(function (perm) {
      if (perm !== "granted") {
        if (perm === "denied") { pushState = "denied"; updatePushToggleLabel(); }
        return { ok: false, reason: perm === "denied" ? "permission-denied" : "permission-default" };
      }
      var messaging;
      try { messaging = fcmMessaging(); } catch (e) {
        return { ok: false, reason: "fcm-init-failed", detail: String((e && e.message) || e) };
      }
      return fcmServiceWorker().then(function (reg) {
        return messaging.getToken({ vapidKey: cfg.FCM_VAPID_KEY, serviceWorkerRegistration: reg });
      }).then(function (token) {
        if (!token) return { ok: false, reason: "fcm-token-failed" };
        return saveFcmToken(token).then(function () {
          pushState = "on"; updatePushToggleLabel();
          return { ok: true };
        }, function () { return { ok: false, reason: "save-failed" }; });
      }).catch(function (e) {
        return { ok: false, reason: "fcm-token-failed", detail: String((e && e.message) || e) };
      });
    }).catch(function () { return { ok: false, reason: "permission-default" }; });
  }
  // Har failure ki ASAL wajah — v22 ka generic "dobara khol kar try karein"
  // chhupa deta tha ke kaunsa step fail hua (user ko 23:11 PKT wahi mila tha).
  function pushReasonText(reason, detail) {
    if (reason === "unsupported") return "Is browser mein notifications nahi chalti — Chrome use karein.";
    if (reason === "permission-denied") return "Notifications block hain — Chrome ki site settings mein ja kar Easy Khata ke liye Notifications allow karein.";
    if (reason === "permission-default") return "Chrome ne permission ka popup nahi dikhaya — aap ne pehle kai dafa mana kiya hoga, is liye Chrome ne prompt band kar diya hai. Chrome ke address bar mein lock 🔒 icon par tap karein → Site settings → Notifications → Allow karein, phir dobara try karein.";
    if (reason === "sw-not-ready") return "Service worker ready nahi hua — app band kar ke dobara kholein, phir try karein.";
    if (reason === "subscribe-failed") return "Subscription nahi bani" + (detail ? " (" + detail + ")" : "") + " — Chrome mein kholein (WhatsApp/Facebook ke andar wale browser se nahi), internet check karein, phir try karein.";
    if (reason === "fcm-init-failed") return "Firebase start nahi hua" + (detail ? " (" + detail + ")" : "") + " — app refresh kar ke dobara try karein.";
    if (reason === "fcm-token-failed") return "Firebase token nahi bana" + (detail ? " (" + detail + ")" : "") + " — internet check karein aur dobara try karein.";
    if (reason === "save-failed") return "Internet ya server se rabta nahi ho raha — dobara try karein.";
    return "Notifications on nahi hui — dobara try karein.";
  }
  function refreshPushState() {
    if (!pushSupported) { pushState = "unsupported"; updatePushToggleLabel(); return Promise.resolve(pushState); }
    if (window.Notification && Notification.permission === "denied") {
      pushState = "denied"; updatePushToggleLabel(); return Promise.resolve(pushState);
    }
    // FCM configured + permission granted: FCM token hi source of truth hai.
    if (fcmSupported() && window.Notification && Notification.permission === "granted") {
      return fcmTokenState().then(function (st) {
        if (st === "on") return pushState;
        // FCM token nahi mila — VAPID subscription bhi check kar lein.
        return vapidPushState();
      });
    }
    return vapidPushState();
  }
  function vapidPushState() {
    return swReady(4000).then(function (reg) {
      if (!reg) return null;
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) { pushState = "off"; updatePushToggleLabel(); return pushState; }
      pushState = "on";
      updatePushToggleLabel();
      // Browser mein subscription hai — DB mein bhi honi chahiye (upsert).
      // Agar pehle save fail hua tha to ab theek ho jayega.
      savePushSub(sub).catch(function () {});
      return pushState;
    }).catch(function () { return pushState; });
  }
  // Chrome's own notification permission popup appears as soon as the app opens.
  // In-app banner removed (2026-11-05) — the browser asks itself.
  // Once per fresh open (session guard); doesn't ask again after Block.
  // v22: sirf "on" hone par skip karein — "unknown" (SW abhi ready nahi) par
  // bhi poochna chahiye, warna prompt kabhi nahi aata.
  function maybeAskPushPermission() {
    if (!pushSupported) return;
    if (!window.Notification || Notification.permission !== "default") return;
    if (pushState === "on") return;
    try { if (window.sessionStorage.getItem("easykhata_push_asked") === "1") return; } catch (e) {}
    try { window.sessionStorage.setItem("easykhata_push_asked", "1"); } catch (e) {}
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { pushState = "denied"; updatePushToggleLabel(); return; }
      enablePush();
    }).catch(function () {});
  }
  // v23: enablePush ab {ok, reason, detail} batata hai — kaunsa step fail
  // hua, ye chhupaya nahi jata. FCM configured ho to FCM path, warna VAPID.
  function enablePush() {
    if (!pushSupported) return Promise.resolve({ ok: false, reason: "unsupported" });
    if (fcmSupported()) return enablePushFcm();
    var p = (window.Notification && Notification.permission === "granted")
      ? Promise.resolve("granted")
      : Notification.requestPermission();
    return p.then(function (perm) {
      if (perm !== "granted") {
        if (perm === "denied") { pushState = "denied"; updatePushToggleLabel(); }
        return { ok: false, reason: perm === "denied" ? "permission-denied" : "permission-default" };
      }
      return swReady(5000).then(function (reg) {
        if (!reg) return { ok: false, reason: "sw-not-ready" };
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushVapidKey()) }).then(function (sub) {
          if (!sub) return { ok: false, reason: "subscribe-failed" };
          return savePushSub(sub).then(function () {
            pushState = "on"; updatePushToggleLabel();
            return { ok: true };
          }, function () { return { ok: false, reason: "save-failed" }; });
        }, function (e) { return { ok: false, reason: "subscribe-failed", detail: String((e && e.message) || e) }; });
      });
    }).catch(function () {
      return { ok: false, reason: "permission-default" };
    });
  }
  // v22: Account menu ka "Notifications On karein" button — user gesture se
  // chalti hai, is liye Chrome prompt dikhata hai. v23: asal wajah dikhata hai.
  function enablePushFromButton() {
    if (!pushSupported) { setPushMsg(pushReasonText("unsupported"), false); return; }
    if (window.Notification && Notification.permission === "denied") {
      setPushMsg(pushReasonText("permission-denied"), false);
      return;
    }
    if (pushState === "on") { setPushMsg("Notifications pehle se on hain ✓", true); return; }
    setPushMsg("Notifications on ho rahi hain…", true);
    enablePush().then(function (r) {
      if (r.ok) setPushMsg("Notifications on ho gayi! ✓ Ab jab koi record save karega to popup aayega — app band ho to bhi.", true);
      else setPushMsg(pushReasonText(r.reason, r.detail), false);
    });
  }
  function triggerPush(recipientId, title, text) {
    // Fire-and-forget: the server function sends the push to the recipient.
    // The save flow never waits on this.
    if (!recipientId || recipientId === myId() || !session || !session.access_token) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === recipientId) real = true; });
    if (!real) return; // a manual contact has no account
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ recipientId: recipientId, title: title, body: text })
    }).catch(function () {});
  }

  /* ---------- admin panel ---------- */
  function setAdminMsg(text, ok) {
    var el = $("adminMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function renderAdmin() {
    // Admin only: the list comes from a server-side RPC (checked in the DB).
    if (!isAdmin()) { $("navAdminBtn").hidden = true; return; }
    $("navAdminBtn").hidden = false;
    sb("rpc/admin_list_users", { method: "POST", body: {} })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("Users load nahi hue — dobara try karein.", false); return; }
        adminUsers = Array.isArray(res.body) ? res.body : [];
        var total = 0;
        adminUsers.forEach(function (u) { total += Number(u.records) || 0; });
        $("adminStats").textContent = "Kull users: " + adminUsers.length + " · Kull records: " + total;
        if (!adminUsers.length) {
          $("adminUserList").innerHTML = '<p class="empty">Abhi koi user nahi.</p>';
          return;
        }
        var me = myId();
        var html = "";
        adminUsers.forEach(function (u) {
          var badge = u.id === me
            ? '<span class="badge-admin">Admin (you)</span>'
            : (u.blocked ? ' <span class="badge-blocked">Blocked</span>' : '');
          var del = u.id === me ? "" : '<button class="btn-danger" type="button" data-admin-del="' + esc(u.id) + '">Delete user</button>';
          html += '<div class="person admin-user" data-admin-open="' + esc(u.id) + '"><div><div class="p-name">' + esc(u.name || u.email) + badge + '</div>' +
            '<div class="p-detail">' + esc(u.email || "") + (u.phone ? ' · ' + esc(u.phone) : '') + '</div>' +
            '<div class="p-detail">' + (Number(u.records) || 0) + ' record · Shamil ' + esc(fmtDate(u.created_at)) + '</div></div>' +
            '<div class="p-actions">' + del + '</div></div>';
        });
        $("adminUserList").innerHTML = html;
      }).catch(function () { setAdminMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function deleteUser(id) {
    var p = null;
    adminUsers.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) p = findPerson(id);
    if (!p || id === myId()) return;
    if (!window.confirm("'" + (p.name || p.email) + "' — delete karein?\n\nUn ka account, profile aur saare records delete ho jayenge. Ye wapas nahi hoga.")) return;
    sb("rpc/admin_delete_user", { method: "POST", body: { target_id: id } })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("User delete nahi hua — dobara try karein.", false); return; }
        setAdminMsg("User delete ho gaya.", true);
        if (adminCurrentUser && adminCurrentUser.id === id) {
          adminCurrentUser = null;
          showView("admin");
        }
        loadAll();
      }).catch(function () { setAdminMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function setAdminAddMsg(text, ok) {
    var el = $("adminAddMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  // v22: admin user bana sakta hai (full CRUD — CREATE). Server par
  // admin_create_user RPC auth user + profile banata hai; naya user
  // foran login kar sakta hai. Admin ka kaam online-only hai.
  function createAdminUser() {
    if (!isAdmin()) return;
    if (!navigator.onLine) { setAdminAddMsg("Admin kaam ke liye internet chahiye.", false); return; }
    var name = $("adminAddName").value.trim();
    var email = $("adminAddEmail").value.trim();
    var phone = $("adminAddPhone").value.trim();
    var pass = $("adminAddPass").value;
    if (!name) { setAdminAddMsg("Naam likhein.", false); return; }
    if (email.indexOf("@") === -1 || email.indexOf(".") === -1) { setAdminAddMsg("Sahi email likhein.", false); return; }
    if (!pass || pass.length < 6) { setAdminAddMsg("Password kam se kam 6 harf ka ho.", false); return; }
    var btn = $("adminAddSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_create_user", { method: "POST", body: { p_name: name, p_email: email, p_phone: phone, p_password: pass } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          var msg = (res.body && res.body.message) || "";
          if (msg.indexOf("email already registered") !== -1) setAdminAddMsg("Ye email pehle se registered hai.", false);
          else if (msg.indexOf("not admin") !== -1) setAdminAddMsg("Sirf admin user bana sakta hai.", false);
          else if (msg.indexOf("password too short") !== -1) setAdminAddMsg("Password kam se kam 6 harf ka ho.", false);
          else if (msg.indexOf("valid email") !== -1) setAdminAddMsg("Sahi email likhein.", false);
          else if (msg.indexOf("name required") !== -1) setAdminAddMsg("Naam likhein.", false);
          else setAdminAddMsg("User nahi bana — dobara try karein.", false);
          return;
        }
        $("adminAddName").value = "";
        $("adminAddEmail").value = "";
        $("adminAddPhone").value = "";
        $("adminAddPass").value = "";
        $("adminAddUserBox").hidden = true;
        setAdminAddMsg("User ban gaya! " + name + " ab login kar sakta hai.", true);
        renderAdmin();
      }).catch(function () { btn.disabled = false; setAdminAddMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function setAdminUserMsg(text, ok) {
    var el = $("adminUserMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function setAdminEditMsg(text, ok) {
    var el = $("adminEditMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function setAdminPassMsg(text, ok) {
    var el = $("adminPassMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function openAdminUser(id) {
    if (!isAdmin()) return;
    var u = null;
    adminUsers.forEach(function (x) { if (x.id === id) u = x; });
    if (!u) return;
    adminCurrentUser = u;
    $("adminUserTitle").textContent = u.name || u.email;
    $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (you)</span> ' : '') +
      (u.blocked ? '<span class="badge-blocked">Blocked</span>' : '<span class="badge-admin">Active</span>');
    $("adminUserEmail").textContent = u.email || "—";
    $("adminUserPhone").textContent = u.phone || "—";
    $("adminUserJoined").textContent = fmtDate(u.created_at);
    $("adminUserId").textContent = u.id;
    $("adminEditName").value = u.name || "";
    $("adminEditPhone").value = u.phone || "";
    $("adminEditBox").hidden = true;
    $("adminPassBox").hidden = true;
    $("adminNewPass1").value = "";
    $("adminNewPass2").value = "";
    setAdminEditMsg("");
    setAdminPassMsg("");
    setAdminUserMsg("");
    $("adminBlockBtn").textContent = u.blocked ? "Unblock" : "Block";
    var mine = txns.filter(function (t) { return t.payer_id === u.id || t.receiver_id === u.id; });
    var given = 0, taken = 0;
    mine.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === u.id) given += a;
      if (t.receiver_id === u.id) taken += a;
    });
    $("adminUserSummary").innerHTML =
      '<div class="sum-card"><span class="sum-label">Diye</span><strong>' + esc(fmtRs(given)) + '</strong></div>' +
      '<div class="sum-card"><span class="sum-label">Liye</span><strong>' + esc(fmtRs(taken)) + '</strong></div>' +
      '<div class="sum-card net"><span class="sum-label">Net (diye − liye)</span><strong>' + esc(fmtRs(given - taken)) + '</strong></div>';
    if (!mine.length) {
      $("adminUserTxns").innerHTML = '<p class="empty">Is user ka koi record nahi.</p>';
    } else {
      var html = "";
      mine.forEach(function (t) {
        var other = t.payer_id === u.id ? profileName(t.receiver_id) : profileName(t.payer_id);
        var dir = t.payer_id === u.id ? "→ " + other + " (diye)" : "← " + other + " (liye)";
        var lock = isTxnLocked(t) ? ' <span class="t-lock">🔒 Settled</span>' : "";
        html += '<div class="txn"><div class="t-main">' + esc(dir) + '</div>' +
          '<div class="t-sub">' + esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + '</div>' +
          '<div class="t-foot"><span class="t-amt">' + esc(fmtRs(t.amount)) + '</span>' + lock + '</div></div>';
      });
      $("adminUserTxns").innerHTML = html;
    }
    showView("adminUser");
  }
  function saveAdminEdit() {
    if (!isAdmin() || !adminCurrentUser) return;
    var name = $("adminEditName").value.trim();
    var phone = $("adminEditPhone").value.trim();
    if (!name) { setAdminEditMsg("Naam khaali nahi ho sakta.", false); return; }
    var btn = $("adminEditSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_update_user", { method: "POST", body: { p_target: adminCurrentUser.id, p_name: name, p_phone: phone } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminEditMsg("Update nahi hua — dobara try karein.", false); return; }
        adminCurrentUser.name = name;
        adminCurrentUser.phone = phone || null;
        $("adminUserTitle").textContent = name;
        $("adminUserPhone").textContent = phone || "—";
        setAdminEditMsg("User update ho gaya.", true);
        loadAll();
      }).catch(function () { btn.disabled = false; setAdminEditMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function saveAdminPass() {
    if (!isAdmin() || !adminCurrentUser) return;
    var p1 = $("adminNewPass1").value;
    var p2 = $("adminNewPass2").value;
    if (!p1 || p1.length < 6) { setAdminPassMsg("Password kam se kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setAdminPassMsg("Dono password aik jaise hon.", false); return; }
    var btn = $("adminPassSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_set_user_password", { method: "POST", body: { p_target: adminCurrentUser.id, p_password: p1 } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminPassMsg("Password nahi badla — dobara try karein.", false); return; }
        $("adminNewPass1").value = "";
        $("adminNewPass2").value = "";
        setAdminPassMsg("Password badal gaya — user naye password se login kar sakta hai.", true);
      }).catch(function () { btn.disabled = false; setAdminPassMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function toggleAdminBlock() {
    if (!isAdmin() || !adminCurrentUser) return;
    var u = adminCurrentUser;
    if (u.id === myId()) { setAdminUserMsg("Khud ko block nahi kar sakte.", false); return; }
    var blocking = !u.blocked;
    if (!window.confirm(blocking
      ? ("'" + (u.name || u.email) + "' — BLOCK karein?\n\nWo dobara login nahi kar sakega (un ka data mehfooz rahega).")
      : ("'" + (u.name || u.email) + "' — UNBLOCK karein?"))) return;
    sb("rpc/admin_set_user_blocked", { method: "POST", body: { p_target: u.id, p_blocked: blocking } })
      .then(function (res) {
        if (!res.ok) { setAdminUserMsg("Block update nahi hua — dobara try karein.", false); return; }
        u.blocked = blocking;
        $("adminBlockBtn").textContent = blocking ? "Unblock" : "Block";
        $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (you)</span> ' : '') +
          (blocking ? '<span class="badge-blocked">Blocked</span>' : '<span class="badge-admin">Active</span>');
        setAdminUserMsg(blocking ? "User block ho gaya — ab login nahi kar sakega." : "User unblock ho gaya.", true);
        loadAll();
      }).catch(function () { setAdminUserMsg("Internet ya server se rabta nahi ho raha.", false); });
  }

  function setAdminSetMsg(text, ok) {
    var el = $("adminSetMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function saveAdminSet() {
    if (!isAdmin() || !adminCurrentUser) return;
    var amount = parseFloat($("adminSetAmount").value);
    if (!amount || amount <= 0) { setAdminSetMsg("Sahi raqam likhein.", false); return; }
    var dir = (document.querySelector('input[name="adminSetDir"]:checked') || {}).value || "take";
    var note = $("adminSetNote").value.trim() || "Admin ne raqam set ki";
    var me = myId();
    var u = adminCurrentUser;
    var body = {
      payer_id: dir === "take" ? u.id : me,
      receiver_id: dir === "take" ? me : u.id,
      amount: amount, note: note, txn_date: todayLocal(), created_by: me
    };
    var btn = $("adminSetSaveBtn");
    btn.disabled = true;
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminSetMsg("Raqam set nahi hui — dobara try karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) {
          sendNotif(u.id, "admin", created);
          triggerPush(u.id, "Admin ne record add kiya", notifBodyFor(created, u.id));
          txns.unshift(created);
        }
        $("adminSetAmount").value = "";
        $("adminSetNote").value = "";
        setAdminSetMsg("Raqam set ho gayi!", true);
        openAdminUser(u.id);
        loadAll();
      }).catch(function () { btn.disabled = false; setAdminSetMsg("Internet ya server se rabta nahi ho raha.", false); });
  }

  function renderMonthStats() {
    var el = $("monthStats");
    var now = todayLocal().slice(0, 7);
    var given = 0, taken = 0, count = 0;
    txns.forEach(function (t) {
      if (String(t.txn_date || "").slice(0, 7) !== now) return;
      if (t.payer_id !== myId() && t.receiver_id !== myId()) return;
      var a = Number(t.amount) || 0;
      count++;
      if (t.payer_id === myId()) given += a;
      if (t.receiver_id === myId()) taken += a;
    });
    if (!txns.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "Is mahine (<strong>" + esc(monthName(now + "-01")) + "</strong>): diye <strong>" + esc(fmtRs(given)) + "</strong> · liye <strong>" + esc(fmtRs(taken)) + "</strong> · " + count + " records";
  }

  function renderInsights() {
    var el = $("insightStats");
    var me = myId();
    var mine = txns.filter(function (t) { return t.payer_id === me || t.receiver_id === me; });
    if (!mine.length) { el.hidden = true; return; }
    var biggest = mine[0], total = 0;
    var counts = {};
    mine.forEach(function (t) {
      var a = Number(t.amount) || 0;
      total += a;
      if (a > (Number(biggest.amount) || 0)) biggest = t;
      var other = t.payer_id === me ? t.receiver_id : t.payer_id;
      counts[other] = (counts[other] || 0) + 1;
    });
    var topId = null, topN = 0;
    Object.keys(counts).forEach(function (id) { if (counts[id] > topN) { topN = counts[id]; topId = id; } });
    var avg = Math.round(total / mine.length * 100) / 100;
    el.hidden = false;
    el.innerHTML = "Sab se bara khana: <strong>" + esc(fmtRs(biggest.amount)) + "</strong> (" + esc(biggest.note || "Food") + ", " + esc(fmtDate(biggest.txn_date)) + ") · " +
      "Sab se zyada len-den: <strong>" + esc(profileName(topId)) + "</strong> (" + topN + " dafa) · " +
      "Aosat khana: <strong>" + esc(fmtRs(avg)) + "</strong>";
  }

  function fillMyPhone() {
    var me = null;
    profiles.forEach(function (p) { if (p.id === myId()) me = p; });
    myPhone = (me && me.phone) || "";
    var input = $("myPhone");
    if (input && document.activeElement !== input) input.value = myPhone;
  }

  /* ---------- profile edit (v23: user apni profile khud A to Z badal sakta hai) ---------- */
  var pendingAvatarFile = null;
  var removeAvatar = false;
  function myProfile() {
    var me = null;
    profiles.forEach(function (p) { if (p.id === myId()) me = p; });
    return me;
  }
  function avatarHtml(url, initial) {
    if (url) return '<img src="' + esc(url) + '" alt="">';
    return esc(initial || "?");
  }
  function setAvatarEl(el, url, initial) {
    if (!el) return;
    el.innerHTML = avatarHtml(url, initial);
  }
  // Auth user_metadata sync (GoTrue PUT /auth/v1/user, data = user_metadata).
  function updateUserMeta(data) {
    return fetch(API + "/auth/v1/user", {
      method: "PUT",
      headers: { "apikey": ANON, "Authorization": "Bearer " + authToken(), "Content-Type": "application/json" },
      body: JSON.stringify({ data: data })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, body: null }; });
    });
  }
  function fillProfileForm() {
    var me = myProfile();
    var meta = (session.user && session.user.user_metadata) || {};
    var name = (me && me.name) || meta.full_name || myName() || "";
    $("myNameInput").value = name;
    $("myUsername").value = (me && me.username) || "";
    $("myEmailView").value = (session.user && session.user.email) || "";
    if ($("myPhone") && document.activeElement !== $("myPhone")) $("myPhone").value = myPhone || (me && me.phone) || "";
    pendingAvatarFile = null; removeAvatar = false;
    if ($("profilePicInput")) $("profilePicInput").value = "";
    var initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
    setAvatarEl($("profilePicPreview"), me && me.avatar_url, initial);
    $("removePicBtn").hidden = !(me && me.avatar_url);
    setPhoneMsg("");
  }
  function downscaleImage(file) {
    // Phone photos 5MB+ hote hain — 512px JPEG (0.85) bana kar upload tez + sasta.
    // Canvas na mile (purana browser) to original file hi upload hogi.
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          try {
            var max = 512;
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { URL.revokeObjectURL(url); resolve(file); return; }
            var s = Math.min(1, max / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
            var cv = document.createElement("canvas");
            cv.width = cw; cv.height = ch;
            var ctx = cv.getContext("2d");
            if (!ctx) { URL.revokeObjectURL(url); resolve(file); return; }
            ctx.drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            if (cv.toBlob) cv.toBlob(function (b) { resolve(b || file); }, "image/jpeg", 0.85);
            else resolve(file);
          } catch (e) { try { URL.revokeObjectURL(url); } catch (e2) {} resolve(file); }
        };
        img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} resolve(file); };
        img.src = url;
      } catch (e) { resolve(file); }
    });
  }
  function uploadAvatar(file) {
    return downscaleImage(file).then(function (blob) {
      var path = myId() + "/" + Date.now() + ".jpg";
      return fetch(API + "/storage/v1/object/avatars/" + path, {
        method: "POST",
        headers: { "apikey": ANON, "Authorization": "Bearer " + authToken(), "Content-Type": "image/jpeg", "x-upsert": "true" },
        body: blob
      }).then(function (r) {
        if (!r.ok) throw new Error("upload failed " + r.status);
        return API + "/storage/v1/object/public/avatars/" + path;
      });
    });
  }
  function saveProfile() {
    var name = $("myNameInput").value.trim();
    var username = $("myUsername").value.trim();
    var phone = $("myPhone").value.trim();
    if (!name) { setPhoneMsg("Apna naam likhein.", false); return; }
    if (name.length > 80) { setPhoneMsg("Naam 80 harf se zyada nahi ho sakta.", false); return; }
    if (username && !/^[A-Za-z0-9_.]{3,30}$/.test(username)) { setPhoneMsg("Username 3–30 harf ka ho — sirf harf, number, _ aur . chalenge.", false); return; }
    if (phone && !normPhone(phone)) { setPhoneMsg("Sahi phone number likhein (example: 0300 1234567).", false); return; }
    var btn = $("savePhoneBtn");
    btn.disabled = true;
    setPhoneMsg("Profile save ho rahi hai…", true);
    var checkUsername = username
      ? sb("khata_profiles?select=id&username=ilike." + encodeURIComponent(username.replace(/%/g, "\\%").replace(/_/g, "\\_")) + "&id=neq." + encodeURIComponent(myId()), {})
        .then(function (res) {
          if (res.ok && res.body && res.body.length) throw new Error("username-taken");
        })
      : Promise.resolve();
    checkUsername.then(function () {
      if (pendingAvatarFile) return uploadAvatar(pendingAvatarFile);
      if (removeAvatar) return "__REMOVE__";
      return null;
    }).then(function (avatarUrl) {
      var body = { name: name, phone: phone || null, username: username || null };
      if (avatarUrl === "__REMOVE__") body.avatar_url = null;
      else if (avatarUrl) body.avatar_url = avatarUrl;
      return sb("khata_profiles?id=eq." + encodeURIComponent(myId()), {
        method: "PATCH",
        prefer: "return=representation",
        body: body
      }).then(function (res) {
        if (!res.ok) throw new Error("profile-save-failed");
        if (res.body && res.body.length) return res.body[0];
        // No profile row exists — PATCH silently does nothing, so create it.
        var up = { id: myId(), name: name, email: (session.user && session.user.email) || "", phone: phone || null, username: username || null };
        if (body.avatar_url) up.avatar_url = body.avatar_url;
        return sb("khata_profiles?on_conflict=id", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: up
        }).then(function (res2) {
          if (!res2.ok) throw new Error("profile-save-failed");
          return up;
        });
      }).then(function (saved) {
        // Auth metadata bhi sync karein (header ka naam wahi se aata hai).
        return updateUserMeta({ full_name: name, phone: phone || "" }).then(function () { return saved; }, function () { return saved; });
      });
    }).then(function (saved) {
      btn.disabled = false;
      var me = myProfile();
      if (me) {
        me.name = name; me.phone = phone || null; me.username = username || null;
        if (saved && "avatar_url" in saved) me.avatar_url = saved.avatar_url;
        else if (removeAvatar) me.avatar_url = null;
      }
      myPhone = phone;
      if (session.user) {
        session.user.user_metadata = session.user.user_metadata || {};
        session.user.user_metadata.full_name = name;
        session.user.user_metadata.phone = phone || "";
        saveSession(session);
      }
      pendingAvatarFile = null; removeAvatar = false;
      renderAccount(); renderPeople(); fillMyPhone();
      var initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
      setAvatarEl($("profilePicPreview"), me && me.avatar_url, initial);
      $("removePicBtn").hidden = !(me && me.avatar_url);
      setPhoneMsg("Profile save ho gaya! ✓", true);
    }).catch(function (e) {
      btn.disabled = false;
      if (e && e.message === "username-taken") setPhoneMsg("Ye username kisi aur ne liya hua hai — koi aur chunein.", false);
      else if (e && /^upload failed/.test(e.message || "")) setPhoneMsg("Photo upload nahi hui — internet check kar ke dobara try karein.", false);
      else setPhoneMsg("Profile save nahi hui — internet check kar ke dobara try karein.", false);
    });
  }
  function setPhoneMsg(text, ok) {
    var el = $("phoneMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function setPeopleMsg(text, ok) {
    var el = $("peopleMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }

  function renderSummary() {
    // TOTAL BALANCE: two cards — what I have to receive (lene hain, green)
    // and what I have to give (dene hain, red). Per-person nets, not totals.
    var map = peopleMap();
    var toReceive = 0, toPay = 0, rc = 0, pc = 0;
    Object.keys(map).forEach(function (id) {
      var net = map[id].given - map[id].taken;
      if (net > 0) { toReceive += net; rc++; }
      else if (net < 0) { toPay += -net; pc++; }
    });
    $("sumReceive").textContent = fmtRs(toReceive);
    $("sumReceiveCount").textContent = rc ? rc + (rc === 1 ? " dost se" : " doston se") : "Koi nahi";
    $("sumPay").textContent = fmtRs(toPay);
    $("sumPayCount").textContent = pc ? pc + (pc === 1 ? " dost ko" : " doston ko") : "Koi nahi";
  }

  function personStats(id) {
    var given = 0, taken = 0;
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === myId() && t.receiver_id === id) given += a;
      if (t.receiver_id === myId() && t.payer_id === id) taken += a;
    });
    return { given: given, taken: taken, net: given - taken }; // +: they owe me, -: I owe them
  }
  function latestTxnWith(id) {
    // Most recent record between me and this person (by date, then by creation time).
    var me = myId(), best = null;
    txns.forEach(function (t) {
      var mine = (t.payer_id === me && t.receiver_id === id) || (t.receiver_id === me && t.payer_id === id);
      if (!mine) return;
      if (!best) { best = t; return; }
      var d = String(t.txn_date || ""), bd = String(best.txn_date || "");
      if (d > bd || (d === bd && String(t.created_at || "") > String(best.created_at || ""))) best = t;
    });
    return best;
  }
  function latestTxn() {
    // Most recent record involving me (any person).
    var me = myId(), best = null;
    txns.forEach(function (t) {
      var mine = t.payer_id === me || t.receiver_id === me;
      if (!mine) return;
      if (!best) { best = t; return; }
      var d = String(t.txn_date || ""), bd = String(best.txn_date || "");
      if (d > bd || (d === bd && String(t.created_at || "") > String(best.created_at || ""))) best = t;
    });
    return best;
  }
  function latestLine(t) {
    // One line carrying the note written in the box (khana / cash / anything),
    // so it is shared with the balance. "" when there is no record.
    if (!t) return "";
    var dir = t.payer_id === myId() ? "I gave " : "I took ";
    return "Latest: " + (t.note || "Food") + " · " + dir + fmtRs(t.amount) + " · " + fmtDateLong(t.txn_date);
  }
  function personShareText(p) {
    var s = personStats(p.id);
    var netLine = s.net > 0 ? "Net: " + fmtRs(s.net) + " — you have to pay me."
      : s.net < 0 ? "Net: " + fmtRs(-s.net) + " — I have to pay you." : "Net: settled up — no balance.";
    var latest = latestLine(latestTxnWith(p.id));
    return "Easy Khata — Food Balance\n" +
      myName() + " & " + (p.name || p.email) + "\n\n" +
      "Debit (I gave): " + fmtRs(s.given) + "\n" +
      "Credit (I took): " + fmtRs(s.taken) + "\n\n" +
      netLine + "\n" +
      (latest ? "\n" + latest + "\n" : "") +
      "\nEasy Khata: " + APP_SHORT_URL;
  }
  function personShortText(p) {
    // WhatsApp message: SIRF current balance — koi Debit/Credit, koi Latest,
    // koi history nahi. Share button poora detailed message bhejta hai
    // (personShareText), WhatsApp sirf ye chhota balance message.
    var s = personStats(p.id);
    var head = "Hi " + (p.name || "") + ",\n\n";
    var line;
    if (s.net > 0) line = "As per Easy Khata, you have to pay me " + fmtRs(s.net) + " (food balance).";
    else if (s.net < 0) line = "As per Easy Khata, I have to pay you " + fmtRs(-s.net) + " (food balance).";
    else line = "As per Easy Khata, our food balance is settled up — no balance.";
    return head + line + "\n\n— " + myName() + "\nEasy Khata: " + APP_SHORT_URL;
  }
  function shareText(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    return copyText(text).then(function () { setPeopleMsg("Text copy ho gaya — WhatsApp ya kisi bhi app mein paste karein.", true); });
  }
  function findPerson(id) {
    var found = null;
    profiles.forEach(function (p) { if (p.id === id) found = p; });
    if (!found) myContacts.forEach(function (c) { if (c.id === id) found = c; });
    return found;
  }
  function sharePerson(id) {
    var p = findPerson(id);
    if (!p) return;
    shareText(personShareText(p));
  }
  var confirmCallback = null;
  function askConfirm(title, text, okLabel, cb) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmOkBtn").textContent = okLabel || "Confirm";
    confirmCallback = cb;
    $("confirmOverlay").hidden = false;
  }
  function closeConfirm() {
    $("confirmOverlay").hidden = true;
    confirmCallback = null;
  }
  function openWaLink(url) {
    // window.open often does nothing in a PWA — clicking a real link is more reliable.
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 500);
  }
  function sendRemindNotif(id, text) {
    // If an unread reminder already exists, don't send another (to stop spam).
    sb("khata_notifications?select=id&user_id=eq." + encodeURIComponent(id) + "&actor_id=eq." + encodeURIComponent(myId()) + "&kind=eq.remind&is_read=eq.false&limit=1")
      .then(function (res) {
        if (res.ok && res.body && res.body.length) return;
        return sb("khata_notifications", { method: "POST", body: {
          user_id: id, actor_id: myId(), txn_id: null, kind: "remind",
          title: myName() + " ne yaad dilaya", body: text
        } });
      }).catch(function () {});
  }
  function remindPerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var text = personShortText(p); // WhatsApp: sirf current balance (chhota message)
    var s = personStats(id);
    var real = false;
    profiles.forEach(function (x) { if (x.id === id) real = true; });
    if (p.phone && normPhone(p.phone)) {
      copyText(text).catch(function () {});
      openWaLink(waLink(p.phone, text));
      setPeopleMsg("WhatsApp khul raha hai — agar na khule to text copy hai, WhatsApp mein paste karein.", true);
      if (real && s.net) sendRemindNotif(id, text);
      return;
    }
    copyText(text).then(function () {
      setPeopleMsg("Is dost ka WhatsApp number nahi hai — reminder text copy ho gaya, khud bhej dein.", true);
      if (real && s.net) sendRemindNotif(id, text);
    }).catch(function () {
      setPeopleMsg("Copy nahi hua — number save karein ya text khud likh kar bhej dein.", false);
    });
  }
  function settlePerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var s = personStats(id);
    if (!s.net) return;
    var amt = Math.abs(s.net);
    var who = s.net > 0 ? (p.name || p.email) + " mujhe " + fmtRs(amt) + " denge" : "Main " + (p.name || p.email) + " ko " + fmtRs(amt) + " dunga";
    askConfirm("Hisaab barabar karein?", who + " — " + fmtRs(amt) + " ka settlement record ban jayega.", "Confirm karein", function () {
    var me = myId();
    var body = {
      id: newUuid(),
      payer_id: s.net > 0 ? id : me,
      receiver_id: s.net > 0 ? me : id,
      amount: amt,
      note: "Settled up — settlement",
      txn_date: todayLocal(),
      created_by: me
    };
    if (isOffline()) {
      offlineTxnInsert(body);
      setPeopleMsg("Settlement offline save ho gayi — online hote hi sync hogi.", true);
      return;
    }
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        if (!res.ok) { setPeopleMsg("Settlement save nahi hua — dobara try karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(id, "settle", created); triggerPush(id, "Hisaab barabar ho gaya", notifBodyFor(created, id)); }
        setPeopleMsg("Hisaab barabar ho gaya!", true);
        loadAll();
      }).catch(function () {
        offlineTxnInsert(body);
        setPeopleMsg("Settlement offline save ho gayi — online hote hi sync hogi.", true);
      });
    });
  }
  function shareAll() {
    var given = 0, taken = 0;
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === myId()) given += a;
      if (t.receiver_id === myId()) taken += a;
    });
    var net = given - taken; // +: I am owed, -: I owe
    var netLine = net > 0 ? "Net: " + fmtRs(net) + " — I will receive."
      : net < 0 ? "Net: " + fmtRs(-net) + " — I have to pay." : "Net: settled up — no balance.";
    var latest = latestLine(latestTxn());
    var text = "Easy Khata — My Food Balance\n" +
      myName() + "\n\n" +
      "Debit (I gave): " + fmtRs(given) + "\n" +
      "Credit (I took): " + fmtRs(taken) + "\n\n" +
      netLine + "\n" +
      (latest ? "\n" + latest + "\n" : "") +
      "\nEasy Khata: " + APP_SHORT_URL;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    copyText(text).then(function () { setTxnMsg("Balance copy ho gaya — kisi bhi app mein paste karein.", true); });
  }

  function renderPeople() {
    var map = peopleMap();
    var total = Object.keys(map).length;
    var ids = Object.keys(map);
    var q = peopleSearchText.trim().toLowerCase();
    if (q) {
      ids = ids.filter(function (id) { return String(map[id].name || "").toLowerCase().indexOf(q) !== -1; });
    }
    if (!total) {
      $("peopleList").innerHTML = '<p class="empty">Abhi koi dost nahi — dost account banayenge to yahan nazar aayenge.</p>';
      return;
    }
    if (!ids.length) {
      $("peopleList").innerHTML = '<p class="empty">Is naam ka koi dost nahi mila.</p>';
      return;
    }
    var html = "";
    ids.forEach(function (id) {
      var p = map[id];
      var net = p.given - p.taken; // +: they owe me, -: I owe them
      var cls = net > 0 ? "pos" : net < 0 ? "neg" : "zero";
      var netText = net > 0 ? "+ " + fmtRs(net) : net < 0 ? "− " + fmtRs(-net) : "Settled";
      var last = p.last ? "Aakhri len-den: " + fmtDateLong(p.last) : "Abhi koi len-den nahi";
      html += '<button class="person" type="button" data-person="' + esc(id) + '">' +
        '<span class="p-avatar">' + avatarHtml(p.avatar_url, initials(p.name)) + '</span>' +
        '<span class="p-main"><span class="p-name">' + esc(p.name) + (p.manual ? ' <span class="tag-manual">Manual</span>' : '') + '</span>' +
        '<span class="p-last">' + esc(last) + '</span></span>' +
        '<span class="p-net ' + cls + '">' + esc(netText) + '</span></button>';
    });
    $("peopleList").innerHTML = html;
    if (detailPersonId) renderPersonDetail();
  }

  function renderAccount() {
    var me = myProfile();
    var name = (me && me.name) || myName() || "";
    var initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
    setAvatarEl($("headerAvatar"), me && me.avatar_url, initial);
    $("headerName").textContent = name || "Easy Khata";
    setAvatarEl($("acctAvatar"), me && me.avatar_url, initial);
    $("acctName").textContent = name || "—";
    var phoneTxt = myPhone || "Number nahi diya";
    if (me && me.username) phoneTxt += " · @" + me.username;
    $("acctPhone").textContent = phoneTxt;
  }
  function openPersonDetail(id) {
    if (!findPerson(id)) return;
    detailPersonId = id;
    renderPersonDetail();
    showView("detail");
  }
  function renderPersonDetail() {
    var id = detailPersonId;
    var p = findPerson(id);
    if (!p) { detailPersonId = null; showView("khata"); return; }
    var s = personStats(id);
    var list = personTxns(id);
    var first = null;
    list.forEach(function (t) { var d = String(t.txn_date || ""); if (d && (!first || d < first)) first = d; });
    setAvatarEl($("detailAvatar"), p.avatar_url, initials(p.name || p.email));
    $("detailName").textContent = p.name || p.email;
    $("detailSince").textContent = first ? "Pehla len-den: " + fmtDateLong(first) : "Abhi koi len-den nahi";
    var banner = $("detailBanner");
    if (s.net > 0) {
      banner.className = "detail-banner receive";
      banner.innerHTML = '<span class="db-icon">↓</span><strong>' + esc(fmtRs(s.net)) + '</strong><span>Maine lene hain</span>';
    } else if (s.net < 0) {
      banner.className = "detail-banner give";
      banner.innerHTML = '<span class="db-icon">↑</span><strong>' + esc(fmtRs(-s.net)) + '</strong><span>Maine dene hain</span>';
    } else {
      banner.className = "detail-banner settled";
      banner.innerHTML = '<span class="db-icon">✓</span><strong>Settled</strong><span>Koi balance nahi</span>';
    }
    $("detailSettleBtn").hidden = !s.net;
    var isManual = false;
    myContacts.forEach(function (c) { if (c.id === id) isManual = true; });
    $("detailRemoveBtn").hidden = !isManual;
    renderDetailTxns(list);
  }
  function renderDetailTxns(list) {
    var me = myId();
    if (!list.length) {
      $("detailTxns").innerHTML = '<p class="empty">Abhi koi len-den nahi — neeche se pehla record add karein.</p>';
      refreshScrollHints();
      return;
    }
    // Newest first — defensive sort (API already returns this order, but the running
    // balance below is only right if the order is newest-first).
    var sorted = list.slice().sort(function (a, b) {
      var d = String(b.txn_date || "").localeCompare(String(a.txn_date || ""));
      if (d) return d;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    // Running balance, oldest first, then show newest first.
    var asc = sorted.slice().reverse();
    var run = 0;
    var balById = {};
    asc.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === me) run += a;
      else if (t.receiver_id === me) run -= a;
      balById[t.id] = run;
    });
    var html = '<div class="dtable-head"><span>TIME</span><span>DIYE</span><span>LIYE</span></div>';
    sorted.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var iGave = t.payer_id === me;
      var bal = balById[t.id];
      var balCls = bal > 0 ? "pos" : bal < 0 ? "neg" : "zero";
      var balText = bal > 0 ? "Bal: " + fmtRs(bal) + " · lene hain"
        : bal < 0 ? "Bal: " + fmtRs(-bal) + " · dene hain" : "Bal: Rs 0 · settled";
      var timeStr = fmtTime(t.created_at);
      var btns = "";
      if (isTxnLocked(t)) {
        btns = '<span class="t-lock">🔒 Settled</span>';
      } else if (t.created_by === me) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-edit="' + esc(t.id) + '">Edit</button>' +
          '<button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      } else if (isAdmin()) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      }
      html += '<div class="drow">' +
        '<div class="d-time"><span class="d-ico ' + (iGave ? "up" : "down") + '">' + (iGave ? "↑" : "↓") + '</span>' +
        '<div><div class="d-date">' + esc(fmtDateLong(t.txn_date)) + (timeStr ? " · " + esc(timeStr) : "") + '</div>' +
        '<div class="d-note">' + esc(t.note || "Food") + '</div>' +
        '<div class="d-bal ' + balCls + '">' + esc(balText) + '</div>' + btns + '</div></div>' +
        '<div class="d-amt ' + (iGave ? "diye" : "") + '">' + (iGave ? esc(fmtRs(a)) : "") + '</div>' +
        '<div class="d-amt ' + (!iGave ? "liye" : "") + '">' + (!iGave ? esc(fmtRs(a)) : "") + '</div>' +
        '</div>';
    });
    $("detailTxns").innerHTML = html;
    refreshScrollHints();
  }
  function openAddFor(personId, dir) {
    // From the detail screen: open the add form, pre-filled for this person + direction.
    resetTxnForm();
    showView("khata");
    var sel = $("txnPerson");
    if (sel) sel.value = personId;
    var radio = document.querySelector('input[name="txnDir"][value="' + dir + '"]');
    if (radio) radio.checked = true;
    var card = $("txnFormCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    var amt = $("txnAmount");
    if (amt) setTimeout(function () { amt.focus({ preventScroll: true }); }, 400);
  }

  function renderPersonSelect() {
    var me = myId();
    var sel = $("txnPerson");
    var prev = sel.value;
    var html = "";
    var real = "";
    profiles.forEach(function (p) {
      if (p.id === me) return;
      real += '<option value="' + esc(p.id) + '">' + esc(p.name || p.email) + '</option>';
    });
    if (real) html += '<optgroup label="App par dost">' + real + '</optgroup>';
    var manual = "";
    myContacts.forEach(function (c) {
      manual += '<option value="' + esc(c.id) + '">' + esc(c.name || "Unknown") + '</option>';
    });
    if (manual) html += '<optgroup label="Mere contacts (manual)">' + manual + '</optgroup>';
    sel.innerHTML = html || '<option value="">(koi dost nahi)</option>';
    if (prev) sel.value = prev;
  }

  function renderTxnFilterOptions() {
    var sel = $("txnFilterPerson");
    var prev = sel.value;
    var html = '<option value="">Sab</option>';
    profiles.forEach(function (p) {
      html += '<option value="' + esc(p.id) + '">' + esc(p.name || p.email) + '</option>';
    });
    myContacts.forEach(function (c) {
      html += '<option value="' + esc(c.id) + '">' + esc(c.name || "Unknown") + ' (manual)</option>';
    });
    sel.innerHTML = html;
    if (prev) sel.value = prev;
  }

  function filteredTxns() {
    var q = txnSearchText.trim().toLowerCase();
    return txns.filter(function (t) {
      if (txnFilterPerson && t.payer_id !== txnFilterPerson && t.receiver_id !== txnFilterPerson) return false;
      if (txnFromDate && String(t.txn_date || "") < txnFromDate) return false;
      if (txnToDate && String(t.txn_date || "") > txnToDate) return false;
      if (!q) return true;
      var hay = (profileName(t.payer_id) + " " + profileName(t.receiver_id) + " " + (t.note || "") + " " + String(t.amount) + " " + fmtDate(t.txn_date)).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
  function exportCsv() {
    var list = filteredTxns();
    if (!list.length) { setTxnMsg("Download ke liye koi record nahi.", false); return; }
    var rows = [["Date", "Giver", "Receiver", "Amount (Rs)", "Food / Note"]];
    list.forEach(function (t) {
      rows.push([fmtDate(t.txn_date), profileName(t.payer_id), profileName(t.receiver_id), Number(t.amount) || 0, t.note || "Food"]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "easy-khata-" + todayLocal() + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    setTxnMsg("CSV download ho gaya (" + list.length + " records).", true);
  }
  // Scrollable history boxes (v21): box tab scrollable ho (scrollHeight >
  // clientHeight) to neeche wali hint dikhate hain — user ko pata chale ke
  // andar scroll karke purane records dekh sakta hai.
  function updateScrollHint(boxEl, hintEl) {
    if (!boxEl || !hintEl) return;
    try {
      hintEl.hidden = !(boxEl.scrollHeight > boxEl.clientHeight + 4);
    } catch (e) { hintEl.hidden = true; }
  }
  function refreshScrollHints() {
    updateScrollHint($("txnList"), $("txnScrollHint"));
    updateScrollHint($("detailTxns"), $("detailScrollHint"));
  }
  window.addEventListener("resize", refreshScrollHints);
  function renderTxns() {
    var me = myId();
    var list = filteredTxns();
    // Live filter count (v21): koi filter laga ho to batayein kitne records mile.
    var fc = $("filterCount");
    if (fc) {
      var anyFilter = !!(txnSearchText || txnFilterPerson || txnFromDate || txnToDate);
      fc.hidden = !anyFilter;
      if (anyFilter) fc.textContent = list.length + " records dikh rahe hain";
    }
    if (!txns.length) {
      $("txnList").innerHTML = '<p class="empty">Abhi koi record nahi — upar se pehla record add karein.</p>';
      refreshScrollHints();
      return;
    }
    if (!list.length) {
      $("txnList").innerHTML = '<p class="empty">Is search/filter se koi record nahi mila.</p>';
      refreshScrollHints();
      return;
    }
    var html = "";
    list.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var iGave = t.payer_id === me;
      var iTook = t.receiver_id === me;
      var amtCls = iGave ? "given" : iTook ? "taken" : "";
      var sign = iGave ? "− " : iTook ? "+ " : "";
      var locked = isTxnLocked(t);
      var btns = "";
      if (locked) {
        btns = '<span class="t-lock">🔒 Settled</span>';
      } else if (t.created_by === me) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-edit="' + esc(t.id) + '">Edit</button>' +
          '<button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      } else if (isAdmin()) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      }
      html += '<div class="txn"><div class="t-main">' + esc(profileName(t.payer_id)) + ' → ' + esc(profileName(t.receiver_id)) + '</div>' +
        '<div class="t-sub">' + esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + '</div>' +
        '<div class="t-foot"><span class="t-amt ' + amtCls + '">' + sign + esc(fmtRs(a)) + '</span>' + btns + '</div></div>';
    });
    $("txnList").innerHTML = html;
    refreshScrollHints();
  }

  /* ---------- add / edit / delete ---------- */
  function resetTxnForm() {
    setSplitMode(false);
    editingId = null;
    $("txnFormTitle").textContent = "Naya record";
    $("txnForm").querySelector('button[type="submit"]').textContent = "Save karein";
    $("cancelEditBtn").hidden = true;
    $("txnAmount").value = "";
    $("txnNote").value = "";
    $("txnDate").value = todayLocal();
    setTxnMsg("");
  }
  function startEditTxn(id) {
    var t = null;
    txns.forEach(function (x) { if (x.id === id) t = x; });
    if (!t || t.created_by !== myId()) return;
    if (isTxnLocked(t)) { setTxnMsg(LOCK_MSG, false); return; } // settled history — handler-level guard
    showView("khata");
    setSplitMode(false);
    var me = myId();
    var other = t.payer_id === me ? t.receiver_id : t.payer_id;
    var dir = t.payer_id === me ? "given" : "taken";
    editingId = id;
    $("txnPerson").value = other;
    var radio = document.querySelector('input[name="txnDir"][value="' + dir + '"]');
    if (radio) radio.checked = true;
    $("txnAmount").value = t.amount;
    $("txnNote").value = t.note || "";
    $("txnDate").value = String(t.txn_date || "").slice(0, 10);
    $("txnFormTitle").textContent = "Record badlein";
    $("txnForm").querySelector('button[type="submit"]').textContent = "Save karein";
    $("cancelEditBtn").hidden = false;
    $("txnForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  /* ---------- group split (split equally) ---------- */
  function renderSplitList() {
    var me = myId();
    var html = "";
    profiles.forEach(function (p) {
      if (p.id === me) return;
      html += '<label><input type="checkbox" data-split-person="' + esc(p.id) + '"> ' + esc(p.name || p.email) + '</label>';
    });
    myContacts.forEach(function (c) {
      html += '<label><input type="checkbox" data-split-person="' + esc(c.id) + '"> ' + esc(c.name || "Unknown") + ' (manual)</label>';
    });
    $("splitList").innerHTML = html || '<p class="empty">Abhi koi dost nahi.</p>';
    updateSplitHint();
  }
  function selectedSplitIds() {
    var ids = [];
    var boxes = document.querySelectorAll("#splitList input[data-split-person]:checked");
    for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].getAttribute("data-split-person"));
    return ids;
  }
  function updateSplitHint() {
    var total = parseFloat($("txnAmount").value) || 0;
    var ids = selectedSplitIds();
    if (!ids.length) { $("splitHint").textContent = "Pehle dost chunein, phir raqam likhein."; return; }
    if (!total || total <= 0) { $("splitHint").textContent = ids.length + " dost chune — ab kull raqam likhein."; return; }
    var people = ids.length + 1; // friends + you — your share counts too
    var share = Math.floor(total / people * 100) / 100;
    // Last friend gets the leftover paisa so the split adds up to the total exactly.
    var remainder = Math.round((total - share * people) * 100) / 100;
    var extra = remainder > 0 ? " · aakhri dost ko " + fmtRs(share + remainder) + " (baaqi paisay)" : "";
    $("splitHint").textContent = "Har aik ka hissa: " + fmtRs(share) + " (" + ids.length + " dost + aap · kull " + fmtRs(total) + " · aap ka hissa " + fmtRs(share) + ")" + extra;
  }
  function setSplitMode(on) {
    splitMode = on;
    $("txnSplit").checked = on;
    $("txnPersonRow").hidden = on;
    $("txnDirRow").hidden = on;
    $("splitBox").hidden = !on;
    if (on) renderSplitList();
  }
  function addSplitTxns(amount, note, date, btn) {
    var ids = selectedSplitIds();
    if (!ids.length) { setTxnMsg("Baantne ke liye kam se kam aik dost chunein.", false); return; }
    var me = myId();
    var people = ids.length + 1; // friends + you — the total splits equally across everyone, including your share
    var share = Math.floor(amount / people * 100) / 100;
    if (share <= 0) { setTxnMsg("Raqam baantne ke liye bohat choti hai.", false); return; }
    btn.disabled = true;
    var done = 0, failed = 0, i = 0, offlineSaved = false;
    function next() {
      if (i >= ids.length) {
        btn.disabled = false;
        if (failed) setTxnMsg(done + " records save ho gaye, " + failed + " fail — dobara check karein.", false);
        else if (offlineSaved) { setTxnMsg(ids.length + " records offline save ho gaye — online hote hi sync honge!", true); resetTxnForm(); }
        else { setTxnMsg(ids.length + " records save ho gaye (barabar baant diye)!", true); resetTxnForm(); }
        loadAll();
        return;
      }
      var id = ids[i++];
      var amt = (i === ids.length) ? Math.round((amount - share * ids.length) * 100) / 100 : share;
      var recBody = {
        id: newUuid(),
        payer_id: me, receiver_id: id, amount: amt,
        note: (note || "Food") + " (split equally)", txn_date: date, created_by: me
      };
      if (isOffline()) {
        // Offline: record local save karein, sync baad mein hoga.
        offlineTxnInsert(recBody);
        done++;
        offlineSaved = true;
        next();
        return;
      }
      sb("khata_transactions", { method: "POST", prefer: "return=representation", body: recBody }).then(function (res) {
        if (res.ok) { done++; var created = res.body && res.body[0]; if (created) { sendNotif(id, "record", created); triggerPush(id, myName() + " ne record add kiya", notifBodyFor(created, id)); } }
        else failed++;
        next();
      })
      .catch(function () {
        // Network error: record offline save karein, sync baad mein hoga.
        offlineTxnInsert(recBody);
        done++;
        offlineSaved = true;
        next();
      });
    }
    next();
  }

  function addTxn(e) {
    e.preventDefault();
    if (!dbReady) { setTxnMsg("Database setup baaqi hai.", false); return; }
    var person = $("txnPerson").value;
    var dir = (document.querySelector('input[name="txnDir"]:checked') || {}).value || "given";
    var amount = parseFloat($("txnAmount").value);
    var note = $("txnNote").value.trim();
    var date = $("txnDate").value;
    if (!splitMode && !person) { setTxnMsg("Pehle dost chunein.", false); return; }
    if (!amount || amount <= 0) { setTxnMsg("Sahi raqam likhein.", false); return; }
    if (!date) { setTxnMsg("Tareekh likhein.", false); return; }
    if (splitMode && !editingId) {
      addSplitTxns(amount, note, date, e.target.querySelector('button[type="submit"]'));
      return;
    }
    var me = myId();
    var body = {
      payer_id: dir === "given" ? me : person,
      receiver_id: dir === "given" ? person : me,
      amount: amount,
      note: note || "Food",
      txn_date: date,
      created_by: me
    };
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    var recId = newUuid(); // client UUID pehle se — lost response par retry duplicate nahi banayega
    if (editingId) {
      var editId = editingId;
      if (isOffline()) {
        // Offline edit: local state + outbox. Settled history kabhi edit nahi hoti.
        var t = null;
        txns.forEach(function (x) { if (x.id === editId) t = x; });
        if (t && isTxnLocked(t)) { btn.disabled = false; setTxnMsg(LOCK_MSG, false); return; }
        offlineTxnUpdate(editId, body);
        resetTxnForm();
        setTxnMsg("Edit offline save ho gayi — online hote hi sync hogi.", true);
        btn.disabled = false;
        return;
      }
      sb("khata_transactions?id=eq." + encodeURIComponent(editId), { method: "PATCH", prefer: "return=minimal", body: body })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) { setTxnMsg("Edit save nahi hui — dobara try karein.", false); return; }
          resetTxnForm();
          setTxnMsg("Record update ho gaya!", true);
          loadAll();
        }).catch(function () {
          btn.disabled = false;
          offlineTxnUpdate(editId, body);
          resetTxnForm();
          setTxnMsg("Edit offline save ho gayi — online hote hi sync hogi.", true);
        });
      return;
    }
    if (isOffline()) {
      offlineTxnInsert(Object.assign({ id: recId }, body));
      $("txnAmount").value = "";
      $("txnNote").value = "";
      setTxnMsg("Record offline save ho gaya — online hote hi sync hoga.", true);
      btn.disabled = false;
      return;
    }
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: Object.assign({ id: recId }, body) })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setTxnMsg("Record save nahi hua — dobara try karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(person, "record", created); triggerPush(person, myName() + " ne record add kiya", notifBodyFor(created, person)); }
        $("txnAmount").value = "";
        $("txnNote").value = "";
        setTxnMsg("Record save ho gaya!", true);
        loadAll();
      }).catch(function () {
        btn.disabled = false;
        offlineTxnInsert(Object.assign({ id: recId }, body));
        $("txnAmount").value = "";
        $("txnNote").value = "";
        setTxnMsg("Record offline save ho gaya — online hote hi sync hoga.", true);
      });
  }

  function deleteTxn(id) {
    var t = null;
    txns.forEach(function (x) { if (x.id === id) t = x; });
    if (!t) return;
    if (isTxnLocked(t)) { setTxnMsg(LOCK_MSG, false); return; } // settled history — handler-level guard
    if (t.created_by !== myId() && !isAdmin()) return;
    askConfirm("Record delete karein?", "Ye record hamesha ke liye delete ho jayega.", "Delete karein", function () {
    if (isOffline()) {
      offlineTxnDelete(id);
      setTxnMsg("Record offline delete ho gaya — online hote hi sync hoga.", true);
      return;
    }
    sb("khata_transactions?id=eq." + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) { setTxnMsg("Delete nahi hua.", false); return; }
        loadAll();
      }).catch(function () {
        offlineTxnDelete(id);
        setTxnMsg("Record offline delete ho gaya — online hote hi sync hoga.", true);
      });
    });
  }

  /* ---------- wire up ---------- */
  $("tabLogin").addEventListener("click", function () { authMode = "login"; renderAuthMode(); });
  $("tabSignup").addEventListener("click", function () { authMode = "signup"; renderAuthMode(); });
  $("authSubmitBtn").addEventListener("click", doAuth);
  $("forgotLink").addEventListener("click", function () { showForgot(true); });
  wireEye("authEye", "authPassword");
  wireEye("resetEye1", "resetPassword");
  wireEye("resetEye2", "resetPassword2");
  wireEye("changeEye1", "newPass1");
  wireEye("changeEye2", "newPass2");
  wireEye("adminEye1", "adminNewPass1");
  wireEye("adminEye2", "adminNewPass2");
  $("forgotBackBtn").addEventListener("click", function () { showForgot(false); });
  $("forgotSendBtn").addEventListener("click", doForgot);
  $("resetBtn").addEventListener("click", doReset);
  $("authPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doAuth(); });
  $("logoutBtn").addEventListener("click", function () { saveSession(null); showAuth(); });
  $("navKhata").addEventListener("click", function () { showView("khata"); });
  $("navAccount").addEventListener("click", function () { showView("account"); });
  $("navAdminBtn").addEventListener("click", showAdminView);
  $("adminBackBtn").addEventListener("click", function () { showView("account"); });
  $("peopleSearch").addEventListener("input", function (e) { peopleSearchText = e.target.value; renderPeople(); });
  $("addPersonBtn").addEventListener("click", function () {
    showView("khata");
    var card = $("txnFormCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    var b = $("addContactBox");
    b.hidden = false;
    $("newContactName").focus();
  });
  $("detailBackBtn").addEventListener("click", function () { showView("khata"); });
  $("detailShareBtn").addEventListener("click", function () { if (detailPersonId) sharePerson(detailPersonId); });
  $("detailWaBtn").addEventListener("click", function () { if (detailPersonId) remindPerson(detailPersonId); });
  $("detailSettleBtn").addEventListener("click", function () { if (detailPersonId) settlePerson(detailPersonId); });
  $("detailRemoveBtn").addEventListener("click", function () { if (detailPersonId) deleteContact(detailPersonId); });
  $("detailDiyeBtn").addEventListener("click", function () { if (detailPersonId) openAddFor(detailPersonId, "given"); });
  $("detailLiyeBtn").addEventListener("click", function () { if (detailPersonId) openAddFor(detailPersonId, "taken"); });
  $("acctEditBtn").addEventListener("click", function () { var b = $("acctPhoneBox"); b.hidden = !b.hidden; if (!b.hidden) fillProfileForm(); });
  $("acctShareBtn").addEventListener("click", shareAll);
  $("acctShareMenuBtn").addEventListener("click", shareAll);
  $("acctLedgerBtn").addEventListener("click", function () {
    showView("khata");
    var card = $("ledgerCard");
    if (card) setTimeout(function () { card.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  });
  $("acctBackupBtn").addEventListener("click", exportCsv);
  $("acctPushBtn").addEventListener("click", enablePushFromButton);
  $("acctPrivacyBtn").addEventListener("click", function () { var b = $("privacyBox"); b.hidden = !b.hidden; });
  $("acctRateBtn").addEventListener("click", function () {
    shareText("Easy Khata — doston ke saath khane ka hisaab, aasan tareeqe se.\n\nEasy Khata: " + APP_SHORT_URL);
  });
  $("acctWaBtn").addEventListener("click", function () {
    // WhatsApp helpline — Asad ka apna number (03098851445).
    openWaLink("https://wa.me/923098851445?text=" + encodeURIComponent("Easy Khata — madad chahiye"));
  });
  $("changePassBtn").addEventListener("click", function () { var b = $("changePassBox"); b.hidden = !b.hidden; });
  $("savePassBtn").addEventListener("click", doChangePass);
  $("txnForm").addEventListener("submit", addTxn);
  $("cancelEditBtn").addEventListener("click", resetTxnForm);
  $("refreshBtn").addEventListener("click", loadAll);
  $("shareAllBtn").addEventListener("click", shareAll);
  $("savePhoneBtn").addEventListener("click", saveProfile);
  $("profilePicInput").addEventListener("change", function () {
    var f = $("profilePicInput").files && $("profilePicInput").files[0];
    if (!f) return;
    if (!/^image\//.test(f.type || "")) { setPhoneMsg("Sirf photo (image) chunein.", false); $("profilePicInput").value = ""; return; }
    if (f.size > 8 * 1024 * 1024) { setPhoneMsg("Photo 8MB se chhoti honi chahiye.", false); $("profilePicInput").value = ""; return; }
    pendingAvatarFile = f; removeAvatar = false;
    try {
      var rd = new FileReader();
      rd.onload = function () { var prev = $("profilePicPreview"); if (prev) prev.innerHTML = '<img src="' + esc(String(rd.result || "")) + '" alt="">'; };
      rd.readAsDataURL(f);
    } catch (e) {}
    $("removePicBtn").hidden = false;
    setPhoneMsg("");
  });
  $("removePicBtn").addEventListener("click", function () {
    pendingAvatarFile = null; removeAvatar = true;
    $("profilePicInput").value = "";
    var name = $("myNameInput").value.trim() || myName() || "";
    var initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
    setAvatarEl($("profilePicPreview"), null, initial);
    $("removePicBtn").hidden = true;
  });
  $("txnSearch").addEventListener("input", function (e) { txnSearchText = e.target.value; renderTxns(); });
  $("txnFilterPerson").addEventListener("change", function (e) { txnFilterPerson = e.target.value; renderTxns(); });
  // Live date filters (v21): date chunte hi list update ho — change ke saath
  // input bhi sunte hain, taaki date picker ke har badlav par filter chal jaye.
  $("txnFrom").addEventListener("change", function (e) { txnFromDate = e.target.value; renderTxns(); });
  $("txnFrom").addEventListener("input", function (e) { txnFromDate = e.target.value; renderTxns(); });
  $("txnTo").addEventListener("change", function (e) { txnToDate = e.target.value; renderTxns(); });
  $("txnTo").addEventListener("input", function (e) { txnToDate = e.target.value; renderTxns(); });
  $("clearFilterBtn").addEventListener("click", function () {
    txnSearchText = ""; txnFilterPerson = ""; txnFromDate = ""; txnToDate = "";
    $("txnSearch").value = ""; $("txnFilterPerson").value = ""; $("txnFrom").value = ""; $("txnTo").value = "";
    renderTxns();
  });
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("txnSplit").addEventListener("change", function (e) { setSplitMode(e.target.checked); });
  $("txnAmount").addEventListener("input", function () { if (splitMode) updateSplitHint(); });
  $("splitList").addEventListener("change", function () { updateSplitHint(); });
  $("peopleList").addEventListener("click", function (e) {
    var row = e.target.closest ? e.target.closest("[data-person]") : null;
    if (row) openPersonDetail(row.getAttribute("data-person"));
  });
  $("txnList").addEventListener("click", function (e) {
    var ed = e.target.closest ? e.target.closest("[data-edit]") : null;
    if (ed) { startEditTxn(ed.getAttribute("data-edit")); return; }
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });
  $("detailTxns").addEventListener("click", function (e) {
    var ed = e.target.closest ? e.target.closest("[data-edit]") : null;
    if (ed) { startEditTxn(ed.getAttribute("data-edit")); return; }
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });
  $("adminUserList").addEventListener("click", function (e) {
    var d = e.target.closest ? e.target.closest("[data-admin-del]") : null;
    if (d) { deleteUser(d.getAttribute("data-admin-del")); return; }
    var o = e.target.closest ? e.target.closest("[data-admin-open]") : null;
    if (o) openAdminUser(o.getAttribute("data-admin-open"));
  });
  $("adminUserBackBtn").addEventListener("click", function () { showView("admin"); renderAdmin(); });
  $("adminEditToggleBtn").addEventListener("click", function () { var b = $("adminEditBox"); b.hidden = !b.hidden; });
  $("adminPassToggleBtn").addEventListener("click", function () { var b = $("adminPassBox"); b.hidden = !b.hidden; });
  $("adminEditSaveBtn").addEventListener("click", saveAdminEdit);
  $("adminPassSaveBtn").addEventListener("click", saveAdminPass);
  $("adminBlockBtn").addEventListener("click", toggleAdminBlock);
  $("adminDeleteBtn").addEventListener("click", function () { if (adminCurrentUser) deleteUser(adminCurrentUser.id); });
  $("adminSetSaveBtn").addEventListener("click", saveAdminSet);
  $("adminAddUserBtn").addEventListener("click", function () { var b = $("adminAddUserBox"); b.hidden = !b.hidden; setAdminAddMsg(""); });
  $("adminAddSaveBtn").addEventListener("click", createAdminUser);
  // v22: Account mein "Notifications On karein" button (acctPushBtn) — user
  // gesture se enablePush chalti hai; auto-ask (maybeAskPushPermission) bhi
  // app open par chalta hai. Off karna browser ke site settings se hota hai.
  $("confirmOkBtn").addEventListener("click", function () { var cb = confirmCallback; closeConfirm(); if (cb) cb(); });
  $("confirmCancelBtn").addEventListener("click", closeConfirm);
  $("confirmOverlay").addEventListener("click", function (e) { if (e.target === $("confirmOverlay")) closeConfirm(); });
  $("saveContactBtn").addEventListener("click", addContact);
  $("pickContactBtn").addEventListener("click", pickContact);
  $("addContactToggleBtn").addEventListener("click", function () {
    var b = $("addContactBox");
    b.hidden = !b.hidden;
    if (!b.hidden) $("newContactName").focus();
  });
  if (navigator.contacts && navigator.contacts.select) $("pickContactBtn").hidden = false;
  $("notifBtn").addEventListener("click", showNotifView);
  $("notifBackBtn").addEventListener("click", showAppView);
  $("markAllReadBtn").addEventListener("click", markAllNotifRead);
  $("notifList").addEventListener("click", function (e) {
    var row = e.target.closest ? e.target.closest("[data-notif]") : null;
    if (row) markNotifRead(row.getAttribute("data-notif"));
  });
  $("fabAdd").addEventListener("click", function () {
    showView("khata");
    var card = $("txnFormCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    var amt = $("txnAmount");
    if (amt) setTimeout(function () { amt.focus({ preventScroll: true }); }, 400);
  });

  /* ---------- app auto-update (new version arrives by itself) ---------- */
  var hadControllerAtLoad = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  var updateReloaded = false;
  function isFormDirty() {
    try {
      if (($("txnAmount").value || "").trim() !== "") return true;
      if (($("txnNote").value || "").trim() !== "") return true;
      if (editingId) return true;
      if (!$("addContactBox").hidden && ($("newContactName").value || "").trim() !== "") return true;
    } catch (e) {}
    return false;
  }
  function activateWaitingWorker(reg) {
    if (reg && reg.waiting) {
      try { reg.waiting.postMessage({ type: "SKIP_WAITING" }); } catch (e) {}
    }
  }
  function checkForAppUpdate() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(false);
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return false;
      activateWaitingWorker(reg);
      return reg.update().then(function () { activateWaitingWorker(reg); return true; }).catch(function () { return false; });
    }).catch(function () { return false; });
  }
  function wireAppUpdate() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      // No reload on first install — only when moving from an old version to a new one.
      if (!hadControllerAtLoad) return;
      if (updateReloaded) return;
      if (isFormDirty()) return; // if the form is filled, the new version comes on the next open
      updateReloaded = true;
      window.location.reload();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) checkForAppUpdate();
    });
    setInterval(function () { checkForAppUpdate(); }, 30 * 60 * 1000);
    checkForAppUpdate();
  }

  /* ---------- PWA: offline ---------- */
  function renderOffline() {
    var b = $("offlineBadge");
    if (!b) return;
    var pending = loadOutbox().length;
    if (!navigator.onLine || offlineMode) {
      // offlineMode = load fail hua aur cache se dikhaya ja raha hai
      // (navigator.onLine kabhi kabhi ghalat "online" batata hai).
      b.hidden = false;
      b.textContent = "Offline";
    } else if (pending > 0) {
      b.hidden = false;
      b.textContent = "Sync pending (" + pending + ")";
    } else {
      b.hidden = true;
    }
  }
  window.addEventListener("online", function () { renderOffline(); flushOutbox(); });
  window.addEventListener("offline", renderOffline);
  var offlineBadgeEl = $("offlineBadge");
  if (offlineBadgeEl) offlineBadgeEl.addEventListener("click", function () { flushOutbox(); });
  renderOffline();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
    wireAppUpdate();
  }

  /* ---------- theme ---------- */
  // Ek hi setting (localStorage "easykhata_theme") — header icon aur Account
  // toggle dono usi ko badalte hain aur dono ke icons sync rehte hain.
  // Icon woh dikhata hai jis par tap karne se theme badlegi: light mein 🌙
  // (dark karo), dark mein ☀️ (light karo).
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    // v21: themeIcon (Account row ka icon) hata diya — sirf header icon bachta hai.
    var hb = $("themeHeaderBtn");
    if (hb) hb.textContent = mode === "dark" ? "☀️" : "🌙";
    try { window.localStorage.setItem("easykhata_theme", mode); } catch (e) {}
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  }
  // v21: themeBtn (Account "Dark mode" row) hata diya — theme ab sirf header
  // icon (themeHeaderBtn) se badalta hai; applyTheme dono ko sync karta tha,
  // themeIcon ka null guard pehle se hai.
  $("themeHeaderBtn").addEventListener("click", toggleTheme);
  try {
    var savedTheme = window.localStorage.getItem("easykhata_theme");
    if (savedTheme === "dark" || savedTheme === "light") applyTheme(savedTheme);
  } catch (e) {}

  if (!API || !ANON) {
    hideSplash();
    $("setupBox").hidden = false;
    $("authWrap").hidden = true;
    return;
  }
  if (!handleAuthHash()) authValidate();
})();
