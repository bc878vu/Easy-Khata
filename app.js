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
    return id === myId() ? myName() : "Namalum";
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
    $("authSubmitBtn").textContent = authMode === "signup" ? "Account banayein" : "Login karein";
    $("authPassword").setAttribute("autocomplete", authMode === "signup" ? "new-password" : "current-password");
    setAuthMsg("");
  }
  function showAuth() {
    closeDrawer();
    $("authBox").hidden = false;
    $("appBox").hidden = true;
    $("adminView").hidden = true;
    $("avatarBtn").hidden = true;
    $("menuBtn").hidden = true;
    $("authForm").hidden = false;
    $("forgotBox").hidden = true;
    $("resetBox").hidden = true;
    renderAuthMode();
  }
  function showApp() {
    $("authBox").hidden = true;
    $("adminView").hidden = true;
    $("appBox").hidden = false;
    var initial = (myName() || "?").trim().charAt(0).toUpperCase() || "?";
    $("avatarBtn").textContent = initial;
    $("drawerAvatar").textContent = initial;
    $("drawerName").textContent = myName();
    $("drawerEmail").textContent = (session.user && session.user.email) || "";
    $("avatarBtn").hidden = false;
    $("menuBtn").hidden = false;
    $("txnDate").value = todayLocal();
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
    return m || ("Kuch ghalat hua — dobara koshish karein. (Code " + res.status + ")");
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
    if (res.body && res.body.user && !res.body.access_token) {
      setAuthMsg("Account ban gaya! Email me confirmation link aya hai — us par click kar ke phir login karein.", true);
      authMode = "login";
      renderAuthMode();
      return;
    }
    if (!res.body || !res.body.access_token) {
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
      ? authCall("/signup", { email: email, password: password, data: { full_name: name, phone: phone || "" } })
      : authCall("/token?grant_type=password", { email: email, password: password });
    p.then(function (res) {
      btn.disabled = false;
      if (!res.ok && !(res.body && res.body.access_token)) { setAuthMsg(authErrorText(res), false); return; }
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
    if (show) { $("resetBox").hidden = true; setForgotMsg(""); }
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

  /* ---------- admin panel ---------- */
  function setAdminMsg(text, ok) {
    var el = $("adminMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function renderAdmin() {
    if (!isAdmin()) { $("navAdminBtn").hidden = true; return; }
    $("navAdminBtn").hidden = false;
    var me = myId();
    $("adminStats").textContent = "Total users: " + profiles.length + " · Total records: " + txns.length;
    if (!profiles.length) {
      $("adminUserList").innerHTML = '<p class="empty">Abhi koi user nahi hai.</p>';
      return;
    }
    var html = "";
    profiles.forEach(function (p) {
      var count = 0;
      txns.forEach(function (t) {
        if (t.payer_id === p.id || t.receiver_id === p.id || t.created_by === p.id) count++;
      });
      var del = p.id === me
        ? '<span class="p-net zero">Admin (aap)</span>'
        : '<button class="btn-danger" type="button" data-admin-del="' + esc(p.id) + '">Delete user</button>';
      html += '<div class="person"><div><div class="p-name">' + esc(p.name || p.email) + '</div>' +
        '<div class="p-detail">' + esc(p.email || "") + (p.phone ? ' · ' + esc(p.phone) : '') + '</div>' +
        '<div class="p-detail">' + count + ' record · Joined ' + esc(fmtDate(p.created_at)) + '</div></div>' +
        '<div class="p-actions">' + del + '</div></div>';
    });
    $("adminUserList").innerHTML = html;
  }
  function deleteUser(id) {
    var p = findPerson(id);
    if (!p || id === myId()) return;
    if (!window.confirm("'" + (p.name || p.email) + "' ko delete kar dein?\n\nUs ka account, profile aur tamam record delete ho jayein ge. Ye wapas nahi ho sakta.")) return;
    sb("rpc/admin_delete_user", { method: "POST", body: { target_id: id } })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 404) { setAdminMsg("Admin delete ke liye easy-khata-v3.sql chalana hai (BEWX SQL Editor).", false); return; }
          setAdminMsg("User delete nahi hua — dobara koshish karein.", false);
          return;
        }
        setAdminMsg("User delete ho gaya.", true);
        loadAll();
      }).catch(function () { setAdminMsg("Internet ya server se rabta nahi ho raha.", false); });
  }

  function renderMonthStats() {
    var el = $("monthStats");
    var now = todayLocal().slice(0, 7);
    var given = 0, taken = 0, count = 0;
    txns.forEach(function (t) {
      if (String(t.txn_date || "").slice(0, 7) !== now) return;
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
    var net = taken - given;
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
    return { given: given, taken: taken, net: taken - given };
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
    return found;
  }
  function sharePerson(id) {
    var p = findPerson(id);
    if (!p) return;
    shareText(personShareText(p));
  }
  function remindPerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var text = personRemindText(p);
    if (p.phone && normPhone(p.phone)) {
      window.open(waLink(p.phone, text), "_blank");
      return;
    }
    copyText(text).then(function () {
      setPeopleMsg("Is dost ka WhatsApp number nahi hai — yaad-dihani ka text copy ho gaya hai, khud bhej dein.", true);
    });
  }
  function settlePerson(id) {
    var p = findPerson(id);
    if (!p) return;
    var s = personStats(id);
    if (!s.net) return;
    var amt = Math.abs(s.net);
    var who = s.net > 0 ? (p.name || p.email) + " mujhe " + fmtRs(amt) + " dega" : "main " + (p.name || p.email) + " ko " + fmtRs(amt) + " dunga";
    if (!window.confirm("Hisab barabar karein?\n\n" + who + " — " + fmtRs(amt) + " ka settlement record ban jaye ga.")) return;
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
        setPeopleMsg("Hisab barabar ho gaya!", true);
        loadAll();
      }).catch(function () { setPeopleMsg("Internet ya server se rabta nahi ho raha.", false); });
  }
  function shareAll() {
    var given = 0, taken = 0;
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      if (t.payer_id === myId()) given += a;
      if (t.receiver_id === myId()) taken += a;
    });
    var net = taken - given;
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
      if (p.id !== me) map[p.id] = { name: p.name || p.email, given: 0, taken: 0 };
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
      var net = p.taken - p.given; // +: us se lene hain, -: use dene hain
      var cls = net > 0 ? "pos" : net < 0 ? "neg" : "zero";
      var netText = net > 0 ? fmtRs(net) + " lene hain"
        : net < 0 ? fmtRs(-net) + " dene hain" : "Barabar";
      html += '<div class="person"><div><div class="p-name">' + esc(p.name) + '</div>' +
        '<div class="p-detail">Diye ' + fmtRs(p.given) + ' · Liye ' + fmtRs(p.taken) + '</div></div>' +
        '<div class="p-actions"><span class="p-net ' + cls + '">' + esc(netText) + '</span>' +
        '<span><button class="btn-mini" type="button" data-share="' + esc(id) + '">Share</button> ' +
        '<button class="btn-mini wa" type="button" data-remind="' + esc(id) + '">Yaad dilayein</button>' +
        (net !== 0 ? ' <button class="btn-mini" type="button" data-settle="' + esc(id) + '">Hisab barabar karein</button>' : '') + '</span></div></div>';
    });
    $("peopleList").innerHTML = html;
  }

  function renderPersonSelect() {
    var me = myId();
    var sel = $("txnPerson");
    var prev = sel.value;
    var html = "";
    profiles.forEach(function (p) {
      if (p.id === me) return;
      html += '<option value="' + esc(p.id) + '">' + esc(p.name || p.email) + '</option>';
    });
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
    var share = Math.floor(total / ids.length * 100) / 100;
    $("splitHint").textContent = "Har bande ka hissa: " + fmtRs(share) + " (" + ids.length + " dost · kul " + fmtRs(total) + ")";
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
    var share = Math.floor(amount / ids.length * 100) / 100;
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
      var amt = (i === ids.length) ? Math.round((amount - share * (ids.length - 1)) * 100) / 100 : share;
      sb("khata_transactions", { method: "POST", prefer: "return=representation", body: {
        payer_id: me, receiver_id: id, amount: amt,
        note: (note || "Khana") + " (barabar)", txn_date: date, created_by: me
      } }).then(function (res) { if (res.ok) done++; else failed++; next(); })
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
    if (!window.confirm("Ye record delete kar dein?")) return;
    sb("khata_transactions?id=eq." + encodeURIComponent(id), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) { setTxnMsg("Delete nahi hua.", false); return; }
        loadAll();
      }).catch(function () { setTxnMsg("Delete nahi hua.", false); });
  }

  /* ---------- wire up ---------- */
  $("tabLogin").addEventListener("click", function () { authMode = "login"; renderAuthMode(); });
  $("tabSignup").addEventListener("click", function () { authMode = "signup"; renderAuthMode(); });
  $("authSubmitBtn").addEventListener("click", doAuth);
  $("forgotLink").addEventListener("click", function () { showForgot(true); });
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
    if (r) remindPerson(r.getAttribute("data-remind"));
  });
  $("txnList").addEventListener("click", function (e) {
    var ed = e.target.closest ? e.target.closest("[data-edit]") : null;
    if (ed) { startEditTxn(ed.getAttribute("data-edit")); return; }
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });
  $("adminUserList").addEventListener("click", function (e) {
    var d = e.target.closest ? e.target.closest("[data-admin-del]") : null;
    if (d) deleteUser(d.getAttribute("data-admin-del"));
  });

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
