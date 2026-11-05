/* Easy Khata — khana ka len den.
   Vanilla JS + Supabase (GoTrue auth + PostgREST), Diesel Converter wali
   proven pattern. Koi framework nahi, koi eval nahi. */
(function () {
  "use strict";
  var cfg = window.EASY_KHATA_CONFIG || {};
  var API = cfg.SUPABASE_URL;
  var ANON = cfg.SUPABASE_ANON_KEY;
  var SESSION_KEY = "easykhata_auth";
  var ADMIN_EMAIL = cfg.ADMIN_EMAIL || "";

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
  function monthName(iso) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var p = String(iso || "").slice(0, 7).split("-");
    if (p.length < 2) return "";
    return months[Number(p[1]) - 1] + " " + p[0];
  }
  /* Pakistan number ko WhatsApp format me: 03001234567 -> 923001234567 */
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

  function profileName(id) {
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === id) return profiles[i].name || profiles[i].email || "Namalum";
    }
    for (var j = 0; j < myContacts.length; j++) {
      if (myContacts[j].id === id) return myContacts[j].name || "Namalum";
    }
    return id === myId() ? myName() : "Private contact";
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
    $("authSubmitBtn").textContent = authMode === "signup" ? "Account banayein" : "Login karein";
    $("authPassword").setAttribute("autocomplete", authMode === "signup" ? "new-password" : "current-password");
    setAuthMsg("");
  }
  function showAuth() {
    closeDrawer();
    if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
    $("notifBtn").hidden = true;
    $("notifView").hidden = true;
    $("authBox").hidden = false;
    $("appBox").hidden = true;
    $("adminView").hidden = true;
    $("adminUserView").hidden = true;
    $("avatarBtn").hidden = true;
    $("menuBtn").hidden = true;
    $("fabAdd").hidden = true;
    $("authForm").hidden = false;
    $("forgotBox").hidden = true;
    $("resetBox").hidden = true;
    renderAuthMode();
  }
  function showApp() {
    $("authBox").hidden = true;
    $("adminView").hidden = true;
    $("adminUserView").hidden = true;
    $("appBox").hidden = false;
    var initial = (myName() || "?").trim().charAt(0).toUpperCase() || "?";
    $("avatarBtn").textContent = initial;
    $("drawerAvatar").textContent = initial;
    $("drawerName").textContent = myName();
    $("drawerEmail").textContent = (session.user && session.user.email) || "";
    $("avatarBtn").hidden = false;
    $("menuBtn").hidden = false;
    $("notifBtn").hidden = false;
    $("fabAdd").hidden = false;
    $("txnDate").value = todayLocal();
    loadNotifs();
    refreshPushState().then(function () { maybeAskPushPermission(); });
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
  function showAppView() {
    closeDrawer();
    showApp();
  }
  function showAdminView() {
    if (!isAdmin()) return;
    closeDrawer();
    $("authBox").hidden = true;
    $("appBox").hidden = true;
    $("adminUserView").hidden = true;
    $("fabAdd").hidden = true;
    $("adminView").hidden = false;
    renderAdmin();
    window.scrollTo(0, 0);
  }
  function openDrawer() {
    renderAdmin();
    $("drawer").hidden = false;
    $("drawerOverlay").hidden = false;
  }
  function closeDrawer() {
    $("drawer").hidden = true;
    $("drawerOverlay").hidden = true;
  }

  function authErrorText(res) {
    // Server ki asal wajah dikhayein — generic line ne asal error chhupa liya tha (2026-11-05).
    var raw = res.body && (res.body.msg || res.body.message || res.body.error_description || res.body.error);
    var m = typeof raw === "string" ? raw : "";
    if (/invalid login/i.test(m)) return "Email ya password ghalat hai.";
    if (/already registered|already exists/i.test(m)) return "Is email par account pehle se hai — login karein.";
    if (/email not confirmed/i.test(m)) return "Email confirm nahi hui — inbox me confirmation link check karein, phir login karein.";
    if (/only request this after|too many requests|rate limit/i.test(m) || res.status === 429) return "Thori der ruk kar dobara koshish karein.";
    if (/sending.*(mail|email)|confirmation.*(mail|email)|smtp/i.test(m)) return "Confirmation email bhejne me masla hai — thori der baad dobara koshish karein.";
    if (/password/i.test(m) && /short|least|6/i.test(m)) return "Password kam az kam 6 harf ka ho.";
    if (/email/i.test(m) && /invalid/i.test(m)) return "Sahi email likhein.";
    if (!m) { try { console.warn("EasyKhata auth error", res.status, res.body); } catch (e) {} }
    return m || "Kuch ghalat hua — dobara koshish karein.";
  }

  function ensureProfile() {
    var u = session.user;
    // Pehle check karein: profile pehle se hai to use chhedein nahi.
    // (Purana code har login par signup-time naam/number se overwrite kar deta tha —
    // settings se badla hua number agle login par wapas purana ho jata tha.)
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
        // Phone column abhi nahi bana (v2 SQL nahi chala) to phone ke baghair save karein.
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
    // Signup jis me email confirmation on ho: session nahi milta.
    // GoTrue confirmation-pending response bare user object hota hai (top-level id/email),
    // {user: ...} wrapped NAHI — is liye dono shapes check karein, warna kamyab
    // signup par bhi "Kuch ghalat hua" dikhta tha (2026-11-05, Yasir case).
    var body = res.body || {};
    if (!body.access_token) {
      var pendingUser = body.user || (body.id && body.email ? body : null);
      if (pendingUser) {
        setAuthMsg("Account ban gaya! Email me confirmation link aya hai — us par click kar ke phir login karein.", true);
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
    if (authMode === "signup" && phone && !normPhone(phone)) { setAuthMsg("Sahi phone number likhein (misal: 0300 1234567).", false); return; }
    if (password.length < 6) { setAuthMsg("Password kam az kam 6 harf ka ho.", false); return; }
    var btn = $("authSubmitBtn");
    btn.disabled = true;
    var p = authMode === "signup"
      ? authCall("/signup", { email: email, password: password, data: { full_name: name, phone: phone || "", app: "easy-khata" } })
      : authCall("/token?grant_type=password", { email: email, password: password });
    p.then(function (res) {
      btn.disabled = false;
      if (!res.ok && !(res.body && res.body.access_token)) {
        setAuthMsg(authErrorText(res), false);
        // Email pehle se registered ho to seedha login mode par le jayein —
        // user ko dobara signup dabane ki zaroorat na pare.
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

  /* ---------- password bhool gaye / reset ---------- */
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
      b.setAttribute("title", show ? "Password chhupayein" : "Password dekhein");
    });
  }
  function doForgot() {
    var email = $("forgotEmail").value.trim();
    if (!email) { setForgotMsg("Email likhein.", false); return; }
    var btn = $("forgotSendBtn");
    btn.disabled = true;
    authCall("/recover", { email: email, redirect_to: window.location.origin + "/" })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setForgotMsg(authErrorText(res), false); return; }
        setForgotMsg("Reset link bhej diya — email inbox check karein (spam/junk bhi dekhein).", true);
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
    if (!p1 || p1.length < 6) { setPassMsg("Password kam az kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setPassMsg("Dono password aik jaise likhein.", false); return; }
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
    if (!p1 || p1.length < 6) { setResetMsg("Password kam az kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setResetMsg("Dono password aik jaise likhein.", false); return; }
    var btn = $("resetBtn");
    btn.disabled = true;
    updatePassword(p1).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setResetMsg(authErrorText(res), false); return; }
      $("resetPassword").value = "";
      $("resetPassword2").value = "";
      saveSession(null);
      showAuth();
      setAuthMsg("Password badal gaya — ab naye password se login karein.", true);
    }).catch(function () {
      btn.disabled = false;
      setResetMsg("Internet ya server se rabta nahi ho raha.", false);
    });
  }
  // Email ke reset/confirm link se app khule to us session ko pakrein.
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
      // Phone column abhi nahi bana (v2 SQL nahi chala) to phone ke baghair load karein.
      if (!res.ok && res.body && res.body.code === "42703") return profilesQuery(false);
      return res;
    }).then(function (res) {
      if (!res.ok) {
        if (tableMissing(res)) {
          dbReady = false;
          $("setupBox").hidden = false;
          $("authBox").hidden = true;
          $("appBox").hidden = true;
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
      renderAll();
      loadNotifs();
      loadContacts();
    }).catch(function () {
      setTxnMsg("Record load nahi ho sake — refresh karein.", false);
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
    renderAdmin();
  }

  /* ---------- notifications ---------- */
  var notifs = [];
  var notifTimer = null;
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
    var note = t.note || "Khana";
    var date = fmtDate(t.txn_date);
    if (t.payer_id === recipientId) return "Aap ne " + other + " ko " + a + " diye — " + note + " · " + date;
    return actor + " ne aap ko " + a + " diye — " + note + " · " + date;
  }
  function sendNotif(userId, kind, txn) {
    if (!userId || userId === myId() || !txn) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === userId) real = true; });
    if (!real) return; // manual contact ka account hi nahi — use notification nahi ja sakti
    var title = kind === "settle" ? "Hisab barabar ho gaya"
      : kind === "admin" ? "Admin ne record likha"
      : myName() + " ne record likha";
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
  }
  function renderNotifList() {
    if (!notifs.length) {
      $("notifList").innerHTML = '<p class="empty">Abhi koi notification nahi hai.</p>';
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
    closeDrawer();
    $("authBox").hidden = true;
    $("appBox").hidden = true;
    $("adminView").hidden = true;
    $("adminUserView").hidden = true;
    $("fabAdd").hidden = true;
    $("notifView").hidden = false;
    loadNotifs();
    window.scrollTo(0, 0);
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
    // Har apne manual contact ke liye: kya is number par koi real profile ban gaya?
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
    sb("khata_transactions?select=*&order=txn_date.desc&order=created_at.desc&limit=500")
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
    if (!name) { setContactMsg("Contact ka naam likhein.", false); return; }
    var phone = phoneRaw ? normPhone(phoneRaw) : "";
    if (phoneRaw && !phone) { setContactMsg("Sahi phone number likhein (misal: 0300 1234567).", false); return; }
    var dupProfile = null;
    profiles.forEach(function (p) { if (phone && contactPhoneMatch(phone, p.phone)) dupProfile = p; });
    if (dupProfile) { setContactMsg("Ye number pehle se app par hai (" + (dupProfile.name || dupProfile.email) + ") — us ko seedha select karein.", false); return; }
    var dupContact = null;
    myContacts.forEach(function (c) { if (phone && contactPhoneMatch(phone, c.phone)) dupContact = c; });
    if (dupContact) { setContactMsg("Ye number pehle se aap ke contacts me hai (" + (dupContact.name || "") + ").", false); return; }
    var btn = $("saveContactBtn");
    btn.disabled = true;
    sb("khata_contacts", { method: "POST", prefer: "return=representation", body: {
      owner_id: myId(), name: name, phone: phone || null
    } }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { setContactMsg("Contact save nahi hua — dobara koshish karein.", false); return; }
      var created = res.body && res.body[0];
      if (created) { created.manual = true; myContacts.push(created); }
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Contact add ho gaya!", true);
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      if (created) $("txnPerson").value = created.id;
    }).catch(function () { btn.disabled = false; setContactMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function deleteContact(id) {
    var c = null;
    myContacts.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    // Apna manual contact — record hon to bhi delete ho sakta hai (user ask 2026-11-05).
    // Record hon to pehle wo delete hote hain (sirf mere banaye hue), phir contact.
    var count = 0;
    txns.forEach(function (t) { if (t.payer_id === id || t.receiver_id === id) count++; });
    var text = count > 0
      ? "'" + (c.name || "") + "' ko contacts se hata dein? Is ke " + count + " record bhi delete ho jayenge — ye wapas nahi aaye ga."
      : "'" + (c.name || "") + "' ko contacts se hata dein?";
    askConfirm("Contact hata dein?", text, "Hata dein", function () {
      var deleteRow = function () {
        sb("khata_contacts?id=eq." + encodeURIComponent(id), { method: "DELETE" })
          .then(function (res) {
            if (!res.ok) { setPeopleMsg("Contact delete nahi hua.", false); return; }
            myContacts = myContacts.filter(function (x) { return x.id !== id; });
            renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
            setPeopleMsg("Contact hata diya gaya.", true);
          }).catch(function () { setPeopleMsg("Internet ya server se rabta nahi ho raha.", false); });
      };
      if (count === 0) { deleteRow(); return; }
      sb("khata_transactions?created_by=eq." + encodeURIComponent(myId()) + "&or=(payer_id.eq." + encodeURIComponent(id) + ",receiver_id.eq." + encodeURIComponent(id) + ")", { method: "DELETE" })
        .then(function (res) {
          if (!res.ok) { setPeopleMsg("Record delete nahi hue — dobara koshish karein.", false); return; }
          refreshTxns();
          deleteRow();
        }).catch(function () { setPeopleMsg("Internet ya server se rabta nahi ho raha.", false); });
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

  /* ---------- push notifications (app band ho to bhi) ---------- */
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
      : pushState === "unsupported" ? "🔔 Notifications: Is browser me nahi"
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
  // App khulte hi Chrome ka apna notification permission popup aaye.
  // In-app banner hata diya gaya (2026-11-05) — browser khud poochta hai.
  // Har fresh open par aik dafa (session guard); Block karne par dobara nahi poochta.
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
    // Fire-and-forget: server function recipient ko push bhejta hai.
    // Save flow kabhi is par nahi rukta.
    if (!recipientId || recipientId === myId() || !session || !session.access_token) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === recipientId) real = true; });
    if (!real) return; // manual contact ka account hi nahi
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
    // Sirf admin: list server-side RPC se aati hai (admin-only, DB me check hota hai).
    if (!isAdmin()) { $("navAdminBtn").hidden = true; return; }
    $("navAdminBtn").hidden = false;
    sb("rpc/admin_list_users", { method: "POST", body: {} })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("Users load nahi hue — dobara koshish karein.", false); return; }
        adminUsers = Array.isArray(res.body) ? res.body : [];
        var total = 0;
        adminUsers.forEach(function (u) { total += Number(u.records) || 0; });
        $("adminStats").textContent = "Total users: " + adminUsers.length + " · Total records: " + total;
        if (!adminUsers.length) {
          $("adminUserList").innerHTML = '<p class="empty">Abhi koi user nahi hai.</p>';
          return;
        }
        var me = myId();
        var html = "";
        adminUsers.forEach(function (u) {
          var badge = u.id === me
            ? '<span class="badge-admin">Admin (aap)</span>'
            : (u.blocked ? ' <span class="badge-blocked">Blocked</span>' : '');
          var del = u.id === me ? "" : '<button class="btn-danger" type="button" data-admin-del="' + esc(u.id) + '">Delete user</button>';
          html += '<div class="person admin-user" data-admin-open="' + esc(u.id) + '"><div><div class="p-name">' + esc(u.name || u.email) + badge + '</div>' +
            '<div class="p-detail">' + esc(u.email || "") + (u.phone ? ' · ' + esc(u.phone) : '') + '</div>' +
            '<div class="p-detail">' + (Number(u.records) || 0) + ' record · Joined ' + esc(fmtDate(u.created_at)) + '</div></div>' +
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
    if (!window.confirm("'" + (p.name || p.email) + "' ko delete kar dein?\n\nUs ka account, profile aur tamam record delete ho jayein ge. Ye wapas nahi ho sakta.")) return;
    sb("rpc/admin_delete_user", { method: "POST", body: { target_id: id } })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("User delete nahi hua — dobara koshish karein.", false); return; }
        setAdminMsg("User delete ho gaya.", true);
        if (adminCurrentUser && adminCurrentUser.id === id) {
          adminCurrentUser = null;
          $("adminUserView").hidden = true;
          $("adminView").hidden = false;
        }
        loadAll();
      }).catch(function () { setAdminMsg("Internet ya server se rabta nahi ho raha.", false); });
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
    $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (aap)</span> ' : '') +
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
    $("adminBlockBtn").textContent = u.blocked ? "Unblock karein" : "Block karein";
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
      $("adminUserTxns").innerHTML = '<p class="empty">Is user ka koi record nahi hai.</p>';
    } else {
      var html = "";
      mine.forEach(function (t) {
        var other = t.payer_id === u.id ? profileName(t.receiver_id) : profileName(t.payer_id);
        var dir = t.payer_id === u.id ? "→ " + other + " (diye)" : "← " + other + " (liye)";
        html += '<div class="txn"><div><div class="t-main">' + esc(dir) + '</div>' +
          '<div class="t-sub">' + esc(t.note || "Khana") + ' · ' + esc(fmtDate(t.txn_date)) + '</div></div>' +
          '<div class="t-right"><span class="t-amt">' + esc(fmtRs(t.amount)) + '</span></div></div>';
      });
      $("adminUserTxns").innerHTML = html;
    }
    $("adminView").hidden = true;
    $("adminUserView").hidden = false;
    $("fabAdd").hidden = true;
    window.scrollTo(0, 0);
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
        if (!res.ok) { setAdminEditMsg("Update nahi hua — dobara koshish karein.", false); return; }
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
    if (!p1 || p1.length < 6) { setAdminPassMsg("Password kam az kam 6 harf ka ho.", false); return; }
    if (p1 !== p2) { setAdminPassMsg("Dono password aik jaise likhein.", false); return; }
    var btn = $("adminPassSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_set_user_password", { method: "POST", body: { p_target: adminCurrentUser.id, p_password: p1 } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { setAdminPassMsg("Password change nahi hua — dobara koshish karein.", false); return; }
        $("adminNewPass1").value = "";
        $("adminNewPass2").value = "";
        setAdminPassMsg("Password badal gaya — user naye password se login kar sakega.", true);
      }).catch(function () { btn.disabled = false; setAdminPassMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function toggleAdminBlock() {
    if (!isAdmin() || !adminCurrentUser) return;
    var u = adminCurrentUser;
    if (u.id === myId()) { setAdminUserMsg("Apne aap ko block nahi kar sakte.", false); return; }
    var blocking = !u.blocked;
    if (!window.confirm(blocking
      ? ("'" + (u.name || u.email) + "' ko BLOCK kar dein?\n\nWo dobara login nahi kar sakega (us ka data mehfooz rahe ga).")
      : ("'" + (u.name || u.email) + "' ko UNBLOCK kar dein?"))) return;
    sb("rpc/admin_set_user_blocked", { method: "POST", body: { p_target: u.id, p_blocked: blocking } })
      .then(function (res) {
        if (!res.ok) { setAdminUserMsg("Block update nahi hua — dobara koshish karein.", false); return; }
        u.blocked = blocking;
        $("adminBlockBtn").textContent = blocking ? "Unblock karein" : "Block karein";
        $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (aap)</span> ' : '') +
          (blocking ? '<span class="badge-blocked">Blocked</span>' : '<span class="badge-admin">Active</span>');
        setAdminUserMsg(blocking ? "User block ho gaya — dobara login nahi kar sakega." : "User unblock ho gaya.", true);
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
    var note = $("adminSetNote").value.trim() || "Admin ne amount set ki";
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
        if (!res.ok) { setAdminSetMsg("Amount set nahi hui — dobara koshish karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) {
          sendNotif(u.id, "admin", created);
          triggerPush(u.id, "Admin ne record likha", notifBodyFor(created, u.id));
          txns.unshift(created);
        }
        $("adminSetAmount").value = "";
        $("adminSetNote").value = "";
        setAdminSetMsg("Amount set ho gayi!", true);
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
    el.innerHTML = "Is mahine (<strong>" + esc(monthName(now + "-01")) + "</strong>): diye <strong>" + esc(fmtRs(given)) + "</strong> · liye <strong>" + esc(fmtRs(taken)) + "</strong> · " + count + " record";
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
    el.innerHTML = "Sab se bara khana: <strong>" + esc(fmtRs(biggest.amount)) + "</strong> (" + esc(biggest.note || "Khana") + ", " + esc(fmtDate(biggest.txn_date)) + ") · " +
      "Sab se zyada len-den: <strong>" + esc(profileName(topId)) + "</strong> (" + topN + " dafa) · " +
      "Average khana: <strong>" + esc(fmtRs(avg)) + "</strong>";
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
    setPhoneMsg(phone ? "Number save ho gaya!" : "Number hata diya gaya.", true);
  }
  function savePhone() {
    var phone = $("myPhone").value.trim();
    if (phone && !normPhone(phone)) { setPhoneMsg("Sahi phone number likhein (misal: 0300 1234567).", false); return; }
    sb("khata_profiles?id=eq." + encodeURIComponent(myId()), {
      method: "PATCH",
      prefer: "return=representation",
      body: { phone: phone || null }
    }).then(function (res) {
      if (!res.ok) {
        if (res.body && res.body.code === "42703") { setPhoneMsg("Phone column abhi database me nahi — pehle easy-khata-v2.sql chalana hai.", false); return; }
        setPhoneMsg("Number save nahi hua — dobara koshish karein.", false); return;
      }
      if (res.body && res.body.length) { finishPhoneSave(phone); return; }
      // Profile row maujood nahi — PATCH khamoshi se kuch nahi karta, is liye upsert se banayein.
      var meta = (session.user && session.user.user_metadata) || {};
      sb("khata_profiles?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: { id: myId(), name: meta.full_name || myName(), email: (session.user && session.user.email) || "", phone: phone || null }
      }).then(function (res2) {
        if (!res2.ok) { setPhoneMsg("Number save nahi hua — dobara koshish karein.", false); return; }
        finishPhoneSave(phone);
      }).catch(function () { setPhoneMsg("Internet ya server se rabta nahi ho raha.", false); });
    }).catch(function () { setPhoneMsg("Internet ya server se rabta nahi ho raha.", false); });
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
    var me = myId(), given = 0, taken = 0, gc = 0, tc = 0;
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === me) { given += a; gc++; }
      if (t.receiver_id === me) { taken += a; tc++; }
    });
    $("sumGiven").textContent = fmtRs(given);
    $("sumGivenCount").textContent = gc ? gc + " dafa diye" : "Abhi kuch nahi";
    $("sumTaken").textContent = fmtRs(taken);
    $("sumTakenCount").textContent = tc ? tc + " dafa liye" : "Abhi kuch nahi";
    var net = given - taken; // +: mujhe lene hain, -: mujhe dene hain
    if (net > 0) {
      $("sumNet").textContent = fmtRs(net);
      $("sumNetSub").textContent = "Mujhe lene hain";
    } else if (net < 0) {
      $("sumNet").textContent = fmtRs(-net);
      $("sumNetSub").textContent = "Mujhe dene hain";
    } else {
      $("sumNet").textContent = "Rs 0";
      $("sumNetSub").textContent = "Hisab barabar hai";
    }
  }

  function personStats(id) {
    var given = 0, taken = 0;
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === myId() && t.receiver_id === id) given += a;
      if (t.receiver_id === myId() && t.payer_id === id) taken += a;
    });
    return { given: given, taken: taken, net: given - taken }; // +: us se lene hain, -: use dene hain
  }
  function personShareText(p) {
    var s = personStats(p.id);
    var netLine = s.net > 0 ? "Net: mujhe " + fmtRs(s.net) + " lene hain."
      : s.net < 0 ? "Net: mujhe " + fmtRs(-s.net) + " dene hain." : "Net: hisab barabar hai.";
    return "Easy Khata — " + myName() + " aur " + (p.name || p.email) + " ka hisab:\n" +
      "• Maine diye: " + fmtRs(s.given) + "\n" +
      "• Maine liye: " + fmtRs(s.taken) + "\n" +
      "• " + netLine + "\n" +
      "App: https://easy-khata-asad2327s-projects.vercel.app";
  }
  function personRemindText(p) {
    var s = personStats(p.id);
    if (s.net > 0) return "Salam " + (p.name || "") + "! Easy Khata ke mutabiq mujhe aap se " + fmtRs(s.net) + " lene hain (khana ka hisab). Zara check kar lein, shukriya! — " + myName();
    if (s.net < 0) return "Salam " + (p.name || "") + "! Easy Khata ke mutabiq mujhe aap ko " + fmtRs(-s.net) + " dene hain (khana ka hisab). Main jald bhej dunga, shukriya! — " + myName();
    return "Salam " + (p.name || "") + "! Easy Khata ke mutabiq hamara khana ka hisab barabar hai. — " + myName();
  }
  function shareText(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    return copyText(text).then(function () { setPeopleMsg("Text copy ho gaya — WhatsApp ya kisi bhi app me paste kar dein.", true); });
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
    $("confirmOkBtn").textContent = okLabel || "Confirm karein";
    confirmCallback = cb;
    $("confirmOverlay").hidden = false;
  }
  function closeConfirm() {
    $("confirmOverlay").hidden = true;
    confirmCallback = null;
  }
  function openWaLink(url) {
    // window.open PWA me aksar kuch nahi karta — asal link dabana zyada reliable hai.
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 500);
  }
  function sendRemindNotif(id, text) {
    // Pehle se aik unread yaad-dihani ho to dobara na bhejein (spam rokne ke liye).
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
    var text = personRemindText(p);
    var s = personStats(id);
    var real = false;
    profiles.forEach(function (x) { if (x.id === id) real = true; });
    if (p.phone && normPhone(p.phone)) {
      copyText(text).catch(function () {});
      openWaLink(waLink(p.phone, text));
      setPeopleMsg("WhatsApp khul raha hai — agar na khule to text copy hai, WhatsApp me paste kar dein.", true);
      if (real && s.net) sendRemindNotif(id, text);
      return;
    }
    copyText(text).then(function () {
      setPeopleMsg("Is dost ka WhatsApp number nahi hai — yaad-dihani ka text copy ho gaya hai, khud bhej dein.", true);
      if (real && s.net) sendRemindNotif(id, text);
    }).catch(function () {
      setPeopleMsg("Copy nahi ho saka — number save karein ya text khud likh kar bhej dein.", false);
    });
  }
  function settlePerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var s = personStats(id);
    if (!s.net) return;
    var amt = Math.abs(s.net);
    var who = s.net > 0 ? (p.name || p.email) + " mujhe " + fmtRs(amt) + " dega" : "main " + (p.name || p.email) + " ko " + fmtRs(amt) + " dunga";
    askConfirm("Hisab barabar karein?", who + " — " + fmtRs(amt) + " ka settlement record ban jaye ga.", "Confirm karein", function () {
    var me = myId();
    var body = {
      payer_id: s.net > 0 ? id : me,
      receiver_id: s.net > 0 ? me : id,
      amount: amt,
      note: "Hisab barabar — settlement",
      txn_date: todayLocal(),
      created_by: me
    };
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        if (!res.ok) { setPeopleMsg("Settlement save nahi hua — dobara koshish karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(id, "settle", created); triggerPush(id, "Hisab barabar ho gaya", notifBodyFor(created, id)); }
        setPeopleMsg("Hisab barabar ho gaya!", true);
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
    var net = given - taken; // +: mujhe lene hain, -: mujhe dene hain
    var netLine = net > 0 ? "Net: mujhe " + fmtRs(net) + " lene hain."
      : net < 0 ? "Net: mujhe " + fmtRs(-net) + " dene hain." : "Net: hisab barabar hai.";
    var text = "Easy Khata — " + myName() + " ka khana hisab:\n" +
      "• Maine diye: " + fmtRs(given) + "\n" +
      "• Maine liye: " + fmtRs(taken) + "\n" +
      "• " + netLine + "\n" +
      "App: https://easy-khata-asad2327s-projects.vercel.app";
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    copyText(text).then(function () { setTxnMsg("Hisab copy ho gaya — kisi bhi app me paste kar dein.", true); });
  }

  function renderPeople() {
    var me = myId();
    var map = {};
    profiles.forEach(function (p) {
      if (p.id !== me) map[p.id] = { name: p.name || p.email, phone: p.phone || "", given: 0, taken: 0 };
    });
    myContacts.forEach(function (c) {
      map[c.id] = { name: c.name || "Namalum", phone: c.phone || "", given: 0, taken: 0, manual: true };
    });
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === me && map[t.receiver_id]) map[t.receiver_id].given += a;
      if (t.receiver_id === me && map[t.payer_id]) map[t.payer_id].taken += a;
    });
    var ids = Object.keys(map);
    if (!ids.length) {
      $("peopleList").innerHTML = '<p class="empty">Abhi koi aur user nahi hai — dost account banayein ge to yahan nazar aayein ge.</p>';
      return;
    }
    var html = "";
    ids.forEach(function (id) {
      var p = map[id];
      var net = p.given - p.taken; // +: us se lene hain, -: use dene hain
      var cls = net > 0 ? "pos" : net < 0 ? "neg" : "zero";
      var netText = net > 0 ? fmtRs(net) + " lene hain"
        : net < 0 ? fmtRs(-net) + " dene hain" : "Barabar";
      html += '<div class="person"><div><div class="p-name">' + esc(p.name) + (p.manual ? ' <span class="tag-manual">Manual</span>' : '') + '</div>' +
        '<div class="p-detail">Diye ' + fmtRs(p.given) + ' · Liye ' + fmtRs(p.taken) + '</div></div>' +
        '<div class="p-actions"><span class="p-net ' + cls + '">' + esc(netText) + '</span>' +
        '<span><button class="btn-mini" type="button" data-share="' + esc(id) + '">Share</button> ' +
        '<button class="btn-mini wa" type="button" data-remind="' + esc(id) + '">Yaad dilayein</button>' +
        (net !== 0 ? ' <button class="btn-mini" type="button" data-settle="' + esc(id) + '">Hisab barabar karein</button>' : '') +
        (p.manual ? ' <button class="btn-mini" type="button" data-del-contact="' + esc(id) + '">Hata dein</button>' : '') + '</span></div></div>';
    });
    $("peopleList").innerHTML = html;
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
    if (real) html += '<optgroup label="App users">' + real + '</optgroup>';
    var manual = "";
    myContacts.forEach(function (c) {
      manual += '<option value="' + esc(c.id) + '">' + esc(c.name || "Namalum") + '</option>';
    });
    if (manual) html += '<optgroup label="Mere contacts (manual)">' + manual + '</optgroup>';
    sel.innerHTML = html || '<option value="">(koi aur user nahi)</option>';
    if (prev) sel.value = prev;
  }

  function renderTxnFilterOptions() {
    var sel = $("txnFilterPerson");
    var prev = sel.value;
    var html = '<option value="">Sab log</option>';
    profiles.forEach(function (p) {
      html += '<option value="' + esc(p.id) + '">' + esc(p.name || p.email) + '</option>';
    });
    myContacts.forEach(function (c) {
      html += '<option value="' + esc(c.id) + '">' + esc(c.name || "Namalum") + ' (manual)</option>';
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
    if (!list.length) { setTxnMsg("Download ke liye koi record nahi hai.", false); return; }
    var rows = [["Tareekh", "Dene wala", "Lene wala", "Raqam (Rs)", "Khana / Note"]];
    list.forEach(function (t) {
      rows.push([fmtDate(t.txn_date), profileName(t.payer_id), profileName(t.receiver_id), Number(t.amount) || 0, t.note || "Khana"]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "easy-khata-" + todayLocal() + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    setTxnMsg("CSV download ho gayi (" + list.length + " record).", true);
  }
  function renderTxns() {
    var me = myId();
    var list = filteredTxns();
    if (!txns.length) {
      $("txnList").innerHTML = '<p class="empty">Abhi koi record nahi hai — pehla record upar se likhein.</p>';
      return;
    }
    if (!list.length) {
      $("txnList").innerHTML = '<p class="empty">Is search/filter ka koi record nahi mila.</p>';
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
        '<div class="t-sub">' + esc(t.note || "Khana") + ' · ' + esc(fmtDate(t.txn_date)) + '</div></div>' +
        '<div class="t-right"><span class="t-amt ' + amtCls + '">' + sign + esc(fmtRs(a)) + '</span>' + btns + '</div></div>';
    });
    $("txnList").innerHTML = html;
  }

  /* ---------- add / edit / delete ---------- */
  function resetTxnForm() {
    setSplitMode(false);
    editingId = null;
    $("txnFormTitle").textContent = "Naya record likhein";
    $("txnForm").querySelector('button[type="submit"]').textContent = "Record save karein";
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
    $("txnFormTitle").textContent = "Record edit karein";
    $("txnForm").querySelector('button[type="submit"]').textContent = "Edit save karein";
    $("cancelEditBtn").hidden = false;
    $("txnForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  /* ---------- group split (barabar bantein) ---------- */
  function renderSplitList() {
    var me = myId();
    var html = "";
    profiles.forEach(function (p) {
      if (p.id === me) return;
      html += '<label><input type="checkbox" data-split-person="' + esc(p.id) + '"> ' + esc(p.name || p.email) + '</label>';
    });
    $("splitList").innerHTML = html || '<p class="empty">Abhi koi aur user nahi hai.</p>';
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
    if (!total || total <= 0) { $("splitHint").textContent = ids.length + " dost chune — ab kul raqam likhein."; return; }
    var people = ids.length + 1; // dost + aap — aap ka hissa bhi ginna hai
    var share = Math.floor(total / people * 100) / 100;
    $("splitHint").textContent = "Har bande ka hissa: " + fmtRs(share) + " (" + ids.length + " dost + aap · kul " + fmtRs(total) + " · aap ka hissa " + fmtRs(share) + ")";
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
    if (!ids.length) { setTxnMsg("Barabar bantne ke liye kam az kam aik dost chunein.", false); return; }
    var me = myId();
    var people = ids.length + 1; // dost + aap — kul raqam sab par barabar, aap ka hissa bhi
    var share = Math.floor(amount / people * 100) / 100;
    if (share <= 0) { setTxnMsg("Raqam itni kam hai ke hissa nahi ban raha.", false); return; }
    btn.disabled = true;
    var done = 0, failed = 0, i = 0;
    function next() {
      if (i >= ids.length) {
        btn.disabled = false;
        if (failed) setTxnMsg(done + " record save hue, " + failed + " nahi hue — dobara check karein.", false);
        else { setTxnMsg(ids.length + " record save ho gaye (barabar bant gaye)!", true); resetTxnForm(); }
        loadAll();
        return;
      }
      var id = ids[i++];
      var amt = (i === ids.length) ? Math.round((amount - share * ids.length) * 100) / 100 : share;
      sb("khata_transactions", { method: "POST", prefer: "return=representation", body: {
        payer_id: me, receiver_id: id, amount: amt,
        note: (note || "Khana") + " (barabar)", txn_date: date, created_by: me
      } }).then(function (res) {
        if (res.ok) { done++; var created = res.body && res.body[0]; if (created) { sendNotif(id, "record", created); triggerPush(id, myName() + " ne record likha", notifBodyFor(created, id)); } }
        else failed++;
        next();
      })
      .catch(function () { failed++; next(); });
    }
    next();
  }

  function addTxn(e) {
    e.preventDefault();
    if (!dbReady) { setTxnMsg("Database setup baqi hai.", false); return; }
    var person = $("txnPerson").value;
    var dir = (document.querySelector('input[name="txnDir"]:checked') || {}).value || "given";
    var amount = parseFloat($("txnAmount").value);
    var note = $("txnNote").value.trim();
    var date = $("txnDate").value;
    if (!splitMode && !person) { setTxnMsg("Pehle koi dost select karein (us ka account hona zaroori hai).", false); return; }
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
      note: note || "Khana",
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
          if (!res.ok) { setTxnMsg("Edit save nahi hua — dobara koshish karein.", false); return; }
          resetTxnForm();
          setTxnMsg("Record edit ho gaya!", true);
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
        if (!res.ok) { setTxnMsg("Record save nahi hua — dobara koshish karein.", false); return; }
        var created = res.body && res.body[0];
        if (created) { sendNotif(person, "record", created); triggerPush(person, myName() + " ne record likha", notifBodyFor(created, person)); }
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
    askConfirm("Record delete karein?", "Ye record hamesha ke liye delete ho jaye ga.", "Delete karein", function () {
    sb("khata_transactions?id=eq." + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) { setTxnMsg("Delete nahi hua.", false); return; }
        loadAll();
      }).catch(function () { setTxnMsg("Delete nahi hua.", false); });
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
  $("menuBtn").addEventListener("click", openDrawer);
  $("avatarBtn").addEventListener("click", openDrawer);
  $("drawerCloseBtn").addEventListener("click", closeDrawer);
  $("drawerOverlay").addEventListener("click", closeDrawer);
  $("navKhataBtn").addEventListener("click", showAppView);
  $("navAdminBtn").addEventListener("click", showAdminView);
  $("adminBackBtn").addEventListener("click", showAppView);
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
    var st = e.target.closest ? e.target.closest("[data-settle]") : null;
    if (st) { settlePerson(st.getAttribute("data-settle")); return; }
    var s = e.target.closest ? e.target.closest("[data-share]") : null;
    if (s) { sharePerson(s.getAttribute("data-share")); return; }
    var r = e.target.closest ? e.target.closest("[data-remind]") : null;
    if (r) { remindPerson(r.getAttribute("data-remind")); return; }
    var d = e.target.closest ? e.target.closest("[data-del-contact]") : null;
    if (d) deleteContact(d.getAttribute("data-del-contact"));
  });
  $("txnList").addEventListener("click", function (e) {
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
  $("adminUserBackBtn").addEventListener("click", function () { $("adminUserView").hidden = true; $("adminView").hidden = false; renderAdmin(); });
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
    var card = $("txnFormCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    var amt = $("txnAmount");
    if (amt) setTimeout(function () { amt.focus({ preventScroll: true }); }, 400);
  });

  /* ---------- app auto-update (naya version khud aa jaye) ---------- */
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
      // Pehli dafa install par reload nahi — sirf purane version se naye par.
      if (!hadControllerAtLoad) return;
      if (updateReloaded) return;
      if (isFormDirty()) return; // form bhara hai to agle open par naya version aa jaye ga
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
    $("authBox").hidden = true;
    return;
  }
  if (!handleAuthHash()) authValidate();
})();
