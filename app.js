/* Easy Khata — khana ka len den.
   Vanilla JS + Supabase (GoTrue auth + PostgREST), Diesel Converter wali
   proven pattern. Koi framework nahi, koi eval nahi. */
(function () {
  "use strict";
  var cfg = window.EASY_KHATA_CONFIG || {};
  var API = cfg.SUPABASE_URL;
  var ANON = cfg.SUPABASE_ANON_KEY;
  var SESSION_KEY = "easykhata_auth";

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
  var profiles = [];   // {id, name, email}
  var txns = [];       // {id, payer_id, receiver_id, amount, note, txn_date, created_by, created_at}
  var dbReady = false;
  var authMode = "login";

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
    $("authSubmitBtn").textContent = authMode === "signup" ? "Account banayein" : "Login karein";
    $("authPassword").setAttribute("autocomplete", authMode === "signup" ? "new-password" : "current-password");
    setAuthMsg("");
  }
  function showAuth() {
    $("authBox").hidden = false;
    $("appBox").hidden = true;
    $("userChip").hidden = true;
    $("logoutBtn").hidden = true;
    renderAuthMode();
  }
  function showApp() {
    $("authBox").hidden = true;
    $("appBox").hidden = false;
    $("userChip").hidden = false;
    $("logoutBtn").hidden = false;
    $("userChip").textContent = myName();
    $("txnDate").value = todayLocal();
  }

  function authErrorText(res) {
    var m = (res.body && (res.body.msg || res.body.message || res.body.error_description)) || "";
    if (/invalid login/i.test(m)) return "Email ya password ghalat hai.";
    if (/already registered|already exists/i.test(m)) return "Is email par account pehle se hai — login karein.";
    if (/password/i.test(m) && /short|least|6/i.test(m)) return "Password kam az kam 6 harf ka ho.";
    if (/email/i.test(m) && /invalid/i.test(m)) return "Sahi email likhein.";
    return m || "Kuch ghalat hua — dobara koshish karein.";
  }

  function ensureProfile() {
    var u = session.user;
    var name = (u.user_metadata && u.user_metadata.full_name) || "";
    return sb("khata_profiles?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { id: u.id, name: name, email: u.email || "" }
    }).then(function (res) {
      if (!res.ok) throw new Error("profile save failed");
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
    if (!email || !password) { setAuthMsg("Email aur password zaroori hain.", false); return; }
    if (authMode === "signup" && !name) { setAuthMsg("Apna naam likhein.", false); return; }
    if (password.length < 6) { setAuthMsg("Password kam az kam 6 harf ka ho.", false); return; }
    var btn = $("authSubmitBtn");
    btn.disabled = true;
    var p = authMode === "signup"
      ? authCall("/signup", { email: email, password: password, data: { full_name: name } })
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

  function loadAll() {
    setTxnMsg("");
    sb("khata_profiles?select=id,name,email&order=name.asc").then(function (res) {
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
    renderPeople();
    renderPersonSelect();
    renderTxns();
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
        '<span class="p-net ' + cls + '">' + esc(netText) + '</span></div>';
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

  function renderTxns() {
    var me = myId();
    if (!txns.length) {
      $("txnList").innerHTML = '<p class="empty">Abhi koi record nahi hai — pehla record upar se likhein.</p>';
      return;
    }
    var html = "";
    txns.forEach(function (t) {
      var a = Number(t.amount) || 0;
      var iGave = t.payer_id === me;
      var iTook = t.receiver_id === me;
      var amtCls = iGave ? "given" : iTook ? "taken" : "";
      var sign = iGave ? "− " : iTook ? "+ " : "";
      var del = t.created_by === me
        ? '<button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button>' : "";
      html += '<div class="txn"><div><div class="t-main">' + esc(profileName(t.payer_id)) + ' → ' + esc(profileName(t.receiver_id)) + '</div>' +
        '<div class="t-sub">' + esc(t.note || "Khana") + ' · ' + esc(fmtDate(t.txn_date)) + '</div></div>' +
        '<div class="t-right"><span class="t-amt ' + amtCls + '">' + sign + esc(fmtRs(a)) + '</span>' + del + '</div></div>';
    });
    $("txnList").innerHTML = html;
  }

  /* ---------- add / delete ---------- */
  function addTxn(e) {
    e.preventDefault();
    if (!dbReady) { setTxnMsg("Database setup baqi hai.", false); return; }
    var person = $("txnPerson").value;
    var dir = (document.querySelector('input[name="txnDir"]:checked') || {}).value || "given";
    var amount = parseFloat($("txnAmount").value);
    var note = $("txnNote").value.trim();
    var date = $("txnDate").value;
    if (!person) { setTxnMsg("Pehle koi dost select karein (us ka account hona zaroori hai).", false); return; }
    if (!amount || amount <= 0) { setTxnMsg("Sahi raqam likhein.", false); return; }
    if (!date) { setTxnMsg("Tareekh likhein.", false); return; }
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
  $("authPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doAuth(); });
  $("logoutBtn").addEventListener("click", function () { saveSession(null); showAuth(); });
  $("txnForm").addEventListener("submit", addTxn);
  $("refreshBtn").addEventListener("click", loadAll);
  $("txnList").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });

  if (!API || !ANON) {
    $("setupBox").hidden = false;
    $("authBox").hidden = true;
    return;
  }
  authValidate();
})();
