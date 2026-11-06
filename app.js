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
  var APP_SHORT_URL = "https://is.gd/4IoxbU"; // short link for shared messages (verified: redirects to APP_URL)

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

  function profileName(id) {
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === id) return profiles[i].name || profiles[i].email || "Unknown";
    }
    for (var j = 0; j < myContacts.length; j++) {
      if (myContacts[j].id === id) return myContacts[j].name || "Unknown";
    }
    return id === myId() ? myName() : "Private contact";
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
    $("authSubmitBtn").textContent = authMode === "signup" ? "Create account" : "Log in";
    $("authPassword").setAttribute("autocomplete", authMode === "signup" ? "new-password" : "current-password");
    setAuthMsg("");
  }
  function showAuth() {
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
    if (/invalid login/i.test(m)) return "Email or password is wrong.";
    if (/already registered|already exists/i.test(m)) return "An account already exists with this email — please log in.";
    if (/email not confirmed/i.test(m)) return "Email is not confirmed — check your inbox for the confirmation link, then log in.";
    if (/only request this after|too many requests|rate limit/i.test(m) || res.status === 429) return "Please wait a bit and try again.";
    if (/sending.*(mail|email)|confirmation.*(mail|email)|smtp/i.test(m)) return "There was a problem sending the confirmation email — please try again in a bit.";
    if (/password/i.test(m) && /short|least|6/i.test(m)) return "Password must be at least 6 characters.";
    if (/email/i.test(m) && /invalid/i.test(m)) return "Enter a valid email.";
    if (!m) { try { console.warn("EasyKhata auth error", res.status, res.body); } catch (e) {} }
    return m || "Something went wrong — please try again.";
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
        setAuthMsg("Account created! A confirmation link has been sent to your email — click it, then log in.", true);
        authMode = "login";
        renderAuthMode();
        return;
      }
      setAuthMsg(authErrorText(res), false);
      return;
    }
    saveSession(res.body);
    setAuthMsg("Done!", true);
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
    if (!email || !password) { setAuthMsg("Email and password are required.", false); return; }
    if (authMode === "signup" && !name) { setAuthMsg("Please enter your name.", false); return; }
    if (authMode === "signup" && phone && !normPhone(phone)) { setAuthMsg("Enter a valid phone number (example: 0300 1234567).", false); return; }
    if (password.length < 6) { setAuthMsg("Password must be at least 6 characters.", false); return; }
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
      setAuthMsg("Can't reach the internet or server.", false);
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
    if (!email) { setForgotMsg("Enter your email.", false); return; }
    var btn = $("forgotSendBtn");
    btn.disabled = true;
    authCall("/recover", { email: email, redirect_to: window.location.origin + "/" })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setForgotMsg(authErrorText(res), false); return; }
        setForgotMsg("Reset link sent — check your email inbox (and spam/junk too).", true);
      }).catch(function () {
        btn.disabled = false;
        setForgotMsg("Can't reach the internet or server.", false);
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
    if (!p1 || p1.length < 6) { setPassMsg("Password must be at least 6 characters.", false); return; }
    if (p1 !== p2) { setPassMsg("Both passwords must match.", false); return; }
    var btn = $("savePassBtn");
    btn.disabled = true;
    updatePassword(p1).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setPassMsg(authErrorText(res), false); return; }
      $("newPass1").value = "";
      $("newPass2").value = "";
      setPassMsg("Password changed!", true);
    }).catch(function () {
      btn.disabled = false;
      setPassMsg("Can't reach the internet or server.", false);
    });
  }
  function doReset() {
    var p1 = $("resetPassword").value;
    var p2 = $("resetPassword2").value;
    if (!p1 || p1.length < 6) { setResetMsg("Password must be at least 6 characters.", false); return; }
    if (p1 !== p2) { setResetMsg("Both passwords must match.", false); return; }
    var btn = $("resetBtn");
    btn.disabled = true;
    updatePassword(p1).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setResetMsg(authErrorText(res), false); return; }
      $("resetPassword").value = "";
      $("resetPassword2").value = "";
      saveSession(null);
      showAuth();
      setAuthMsg("Password changed — now log in with your new password.", true);
    }).catch(function () {
      btn.disabled = false;
      setResetMsg("Can't reach the internet or server.", false);
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
      renderAll();
      loadNotifs();
      loadContacts();
    }).catch(function () {
      setTxnMsg("Records couldn't be loaded — please refresh.", false);
    });
  }

  function renderAll() {
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
    if (t.payer_id === recipientId) return "You gave " + other + " " + a + " — " + note + " · " + date;
    return actor + " gave you " + a + " — " + note + " · " + date;
  }
  function sendNotif(userId, kind, txn) {
    if (!userId || userId === myId() || !txn) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === userId) real = true; });
    if (!real) return; // a manual contact has no account — no notification can go to them
    var title = kind === "settle" ? "Balance settled"
      : kind === "admin" ? "Admin added a record"
      : myName() + " added a record";
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
    var rr = $("remindRowText");
    if (rr) rr.textContent = "Yaad Dehani (" + n + ")";
  }
  function renderNotifList() {
    if (!notifs.length) {
      $("notifList").innerHTML = '<p class="empty">No notifications yet.</p>';
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
        renderPeople();
        renderPersonSelect();
        renderTxnFilterOptions();
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
    if (phoneRaw && !phone) { setContactMsg("Enter a valid phone number (example: 0300 1234567).", false); return; }
    var dupProfile = null;
    profiles.forEach(function (p) { if (phone && contactPhoneMatch(phone, p.phone)) dupProfile = p; });
    if (dupProfile) { setContactMsg("This number is already on the app (" + (dupProfile.name || dupProfile.email) + ") — select them directly.", false); return; }
    var dupContact = null;
    myContacts.forEach(function (c) { if (phone && contactPhoneMatch(phone, c.phone)) dupContact = c; });
    if (dupContact) { setContactMsg("This number is already in your contacts (" + (dupContact.name || "") + ").", false); return; }
    var btn = $("saveContactBtn");
    btn.disabled = true;
    sb("khata_contacts", { method: "POST", prefer: "return=representation", body: {
      owner_id: myId(), name: name, phone: phone || null
    } }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setContactMsg("Dost save nahi hua — dobara try karein.", false); return; }
      var created = res.body && res.body[0];
      if (created) { created.manual = true; myContacts.push(created); }
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost add ho gaya!", true);
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      if (created) $("txnPerson").value = created.id;
    }).catch(function () { btn.disabled = false; setContactMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function deleteContact(id) {
    var c = null;
    myContacts.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    // My own manual contact — can be deleted even with records (user request 2026-11-05).
    // If there are records, those are deleted first (only the ones I created), then the contact.
    var count = 0;
    txns.forEach(function (t) { if (t.payer_id === id || t.receiver_id === id) count++; });
    var text = count > 0
      ? "'" + (c.name || "") + "' — contacts se remove karein? Un ke " + count + " records bhi delete ho jayenge — ye wapas nahi hoga."
      : "'" + (c.name || "") + "' ko contacts se remove karein?";
    askConfirm("Dost remove karein?", text, "Remove karein", function () {
      var deleteRow = function () {
        sb("khata_contacts?id=eq." + encodeURIComponent(id), { method: "DELETE" })
          .then(function (res) {
            if (!res.ok) { setPeopleMsg("Contact couldn't be deleted.", false); return; }
            myContacts = myContacts.filter(function (x) { return x.id !== id; });
            renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
            setPeopleMsg("Contact removed.", true);
          }).catch(function () { setPeopleMsg("Can't reach the internet or server.", false); });
      };
      if (count === 0) { deleteRow(); return; }
      sb("khata_transactions?created_by=eq." + encodeURIComponent(myId()) + "&or=(payer_id.eq." + encodeURIComponent(id) + ",receiver_id.eq." + encodeURIComponent(id) + ")", { method: "DELETE" })
        .then(function (res) {
          if (!res.ok) { setPeopleMsg("Records couldn't be deleted — please try again.", false); return; }
          refreshTxns();
          deleteRow();
        }).catch(function () { setPeopleMsg("Can't reach the internet or server.", false); });
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
  function deletePushSub(sub) {
    return sb("khata_push_subs?endpoint=eq." + encodeURIComponent(sub.endpoint), { method: "DELETE" });
  }
  function updatePushToggleLabel() {
    var b = $("pushToggleBtn");
    if (!b) return;
    b.textContent = pushState === "on" ? "🔔 Notifications: On"
      : pushState === "denied" ? "🔔 Notifications: Blocked"
      : pushState === "unsupported" ? "🔔 Notifications: Not in this browser"
      : "🔔 Notifications: Off";
  }
  function refreshPushState() {
    if (!pushSupported) { pushState = "unsupported"; updatePushToggleLabel(); return Promise.resolve(pushState); }
    if (window.Notification && Notification.permission === "denied") {
      pushState = "denied"; updatePushToggleLabel(); return Promise.resolve(pushState);
    }
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      pushState = sub ? "on" : "off";
      updatePushToggleLabel();
      return pushState;
    }).catch(function () { return pushState; });
  }
  // Chrome's own notification permission popup appears as soon as the app opens.
  // In-app banner removed (2026-11-05) — the browser asks itself.
  // Once per fresh open (session guard); doesn't ask again after Block.
  function maybeAskPushPermission() {
    if (!pushSupported) return;
    if (!window.Notification || Notification.permission !== "default") return;
    if (pushState !== "off") return;
    try { if (window.sessionStorage.getItem("easykhata_push_asked") === "1") return; } catch (e) {}
    try { window.sessionStorage.setItem("easykhata_push_asked", "1"); } catch (e) {}
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { pushState = "denied"; updatePushToggleLabel(); return; }
      enablePush();
    }).catch(function () {});
  }
  function enablePush() {
    if (!pushSupported) return Promise.resolve(false);
    var p = (window.Notification && Notification.permission === "granted")
      ? Promise.resolve("granted")
      : Notification.requestPermission();
    return p.then(function (perm) {
      if (perm !== "granted") {
        pushState = "denied"; updatePushToggleLabel();
        return false;
      }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushVapidKey()) });
      }).then(function (sub) {
        return savePushSub(sub).then(function () {
          pushState = "on"; updatePushToggleLabel();
          return true;
        });
      });
    }).catch(function () {
      return false;
    });
  }
  function disablePush() {
    if (!pushSupported) return Promise.resolve(false);
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) { pushState = "off"; updatePushToggleLabel(); return true; }
      return sub.unsubscribe().then(function () {
        return deletePushSub(sub).catch(function () {}).then(function () {
          pushState = "off"; updatePushToggleLabel();
          return true;
        });
      });
    }).catch(function () { return false; });
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
        if (!res.ok) { setAdminMsg("Users couldn't be loaded — please try again.", false); return; }
        adminUsers = Array.isArray(res.body) ? res.body : [];
        var total = 0;
        adminUsers.forEach(function (u) { total += Number(u.records) || 0; });
        $("adminStats").textContent = "Total users: " + adminUsers.length + " · Total records: " + total;
        if (!adminUsers.length) {
          $("adminUserList").innerHTML = '<p class="empty">No users yet.</p>';
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
            '<div class="p-detail">' + (Number(u.records) || 0) + ' record · Joined ' + esc(fmtDate(u.created_at)) + '</div></div>' +
            '<div class="p-actions">' + del + '</div></div>';
        });
        $("adminUserList").innerHTML = html;
      }).catch(function () { setAdminMsg("Can't reach the internet or server.", false); });
  }
  function deleteUser(id) {
    var p = null;
    adminUsers.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) p = findPerson(id);
    if (!p || id === myId()) return;
    if (!window.confirm("'" + (p.name || p.email) + "' — delete them?\n\nTheir account, profile and all records will be deleted. This can't be undone.")) return;
    sb("rpc/admin_delete_user", { method: "POST", body: { target_id: id } })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("User couldn't be deleted — please try again.", false); return; }
        setAdminMsg("User deleted.", true);
        if (adminCurrentUser && adminCurrentUser.id === id) {
          adminCurrentUser = null;
          showView("admin");
        }
        loadAll();
      }).catch(function () { setAdminMsg("Can't reach the internet or server.", false); });
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
      '<div class="sum-card"><span class="sum-label">Given</span><strong>' + esc(fmtRs(given)) + '</strong></div>' +
      '<div class="sum-card"><span class="sum-label">Taken</span><strong>' + esc(fmtRs(taken)) + '</strong></div>' +
      '<div class="sum-card net"><span class="sum-label">Net (given − taken)</span><strong>' + esc(fmtRs(given - taken)) + '</strong></div>';
    if (!mine.length) {
      $("adminUserTxns").innerHTML = '<p class="empty">This user has no records.</p>';
    } else {
      var html = "";
      mine.forEach(function (t) {
        var other = t.payer_id === u.id ? profileName(t.receiver_id) : profileName(t.payer_id);
        var dir = t.payer_id === u.id ? "→ " + other + " (given)" : "← " + other + " (taken)";
        html += '<div class="txn"><div><div class="t-main">' + esc(dir) + '</div>' +
          '<div class="t-sub">' + esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + '</div></div>' +
          '<div class="t-right"><span class="t-amt">' + esc(fmtRs(t.amount)) + '</span></div></div>';
      });
      $("adminUserTxns").innerHTML = html;
    }
    showView("adminUser");
  }
  function saveAdminEdit() {
    if (!isAdmin() || !adminCurrentUser) return;
    var name = $("adminEditName").value.trim();
    var phone = $("adminEditPhone").value.trim();
    if (!name) { setAdminEditMsg("Name can't be empty.", false); return; }
    var btn = $("adminEditSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_update_user", { method: "POST", body: { p_target: adminCurrentUser.id, p_name: name, p_phone: phone } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminEditMsg("Couldn't be updated — please try again.", false); return; }
        adminCurrentUser.name = name;
        adminCurrentUser.phone = phone || null;
        $("adminUserTitle").textContent = name;
        $("adminUserPhone").textContent = phone || "—";
        setAdminEditMsg("User updated.", true);
        loadAll();
      }).catch(function () { btn.disabled = false; setAdminEditMsg("Can't reach the internet or server.", false); });
  }
  function saveAdminPass() {
    if (!isAdmin() || !adminCurrentUser) return;
    var p1 = $("adminNewPass1").value;
    var p2 = $("adminNewPass2").value;
    if (!p1 || p1.length < 6) { setAdminPassMsg("Password must be at least 6 characters.", false); return; }
    if (p1 !== p2) { setAdminPassMsg("Both passwords must match.", false); return; }
    var btn = $("adminPassSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_set_user_password", { method: "POST", body: { p_target: adminCurrentUser.id, p_password: p1 } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminPassMsg("Password couldn't be changed — please try again.", false); return; }
        $("adminNewPass1").value = "";
        $("adminNewPass2").value = "";
        setAdminPassMsg("Password changed — the user can log in with the new password.", true);
      }).catch(function () { btn.disabled = false; setAdminPassMsg("Can't reach the internet or server.", false); });
  }
  function toggleAdminBlock() {
    if (!isAdmin() || !adminCurrentUser) return;
    var u = adminCurrentUser;
    if (u.id === myId()) { setAdminUserMsg("You can't block yourself.", false); return; }
    var blocking = !u.blocked;
    if (!window.confirm(blocking
      ? ("'" + (u.name || u.email) + "' — BLOCK them?\n\nThey won't be able to log in again (their data will stay safe).")
      : ("'" + (u.name || u.email) + "' — UNBLOCK them?"))) return;
    sb("rpc/admin_set_user_blocked", { method: "POST", body: { p_target: u.id, p_blocked: blocking } })
      .then(function (res) {
        if (!res.ok) { setAdminUserMsg("Block couldn't be updated — please try again.", false); return; }
        u.blocked = blocking;
        $("adminBlockBtn").textContent = blocking ? "Unblock" : "Block";
        $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (you)</span> ' : '') +
          (blocking ? '<span class="badge-blocked">Blocked</span>' : '<span class="badge-admin">Active</span>');
        setAdminUserMsg(blocking ? "User blocked — they won't be able to log in again." : "User unblocked.", true);
        loadAll();
      }).catch(function () { setAdminUserMsg("Can't reach the internet or server.", false); });
  }

  function setAdminSetMsg(text, ok) {
    var el = $("adminSetMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function saveAdminSet() {
    if (!isAdmin() || !adminCurrentUser) return;
    var amount = parseFloat($("adminSetAmount").value);
    if (!amount || amount <= 0) { setAdminSetMsg("Enter a valid amount.", false); return; }
    var dir = (document.querySelector('input[name="adminSetDir"]:checked') || {}).value || "take";
    var note = $("adminSetNote").value.trim() || "Admin set the amount";
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
        if (!res.ok) { setAdminSetMsg("Amount couldn't be set — please try again.", false); return; }
        var created = res.body && res.body[0];
        if (created) {
          sendNotif(u.id, "admin", created);
          triggerPush(u.id, "Admin added a record", notifBodyFor(created, u.id));
          txns.unshift(created);
        }
        $("adminSetAmount").value = "";
        $("adminSetNote").value = "";
        setAdminSetMsg("Amount set!", true);
        openAdminUser(u.id);
        loadAll();
      }).catch(function () { btn.disabled = false; setAdminSetMsg("Can't reach the internet or server.", false); });
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

  function finishPhoneSave(phone) {
    myPhone = phone;
    profiles.forEach(function (p) { if (p.id === myId()) p.phone = phone || null; });
    setPhoneMsg(phone ? "Number saved!" : "Number removed.", true);
  }
  function savePhone() {
    var phone = $("myPhone").value.trim();
    if (phone && !normPhone(phone)) { setPhoneMsg("Enter a valid phone number (example: 0300 1234567).", false); return; }
    sb("khata_profiles?id=eq." + encodeURIComponent(myId()), {
      method: "PATCH",
      prefer: "return=representation",
      body: { phone: phone || null }
    }).then(function (res) {
      if (!res.ok) {
        if (res.body && res.body.code === "42703") { setPhoneMsg("The phone column isn't in the database yet — run easy-khata-v2.sql first.", false); return; }
        setPhoneMsg("Number couldn't be saved — please try again.", false); return;
      }
      if (res.body && res.body.length) { finishPhoneSave(phone); return; }
      // No profile row exists — PATCH silently does nothing, so create it with an upsert.
      var meta = (session.user && session.user.user_metadata) || {};
      sb("khata_profiles?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: { id: myId(), name: meta.full_name || myName(), email: (session.user && session.user.email) || "", phone: phone || null }
      }).then(function (res2) {
        if (!res2.ok) { setPhoneMsg("Number couldn't be saved — please try again.", false); return; }
        finishPhoneSave(phone);
      }).catch(function () { setPhoneMsg("Can't reach the internet or server.", false); });
    }).catch(function () { setPhoneMsg("Can't reach the internet or server.", false); });
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
      : s.net < 0 ? "Net: " + fmtRs(-s.net) + " — I have to pay you." : "Net: settled up.";
    var latest = latestLine(latestTxnWith(p.id));
    return "Easy Khata — Food Balance\n" +
      myName() + " & " + (p.name || p.email) + "\n\n" +
      "Debit (I gave): " + fmtRs(s.given) + "\n" +
      "Credit (I took): " + fmtRs(s.taken) + "\n" +
      netLine + "\n" +
      (latest ? "\n" + latest + "\n" : "") +
      "\nEasy Khata: " + APP_SHORT_URL;
  }
  function personRemindText(p) {
    var s = personStats(p.id);
    var latest = latestLine(latestTxnWith(p.id));
    var dc = "Debit (I gave): " + fmtRs(s.given) + " · Credit (I took): " + fmtRs(s.taken) + ".";
    var head = "Hi " + (p.name || "") + ",\n\n";
    var body, tail = "";
    if (s.net > 0) { body = "As per Easy Khata, you have to pay me " + fmtRs(s.net) + " (food balance).\n" + dc; tail = "\n\nPlease check when you get a chance. Thank you!"; }
    else if (s.net < 0) { body = "As per Easy Khata, I have to pay you " + fmtRs(-s.net) + " (food balance).\n" + dc; tail = "\n\nI will send it soon. Thank you!"; }
    else { body = "As per Easy Khata, our food balance is settled.\n" + dc; }
    return head + body + (latest ? "\n\n" + latest : "") + tail + "\n\n— " + myName() + "\nEasy Khata: " + APP_SHORT_URL;
  }
  function shareText(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    return copyText(text).then(function () { setPeopleMsg("Text copied — paste it in WhatsApp or any app.", true); });
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
          title: myName() + " reminded you", body: text
        } });
      }).catch(function () {});
  }
  function remindPerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var text = personRemindText(p);
    var s = personStats(id);
    var real = false;
    profiles.forEach(function (x) { if (x.id === id) real = true; });
    if (p.phone && normPhone(p.phone)) {
      copyText(text).catch(function () {});
      openWaLink(waLink(p.phone, text));
      setPeopleMsg("Opening WhatsApp — if it doesn't open, the text is copied, paste it in WhatsApp.", true);
      if (real && s.net) sendRemindNotif(id, text);
      return;
    }
    copyText(text).then(function () {
      setPeopleMsg("This friend has no WhatsApp number — the reminder text is copied, please send it yourself.", true);
      if (real && s.net) sendRemindNotif(id, text);
    }).catch(function () {
      setPeopleMsg("Couldn't copy — save a number or write the text yourself and send it.", false);
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
      payer_id: s.net > 0 ? id : me,
      receiver_id: s.net > 0 ? me : id,
      amount: amt,
      note: "Settled up — settlement",
      txn_date: todayLocal(),
      created_by: me
    };
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        if (!res.ok) { setPeopleMsg("Settlement save nahi hua — dobara try karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(id, "settle", created); triggerPush(id, "Balance settled", notifBodyFor(created, id)); }
        setPeopleMsg("Hisaab barabar ho gaya!", true);
        loadAll();
      }).catch(function () { setPeopleMsg("Internet ya server se rabta nahi ho raha.", false); });
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
      : net < 0 ? "Net: " + fmtRs(-net) + " — I have to pay." : "Net: settled up.";
    var latest = latestLine(latestTxn());
    var text = "Easy Khata — My Food Balance\n" +
      myName() + "\n\n" +
      "Debit (I gave): " + fmtRs(given) + "\n" +
      "Credit (I took): " + fmtRs(taken) + "\n" +
      netLine + "\n" +
      (latest ? "\n" + latest + "\n" : "") +
      "\nEasy Khata: " + APP_SHORT_URL;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    copyText(text).then(function () { setTxnMsg("Balance copied — paste it in any app.", true); });
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
        '<span class="p-avatar">' + esc(initials(p.name)) + '</span>' +
        '<span class="p-main"><span class="p-name">' + esc(p.name) + (p.manual ? ' <span class="tag-manual">Manual</span>' : '') + '</span>' +
        '<span class="p-last">' + esc(last) + '</span></span>' +
        '<span class="p-net ' + cls + '">' + esc(netText) + '</span></button>';
    });
    $("peopleList").innerHTML = html;
    if (detailPersonId) renderPersonDetail();
  }

  function renderAccount() {
    var name = myName() || "";
    var initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
    $("headerAvatar").textContent = initial;
    $("headerName").textContent = name || "Easy Khata";
    $("acctAvatar").textContent = initial;
    $("acctName").textContent = name || "—";
    $("acctPhone").textContent = myPhone || "Number nahi diya";
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
    $("detailAvatar").textContent = initials(p.name || p.email);
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
      return;
    }
    // Running balance, oldest first, then show newest first.
    var asc = list.slice().reverse();
    var run = 0;
    var balById = {};
    asc.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === me) run += a;
      else if (t.receiver_id === me) run -= a;
      balById[t.id] = run;
    });
    var html = '<div class="dtable-head"><span>TIME</span><span>DIYE</span><span>LIYE</span></div>';
    list.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var iGave = t.payer_id === me;
      var bal = balById[t.id];
      var balCls = bal > 0 ? "pos" : bal < 0 ? "neg" : "zero";
      var balText = bal > 0 ? "Bal: " + fmtRs(bal) + " · lene hain"
        : bal < 0 ? "Bal: " + fmtRs(-bal) + " · dene hain" : "Bal: Rs 0 · settled";
      var timeStr = fmtTime(t.created_at);
      var btns = "";
      if (t.created_by === me) {
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
    if (!list.length) { setTxnMsg("No records to download.", false); return; }
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
    setTxnMsg("CSV downloaded (" + list.length + " records).", true);
  }
  function renderTxns() {
    var me = myId();
    var list = filteredTxns();
    if (!txns.length) {
      $("txnList").innerHTML = '<p class="empty">Abhi koi record nahi — upar se pehla record add karein.</p>';
      return;
    }
    if (!list.length) {
      $("txnList").innerHTML = '<p class="empty">Is search/filter se koi record nahi mila.</p>';
      return;
    }
    var html = "";
    list.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var iGave = t.payer_id === me;
      var iTook = t.receiver_id === me;
      var amtCls = iGave ? "given" : iTook ? "taken" : "";
      var sign = iGave ? "− " : iTook ? "+ " : "";
      var btns = "";
      if (t.created_by === me) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-edit="' + esc(t.id) + '">Edit</button>' +
          '<button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      } else if (isAdmin()) {
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      }
      html += '<div class="txn"><div><div class="t-main">' + esc(profileName(t.payer_id)) + ' → ' + esc(profileName(t.receiver_id)) + '</div>' +
        '<div class="t-sub">' + esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + '</div></div>' +
        '<div class="t-right"><span class="t-amt ' + amtCls + '">' + sign + esc(fmtRs(a)) + '</span>' + btns + '</div></div>';
    });
    $("txnList").innerHTML = html;
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
    $("splitList").innerHTML = html || '<p class="empty">No other users yet.</p>';
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
    if (!ids.length) { $("splitHint").textContent = "Choose friends first, then enter the amount."; return; }
    if (!total || total <= 0) { $("splitHint").textContent = ids.length + " friends chosen — now enter the total amount."; return; }
    var people = ids.length + 1; // friends + you — your share counts too
    var share = Math.floor(total / people * 100) / 100;
    $("splitHint").textContent = "Each person's share: " + fmtRs(share) + " (" + ids.length + " friends + you · total " + fmtRs(total) + " · your share " + fmtRs(share) + ")";
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
    var done = 0, failed = 0, i = 0;
    function next() {
      if (i >= ids.length) {
        btn.disabled = false;
        if (failed) setTxnMsg(done + " records save ho gaye, " + failed + " fail — dobara check karein.", false);
        else { setTxnMsg(ids.length + " records save ho gaye (barabar baant diye)!", true); resetTxnForm(); }
        loadAll();
        return;
      }
      var id = ids[i++];
      var amt = (i === ids.length) ? Math.round((amount - share * ids.length) * 100) / 100 : share;
      sb("khata_transactions", { method: "POST", prefer: "return=representation", body: {
        payer_id: me, receiver_id: id, amount: amt,
        note: (note || "Food") + " (split equally)", txn_date: date, created_by: me
      } }).then(function (res) {
        if (res.ok) { done++; var created = res.body && res.body[0]; if (created) { sendNotif(id, "record", created); triggerPush(id, myName() + " added a record", notifBodyFor(created, id)); } }
        else failed++;
        next();
      })
      .catch(function () { failed++; next(); });
    }
    next();
  }

  function addTxn(e) {
    e.preventDefault();
    if (!dbReady) { setTxnMsg("Database setup is pending.", false); return; }
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
    if (editingId) {
      var editId = editingId;
      sb("khata_transactions?id=eq." + encodeURIComponent(editId), { method: "PATCH", prefer: "return=minimal", body: body })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) { setTxnMsg("Edit save nahi hui — dobara try karein.", false); return; }
          resetTxnForm();
          setTxnMsg("Record update ho gaya!", true);
          loadAll();
        }).catch(function () {
          btn.disabled = false;
          setTxnMsg("Internet ya server se rabta nahi ho raha.", false);
        });
      return;
    }
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setTxnMsg("Record save nahi hua — dobara try karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(person, "record", created); triggerPush(person, myName() + " added a record", notifBodyFor(created, person)); }
        $("txnAmount").value = "";
        $("txnNote").value = "";
        setTxnMsg("Record save ho gaya!", true);
        loadAll();
      }).catch(function () {
        btn.disabled = false;
        setTxnMsg("Internet ya server se rabta nahi ho raha.", false);
      });
  }

  function deleteTxn(id) {
    askConfirm("Record delete karein?", "Ye record hamesha ke liye delete ho jayega.", "Delete karein", function () {
    sb("khata_transactions?id=eq." + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) { setTxnMsg("Couldn't be deleted.", false); return; }
        loadAll();
      }).catch(function () { setTxnMsg("Couldn't be deleted.", false); });
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
  $("remindRow").addEventListener("click", showNotifView);
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
  $("acctEditBtn").addEventListener("click", function () { var b = $("acctPhoneBox"); b.hidden = !b.hidden; });
  $("acctShareBtn").addEventListener("click", shareAll);
  $("acctShareMenuBtn").addEventListener("click", shareAll);
  $("acctLedgerBtn").addEventListener("click", function () {
    showView("khata");
    var card = $("ledgerCard");
    if (card) setTimeout(function () { card.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  });
  $("acctNotifBtn").addEventListener("click", showNotifView);
  $("acctBackupBtn").addEventListener("click", exportCsv);
  $("acctPrivacyBtn").addEventListener("click", function () { var b = $("privacyBox"); b.hidden = !b.hidden; });
  $("acctRateBtn").addEventListener("click", function () {
    shareText("Easy Khata — doston ke saath khane ka hisaab, aasan tareeqe se.\n\nEasy Khata: " + APP_SHORT_URL);
  });
  $("acctWaBtn").addEventListener("click", function () {
    // No support number exists — open WhatsApp with the app link to share.
    openWaLink("https://wa.me/?text=" + encodeURIComponent("Easy Khata — doston ke saath khane ka hisaab, aasan tareeqe se.\n\nEasy Khata: " + APP_SHORT_URL));
  });
  $("changePassBtn").addEventListener("click", function () { var b = $("changePassBox"); b.hidden = !b.hidden; });
  $("savePassBtn").addEventListener("click", doChangePass);
  $("txnForm").addEventListener("submit", addTxn);
  $("cancelEditBtn").addEventListener("click", resetTxnForm);
  $("refreshBtn").addEventListener("click", loadAll);
  $("shareAllBtn").addEventListener("click", shareAll);
  $("savePhoneBtn").addEventListener("click", savePhone);
  $("txnSearch").addEventListener("input", function (e) { txnSearchText = e.target.value; renderTxns(); });
  $("txnFilterPerson").addEventListener("change", function (e) { txnFilterPerson = e.target.value; renderTxns(); });
  $("txnFrom").addEventListener("change", function (e) { txnFromDate = e.target.value; renderTxns(); });
  $("txnTo").addEventListener("change", function (e) { txnToDate = e.target.value; renderTxns(); });
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
  $("pushToggleBtn").addEventListener("click", function () {
    if (pushState === "on") disablePush();
    else enablePush();
  });
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
    if (b) b.hidden = navigator.onLine;
  }
  window.addEventListener("online", renderOffline);
  window.addEventListener("offline", renderOffline);
  renderOffline();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
    wireAppUpdate();
  }

  /* ---------- theme ---------- */
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    var ic = $("themeIcon");
    if (ic) ic.textContent = mode === "dark" ? "☀️" : "🌙";
    try { window.localStorage.setItem("easykhata_theme", mode); } catch (e) {}
  }
  $("themeBtn").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  });
  try {
    var savedTheme = window.localStorage.getItem("easykhata_theme");
    if (savedTheme === "dark" || savedTheme === "light") applyTheme(savedTheme);
  } catch (e) {}

  if (!API || !ANON) {
    $("setupBox").hidden = false;
    $("authWrap").hidden = true;
    return;
  }
  if (!handleAuthHash()) authValidate();
})();
