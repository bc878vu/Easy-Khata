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
  function dateToISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseISODate(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  // v87: recurring — agla occurrence STRICTLY after fromISO (aaj ki date
  // bhi agle period mein jati hai, taake aaj ka record dobara na bane).
  // monthly: day_value 1-28 (mahine ki tareekh); weekly: ISO weekday 1 Mon..7 Sun.
  function nextRecurringDate(freq, day, fromISO) {
    var from = parseISODate(fromISO) || new Date();
    if (freq === "weekly") {
      var iso = from.getDay() === 0 ? 7 : from.getDay();
      var diff = (day - iso + 7) % 7;
      if (diff === 0) diff = 7;
      return dateToISO(new Date(from.getFullYear(), from.getMonth(), from.getDate() + diff));
    }
    var cand = new Date(from.getFullYear(), from.getMonth(), day);
    if (cand <= from) cand = new Date(from.getFullYear(), from.getMonth() + 1, day);
    return dateToISO(cand);
  }
  // v87: deterministic txn id (rule + due date) — due check dobara chale ya
  // response kho jaye to bhi wahi id banti hai; POST 409 = pehle hi bana hua.
  function hash32(str, seed) {
    var h1 = seed >>> 0, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var s1 = (h2 >>> 0).toString(16), s2 = (h1 >>> 0).toString(16);
    while (s1.length < 8) s1 = "0" + s1;
    while (s2.length < 8) s2 = "0" + s2;
    return s1 + s2;
  }
  function recurringDueId(ruleId, dueISO) {
    var a = hash32(ruleId + "|" + dueISO, 0xdeadbeef);
    var b = hash32(dueISO + "|" + ruleId, 0x9e3779b9);
    return a.slice(0, 8) + "-" + a.slice(8, 12) + "-5" + a.slice(13, 16) + "-8" + b.slice(0, 3) + "-" + b.slice(3, 15);
  }
  function moneyToMinor(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100);
  }
  function moneyFromMinor(value) {
    return (Number(value) || 0) / 100;
  }
  function fmtRs(n) {
    var v = moneyFromMinor(moneyToMinor(n));
    return "Rs " + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
    var previousId = session && session.user ? session.user.id : "";
    session = s || null;
    var nextId = session && session.user ? session.user.id : "";
    setUserScopedStorage(nextId);
    if (previousId !== nextId) {
      workspaces = []; currentWorkspaceId = ""; profiles = []; txns = []; myContacts = []; hiddenTxnIds = {};
      try { teardownRealtime(); } catch (e) {}
    }
    try {
      if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function myId() {
    // v24: guest mode mein "me" = local guest id — saara render/share/balance
    // code isi par chalta hai, is liye guest ledger bina kisi server call ke
    // wahi UI use karta hai jo logged-in mode mein chalta hai.
    return guestMode ? guestMeId : (session && session.user ? session.user.id : "");
  }
  function isAdmin() {
    return !!ADMIN_EMAIL && session && session.user && session.user.email === ADMIN_EMAIL;
  }
  function myName() {
    if (guestMode) return guestMeName || "Aap";
    if (!session || !session.user) return "";
    var m = session.user.user_metadata || {};
    return m.full_name || session.user.email || "";
  }
  function authToken() { return session && session.access_token ? session.access_token : ANON; }

  /* ---------- Supabase helpers ---------- */
  function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    var controller = window.AbortController ? new window.AbortController() : null;
    if (controller) options.signal = controller.signal;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) {} }
        if (!settled) { settled = true; reject(new Error("request-timeout")); }
      }, timeoutMs || 12000);
      fetch(url, options).then(function (response) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(response);
      }, function (error) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(error);
      });
    });
  }

  function authCall(path, body) {
    return fetchWithTimeout(API + "/auth/v1" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON,
        "Authorization": "Bearer " + ANON
      },
      body: JSON.stringify(body || {})
    }, 12000).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  function sb(path, opts) {
    opts = opts || {};
    var method = String(opts.method || "GET").toUpperCase();
    var headers = {
      "apikey": ANON,
      "Authorization": "Bearer " + authToken(),
      "Content-Type": "application/json"
    };
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    if (opts.range) {
      headers["Range-Unit"] = "items";
      headers["Range"] = opts.range;
    }
    function request() {
      return fetchWithTimeout(API + "/rest/v1/" + path, {
        method: method, headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }, navigator.onLine ? 12000 : 6000).then(function (r) {
        lastNetworkResponseAt = Date.now();
        // v68: server ne jawab de diya = internet maujood hai. Agar badge
        // laga hua tha to abhi hatao (pehle sirf online event ya agle
        // loadAll par hat-ta tha — slow connection par atak jata tha).
        if (r.ok && offlineMode) { offlineMode = false; stopOfflineRecheck(); renderOffline(); }
        else if (r.ok) offlineMode = false;
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          return { ok: r.ok, status: r.status, body: j, raw: t };
        });
      });
    }
    function wait(ms) { return new Promise(function(resolve){setTimeout(resolve,ms);}); }
    function refreshOnce() {
      if (!session || !session.refresh_token) return Promise.resolve(false);
      return authCall("/token?grant_type=refresh_token",{refresh_token:session.refresh_token}).then(function(res){
        if(!res.ok||!res.body||!res.body.access_token)return false;
        if(!res.body.user&&session.user)res.body.user=session.user;
        saveSession(res.body);
        headers.Authorization="Bearer "+authToken();
        return true;
      });
    }
    function run(authRetried,networkAttempt) {
      return request().then(function(res){
        if(res.status===401&&!authRetried&&session&&session.refresh_token){
          return refreshOnce().then(function(ok){return ok?run(true,networkAttempt):res;});
        }
        if(method==="GET"&&(res.status>=500)&&networkAttempt<1){
          return wait(400*(networkAttempt+1)).then(function(){return run(authRetried,networkAttempt+1);});
        }
        return res;
      }).catch(function(err){
        var transient=err&&(err.name==="TypeError"||err.message==="request-timeout"||/failed to fetch|networkerror|network request failed|load failed/i.test(String(err.message||"")));
        if(method==="GET"&&transient&&networkAttempt<1){
          return wait(450*(networkAttempt+1)).then(function(){return run(authRetried,networkAttempt+1);});
        }
        throw err;
      });
    }
    return run(false,0);
  }

  /* ---------- state ---------- */
  var profiles = [];   // Current workspace people only (RLS scoped)
  var workspaces = [];
  var currentWorkspaceId = "";
  var workspaceInviteBusy = false;
  var txns = [];       // {id, payer_id, receiver_id, amount, note, txn_date, created_by, created_at}
  var txnFullSyncAt = 0; // v86: aakhri FULL txn sync (ms) — delta sync ka 24h bound
  var recurringRules = []; // v87: is workspace ke recurring rules (khata_recurring)
  var recurringDueRunning = false; // v87: due check aik waqt mein aik dafa
  // v24.11: per-user hidden records — Delete kabhi real DELETE nahi karta.
  // Har user ke apne hidden ids (khata_txn_hidden table) — sirf us ki apni
  // history se record hat-ta hai, doosre dost ko koi fark nahi parta.
  var hiddenTxnIds = {}; // {txnId: true}
  function visibleTxns() { return txns.filter(function (t) { return !hiddenTxnIds[t.id]; }); }
  // Balance ledger is independent from history visibility: hiding a row only
  // removes it from the history UI, never from balances or friend totals.
  function balanceTxns() { return txns; }
  var adminUsers = []; // admin_list_users RPC rows {id, name, email, phone, created_at, blocked, records}
  var adminWorkspaces = [];
  var adminWorkspaceMembers = [];
  var lastMemberRows = []; // v80: members modal ki aakhri fetch (search local filter ke liye)
  var memberSearchQ = "";
  var adminCommunityMemberShown = 20; // v80: admin member list — pehle 20, phir Show more
  var adminUserShown = 20; // v81: admin user list — pehle 20, phir Show more
  var adminCommunityShown = 20; // v81: admin community list — pehle 20, phir Show more
  var adminEditingWorkspace = null;
  var adminCurrentUser = null;
  var adminUserSearchText = "";
  var adminUserStatusFilter = "all";
  var adminUserSortMode = "recent";
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
  var offlineMode = false;
  var lastNetworkResponseAt = 0;
  var syncing = false;       // flushOutbox guard (ek waqt mein aik sync)
  var CACHE_KEY = "easykhata_cache_v1_anonymous";
  var OUTBOX_KEY = "easykhata_outbox_v1_anonymous";
  var ACTIVE_WS_KEY = "easykhata_active_workspace_v1_anonymous";
  function workspaceCacheKey(workspaceId) {
    return CACHE_KEY + "_ws_" + String(workspaceId || "default");
  }
  function setUserScopedStorage(userId) {
    var uid = userId || "anonymous";
    CACHE_KEY = "easykhata_cache_v1_" + uid;
    OUTBOX_KEY = "easykhata_outbox_v1_" + uid;
    ACTIVE_WS_KEY = "easykhata_active_workspace_v1_" + uid;
    if (!userId) return;
    try {
      if (!window.localStorage.getItem(CACHE_KEY)) {
        var legacy = window.localStorage.getItem("easykhata_cache_v1");
        var parsed = legacy ? JSON.parse(legacy) : null;
        if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.some(function (p) { return p.id === userId; })) {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
        }
      }
      if (!window.localStorage.getItem(OUTBOX_KEY)) {
        var oldOps = JSON.parse(window.localStorage.getItem("easykhata_outbox_v1") || "[]");
        if (Array.isArray(oldOps) && oldOps.length) {
          var mine = oldOps.filter(function (o) {
            var b = o && o.body || {};
            return b.created_by === userId || b.owner_id === userId || b.user_id === userId;
          });
          if (mine.length) window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(mine));
        }
      }
    } catch (e) {}
  }
  setUserScopedStorage(session && session.user ? session.user.id : "");

  /* ---------- guest mode (v24) — bina login ke personal manual hisaab ----------
     Data SIRF is device par localStorage (easykhata_guest_v1) mein rehta hai.
     Server ko kabhi kuch nahi bheja jata: na Supabase (na profiles, na
     transactions, na contacts), na /api/notify, na push subscription, na
     realtime channel. Logged-in cache (easykhata_cache_v1) aur outbox
     (easykhata_outbox_v1) se bilkul alag key hai — kabhi mix nahi hoti.
     Guest mode mein NO push, NO multi-device sync, NO admin panel,
     NO realtime, NO cloud backup (jab tak account na banayein). */
  var GUEST_KEY = "easykhata_guest_v1";
  var guestMode = false;
  var guestMeId = "";
  var guestMeName = "Aap";
  function loadGuestStore() {
    try {
      var raw = window.localStorage.getItem(GUEST_KEY);
      if (!raw) return null;
      var g = JSON.parse(raw);
      if (!g || typeof g !== "object" || !Array.isArray(g.contacts) || !Array.isArray(g.txns)) return null;
      return g;
    } catch (e) { return null; }
  }
  function saveGuestStore() {
    // Sirf guest mode mein — logged-in cache ko kabhi guest data nahi likhte.
    if (!guestMode) return;
    try {
      window.localStorage.setItem(GUEST_KEY, JSON.stringify({
        me: { id: guestMeId, name: guestMeName },
        contacts: myContacts, txns: txns, hidden: Object.keys(hiddenTxnIds), savedAt: Date.now(),
        recurring: recurringRules
      }));
    } catch (e) {}
  }
  function guestHasData() {
    var g = loadGuestStore();
    return !!(g && ((g.contacts && g.contacts.length) || (g.txns && g.txns.length)));
  }
  function loadGuestIntoState() {
    // Guest store -> in-memory state. Logged-in data ko kabhi nahi chhoota:
    // ye sirf guest mode mein chalta hai (loadAll / enterGuestMode se).
    var g = loadGuestStore();
    var hadMeId = !!(g && g.me && g.me.id);
    guestMeId = (g && g.me && g.me.id) || ("guest-" + newUuid());
    guestMeName = (g && g.me && g.me.name) || "Aap";
    profiles = [{ id: guestMeId, name: guestMeName, email: "", phone: "" }];
    // v71 PRIVACY PURGE: guest ka har apna record us se jura hota hai
    // (payer ya receiver = guest me). Jo record dono taraf se guest se na
    // jura ho, woh purani leak se account ka record hai (2026-11-08: liveReload
    // ne Business workspace ke records guest view mein daal diye the) — use
    // hamesha ke liye hata do. Aise records se bane contacts (sirf un mein
    // aane wale ids) bhi hata do. Sirf tab jab store mein me.id ho — warna
    // (kharab store) kuch na hatao, taake guest ka apna hisaab kabhi na mite.
    var allTxns = (g && g.txns) || [];
    var keptTxns = allTxns, droppedIds = {}, keptPartyIds = {};
    if (hadMeId) {
      keptTxns = allTxns.filter(function (t) { return t.payer_id === guestMeId || t.receiver_id === guestMeId; });
      allTxns.forEach(function (t) { if (t.payer_id !== guestMeId && t.receiver_id !== guestMeId) { droppedIds[t.payer_id] = true; droppedIds[t.receiver_id] = true; } });
      keptTxns.forEach(function (t) { keptPartyIds[t.payer_id] = true; keptPartyIds[t.receiver_id] = true; });
    }
    var purged = allTxns.length - keptTxns.length;
    txns = keptTxns;
    myContacts = (g && g.contacts ? g.contacts : []).map(function (c) { c.manual = true; return c; })
      .filter(function (c) { return !droppedIds[c.id] || keptPartyIds[c.id]; });
    hiddenTxnIds = {};
    (g && Array.isArray(g.hidden) ? g.hidden : []).forEach(function (id) { if (keptTxns.some(function (t) { return t.id === id; })) hiddenTxnIds[id] = true; });
    // v87: guest recurring rules — sirf woh jin mein guest shamil ho
    // (dono taraf se bahar wala rule purani leak hai, txns ki tarah hatao).
    recurringRules = ((g && g.recurring) || []).filter(function (r) { return r.payer_id === guestMeId || r.receiver_id === guestMeId; });
    notifs = [];
    dbReady = true;
    offlineMode = false;
    if (purged > 0) saveGuestStore(); // saaf store foran persist karo taake leak dobara na dikhe
  }
  function enterGuestMode() {
    // v71 PRIVACY: guest mode mein account ka session/token/workspace bilkul
    // nahi rehna chahiye. Pehle session wipe karo (saveSession(null) memory +
    // realtime bhi saaf karta hai), phir guest store — warna visibilitychange
    // → liveReload account ka hisaab guest view mein le aata tha.
    saveSession(null);
    currentWorkspaceId = "";
    workspaces = [];
    teardownRealtime();
    guestMode = true;
    loadGuestIntoState();
    saveGuestStore(); // pehli dafa: guest id persist ho jaye taake reload par wahi rahe
    showApp();
    renderAll();
    runRecurringDue(); // v87: guest boot par bhi due rules ke local record banein
    maybeShowPinLock(); // v78: PIN set ho to boot par lock screen
  }
  // v24.1: reload par bhi seedha guest mode (saved hisaab ho ya naya) —
  // enterGuestMode() saved store ho to wahi load karta hai, warna naya
  // guest id banata hai. Login screen sirf navbar icon se khulti hai.
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
  function loadOutbox() {
    try {
      var raw = window.localStorage.getItem(OUTBOX_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveOutbox(ops) {
    try {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops || []));
      renderOffline();
      return true;
    } catch (e) {
      try { console.error("Easy Khata: offline queue could not be saved", e); } catch (e2) {}
      setTxnMsg("Phone mein jagah kam hai. Kuch space khaali karke dobara try karein.", false);
      renderOffline();
      return false;
    }
  }
  function queueOp(op) {
    var ops = loadOutbox();
    // Do not silently cap/drop old ledger operations. Browser storage quota
    // errors are surfaced by saveOutbox and existing queue contents stay intact.
    ops.push(op);
    return saveOutbox(ops);
  }
  function saveCache() {
    if (guestMode || !profiles || !profiles.length || !currentWorkspaceId) return;
    try {
      var fullAt = txnFullSyncAt;
      if (!fullAt) { var prev = loadCache(currentWorkspaceId); if (prev && prev.txnFullSyncAt) fullAt = prev.txnFullSyncAt; }
      var payload = {
        profiles: profiles, txns: txns, contacts: myContacts, notifs: notifs,
        workspaces: workspaces, hidden: Object.keys(hiddenTxnIds), workspaceId: currentWorkspaceId, savedAt: Date.now(), txnFullSyncAt: fullAt || 0,
        recurring: recurringRules
      };
      window.localStorage.setItem(workspaceCacheKey(currentWorkspaceId), JSON.stringify(payload));
      window.localStorage.setItem(ACTIVE_WS_KEY, currentWorkspaceId);
      // v75: legacy CACHE_KEY par dobara NAHI likhte — sirf parhte hain
      // (loadCache fallback, one-time migration). Har save par poora payload
      // 3 dafa stringify karna bekaar tha; ab 1 dafa.
    } catch (e) {
      try { console.warn("Easy Khata: workspace cache could not be saved", e); } catch (e2) {}
    }
  }
  function loadCache(workspaceId) {
    try {
      var wanted = workspaceId || window.localStorage.getItem(ACTIVE_WS_KEY) || "";
      var raw = wanted ? window.localStorage.getItem(workspaceCacheKey(wanted)) : null;
      if (!raw) raw = window.localStorage.getItem(CACHE_KEY); // legacy cache migration
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !Array.isArray(c.profiles) || !Array.isArray(c.txns)) return null;
      if (wanted && c.workspaceId && c.workspaceId !== wanted) return null;
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


  // v86: PIN jaisay multi-step flows mein dialog BLINK na kare — aik hi
  // dialog reuse hota hai (stayOpen): OK par band nahi hota, agla step usi
  // overlay mein content badal deta hai. Overlay steps ke darmiyan kabhi
  // hidden nahi hota, is liye na backdrop jhapakta hai, na keyboard girta
  // hai, na entrance animation dobara chalti hai.
  var appDialogCurrent = null; // khule hue dialog ke listeners (reuse par hatane ke liye)
  function shakeAppDialog() {
    var card = null;
    var a = document.querySelector("#appDialogOverlay .app-dialog");
    var p = document.querySelector("#pinLockOverlay .app-dialog");
    if (a && !$("appDialogOverlay").hidden) card = a;
    else if (p && !$("pinLockOverlay").hidden) card = p;
    else card = a || p;
    if (!card) return;
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    setTimeout(function () { card.classList.remove("shake"); }, 450);
  }
  function appDialog(message,opts){opts=opts||{};return new Promise(function(resolve){var overlay=$("appDialogOverlay"),title=$("appDialogTitle"),body=$("appDialogMessage"),input=$("appDialogInput"),cancel=$("appDialogCancel"),ok=$("appDialogOk");if(!overlay){resolve(opts.mode==="prompt"?null:false);return;}
    // Pichla stayOpen dialog abhi khula ho to us ke listeners hatao (us ka
    // promise pehle hi resolve ho chuka) — overlay band kiye baghair.
    if(appDialogCurrent){var prev=appDialogCurrent;appDialogCurrent=null;cancel.removeEventListener("click",prev.onCancel);ok.removeEventListener("click",prev.onOk);overlay.removeEventListener("click",prev.onBackdrop);document.removeEventListener("keydown",prev.onKey);if(prev.onInput)input.removeEventListener("input",prev.onInput);}
    title.textContent=opts.title||"Easy Khata";body.textContent=String(message||"");input.hidden=opts.mode!=="prompt";input.value=opts.value==null?"":String(opts.value);input.placeholder=opts.placeholder||"";input.type=opts.inputType||"text";input.inputMode=opts.inputmode||"";input.maxLength=opts.maxlength?opts.maxlength:524288;
    input.autocomplete=opts.autocomplete||"off";cancel.hidden=opts.mode==="notice";cancel.textContent=opts.cancelText||"Cancel";ok.textContent=opts.okText||(opts.mode==="notice"?"OK":opts.mode==="prompt"?"Save":"Continue");overlay.hidden=false;document.body.classList.add("dialog-open");var settled=false;
    function teardown(){if(!appDialogCurrent)return;var cur=appDialogCurrent;appDialogCurrent=null;cancel.removeEventListener("click",cur.onCancel);ok.removeEventListener("click",cur.onOk);overlay.removeEventListener("click",cur.onBackdrop);document.removeEventListener("keydown",cur.onKey);if(cur.onInput)input.removeEventListener("input",cur.onInput);}
    function finish(value){if(settled)return;settled=true;overlay.hidden=true;document.body.classList.remove("dialog-open");teardown();resolve(value);}
    function onCancel(){finish(opts.mode==="prompt"?null:false);}
    function onOk(){var v=opts.mode==="prompt"?input.value:true;if(opts.stayOpen){resolve(v);return;}finish(v);}
    function onBackdrop(e){if(e.target===overlay&&opts.dismissible!==false)onCancel();}
    function onKey(e){if(e.key==="Escape"&&opts.dismissible!==false)onCancel();if(e.key==="Enter"&&opts.mode==="prompt"&&document.activeElement===input){e.preventDefault();onOk();}}
    var onInput=null;
    if(opts.autoSubmitLength&&opts.mode==="prompt"){onInput=function(){if((input.value||"").length>=opts.autoSubmitLength)onOk();};input.addEventListener("input",onInput);}
    appDialogCurrent={onOk:onOk,onCancel:onCancel,onBackdrop:onBackdrop,onKey:onKey,onInput:onInput};
    cancel.addEventListener("click",onCancel);ok.addEventListener("click",onOk);overlay.addEventListener("click",onBackdrop);document.addEventListener("keydown",onKey);setTimeout(function(){(opts.mode==="prompt"?input:ok).focus();},30);});}
  function appConfirm(message,opts){return appDialog(message,Object.assign({mode:"confirm",title:"Confirm action"},opts||{}));}
  function appPrompt(message,value,opts){return appDialog(message,Object.assign({mode:"prompt",title:"Enter details",value:value},opts||{}));}

  function profileName(id) {
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === id) return profiles[i].name || profiles[i].email || "Unknown";
    }
    for (var j = 0; j < myContacts.length; j++) {
      if (myContacts[j].id === id) return myContacts[j].name || "Unknown";
    }
    return id === myId() ? myName() : "Naam nahi mila";
  }

  function partyNameMarkup(id) {
    var name = "";
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === id) { name = profiles[i].name || profiles[i].email || ""; break; }
    }
    if (!name) {
      for (var j = 0; j < myContacts.length; j++) {
        if (myContacts[j].id === id) { name = myContacts[j].name || ""; break; }
      }
    }
    if (!name && id === myId()) name = myName();
    return name ? esc(name) : '<button class="btn-danger" type="button" data-missing-name="' + esc(id) + '">Naam set karein</button>';
  }
  async function saveMissingPartyName(id) {
    if (!id || !myId()) return;
    var name = await appPrompt("Is record mein is shakhs ka asal naam likhein:", "", {title:"Contact name"});
    if (name === null) return;
    name = name.trim();
    if (!name) { setTxnMsg("Naam khali nahi ho sakta.", false); return; }
    if (name.length > 80) { setTxnMsg("Naam 80 haroof se chhota rakhein.", false); return; }
    var contact = { id: id, owner_id: myId(), workspace_id: currentWorkspaceId, name: name, phone: null, manual: true, created_at: new Date().toISOString() };
    if (guestMode) {
      myContacts = myContacts.filter(function (x) { return x.id !== id; });
      myContacts.push(contact);
      saveGuestStore();
      renderAll();
      setTxnMsg("Naam save ho gaya — ab har record mein yehi naam nazar aayega.", true);
      return;
    }
    function applyName() {
      myContacts = myContacts.filter(function (x) { return x.id !== id; });
      myContacts.push(contact);
      saveCache();
      renderAll();
      setTxnMsg("Naam save ho gaya — ab har record mein yehi naam nazar aayega.", true);
    }
    sb("khata_contacts", { method: "POST", prefer: "return=minimal", body: { id: id, owner_id: myId(), workspace_id: currentWorkspaceId, name: name, phone: null } })
      .then(function (res) {
        if (!res.ok) { setTxnMsg("Naam save nahi hua. Dobara try karein.", false); return; }
        applyName();
      }).catch(function () { setTxnMsg("Naam save nahi hua — internet check karein.", false); });
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
      // v24.4: avatar_url bhi map karo — warna DOST list mein pic kabhi nahi
      // dikhti (peopleMap avatar_url drop kar deta tha, is liye renderPeople
      // ko hamesha undefined milta tha aur sirf initials dikhte the).
      if (p.id !== me) map[p.id] = { name: p.name || p.email, phone: p.phone || "", avatar_url: p.avatar_url || null, givenMinor: 0, takenMinor: 0, given: 0, taken: 0, net: 0, first: null, last: null };
    });
    myContacts.forEach(function (c) {
      map[c.id] = { name: c.name || "Unknown", phone: c.phone || "", givenMinor: 0, takenMinor: 0, given: 0, taken: 0, net: 0, manual: true, first: null, last: null };
    });
    function bump(p, d) {
      if (!d) return;
      if (!p.first || d < p.first) p.first = d;
      if (!p.last || d > p.last) p.last = d;
    }
    balanceTxns().forEach(function (t) {
      var a = moneyToMinor(t.amount);
      var d = String(t.txn_date || "");
      if (t.payer_id === me && map[t.receiver_id]) { map[t.receiver_id].givenMinor += a; bump(map[t.receiver_id], d); }
      if (t.receiver_id === me && map[t.payer_id]) { map[t.payer_id].takenMinor += a; bump(map[t.payer_id], d); }
    });
    Object.keys(map).forEach(function (id) {
      map[id].given = moneyFromMinor(map[id].givenMinor);
      map[id].taken = moneyFromMinor(map[id].takenMinor);
      map[id].net = moneyFromMinor(map[id].givenMinor - map[id].takenMinor);
    });
    return map;
  }
  function personTxns(id) {
    // This person's records, newest first (txns are already sorted desc).
    return visibleTxns().filter(function (t) { return t.payer_id === id || t.receiver_id === id; });
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
    if ($("signupCommunityBox")) $("signupCommunityBox").hidden = authMode !== "signup";
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
    // v24 SECURITY: login screen par aate hi guest/logged-in state bilkul
    // alag ho jati hai — in-memory data saaf, taake guest ka hisaab kabhi
    // logged-in session mein na dikhe aur vice versa. Guest store
    // (localStorage key) mehfooz rehta hai — sirf memory saaf hoti hai.
    guestMode = false;
    guestMeId = "";
    guestMeName = "Aap";
    profiles = [];
    txns = [];
    myContacts = [];
    notifs = [];
    hideSplash();
    teardownRealtime();
    if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
    // v24.7: auth page par na bottom nav hota hai na footer — footer sirf
    // Account view ke andar dikhta hai (in-flow, showView toggle karta hai).
    // Logout/boot par icon badge bhi clear (koi user nahi = koi unread nahi).
    document.body.classList.remove("has-nav");
    clearAppBadgeNow();
    var vf0 = $("versionFooter");
    if (vf0) vf0.hidden = true;
    $("authWrap").hidden = false;
    $("appShell").hidden = true;
    $("authBox").hidden = false;
    $("fabAdd").hidden = true;
    $("notifBtn").hidden = false;
    $("authForm").hidden = false;
    $("forgotBox").hidden = true;
    $("resetBox").hidden = true;
    renderAuthMode();
  }
  function showApp() {
    hideSplash();
    // v24.4: app screens par bottom nav dikhta hai (body.has-nav lagao).
    // Footer sirf Account view par dikhta hai — showView("khata") use chhupata
    // hai; Account kholte hi showView use dikhata hai.
    document.body.classList.add("has-nav");
    $("authWrap").hidden = true;
    $("appShell").hidden = false;
    // v24: guest mode mein notification bell nahi (koi push/notifs nahi).
    // v24.1: bada banner hata diya — header mein chhota Guest badge dikhta hai (renderAccount).
    $("notifBtn").hidden = guestMode;
    renderAccount();
    renderWorkspaceBar();
    showView("khata");
    $("txnDate").value = todayLocal();
    if (!guestMode) { var communityLinkName=""; try { communityLinkName=new URLSearchParams(window.location.search).get("community")||""; } catch(e) {} if (communityLinkName) setTimeout(function(){ if(session&&!guestMode){openCommunityModal("join");$("joinCommunityUsername").value=communityLinkName.toLowerCase();} },700); }
    if (guestMode) return; // v24: guest mode — no notifs, no push, no realtime, no timer
    notifFirstLoad = true;
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
    if ($("hiddenView")) $("hiddenView").hidden = name !== "hidden";
    if ($("backupView")) $("backupView").hidden = name !== "backup";
    if ($("recurringView")) $("recurringView").hidden = name !== "recurring";
    $("navKhata").classList.toggle("active", name === "khata" || name === "detail");
    $("navAccount").classList.toggle("active", name === "account" || name === "admin" || name === "adminUser" || name === "hidden" || name === "backup" || name === "recurring");
    $("fabAdd").hidden = name !== "khata";
    // v24.7: footer SIRF Account (settings) page par — ab in-flow hai
    // (Account view ke aakhir mein, Diesel Converter ki tarah), is liye
    // baaki views par sirf hidden karna kaafi hai (koi fixed bar nahi).
    var vf = $("versionFooter");
    if (vf) vf.hidden = name !== "account";
    if (name === "hidden") renderHiddenTxns();
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
    if (/password/i.test(m) && /short|least|8/i.test(m)) return "Password kam se kam 8 harf ka ho.";
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

  function communityOnboardingKey(email) {
    return "easykhata_community_onboarding_v1_" + String(email || "").trim().toLowerCase();
  }
  var signupCommunityIntentMemory = null;
  function signupCommunityIntentKey(email) { return "easykhata_signup_community_intent_v1_" + String(email||"").trim().toLowerCase(); }
  function saveSignupCommunityIntent(intent, username) {
    signupCommunityIntentMemory = {intent:intent,username:username||""};
    try { window.localStorage.setItem(signupCommunityIntentKey($("authEmail").value), JSON.stringify(signupCommunityIntentMemory)); } catch(e) {}
  }
  function openPendingCommunityOnboarding() {
    var email=(session&&session.user&&session.user.email)||"";
    var shouldOpen=false, intent=null;
    try {
      if(window.localStorage.getItem(communityOnboardingKey(email))) {
        shouldOpen=true;
        window.localStorage.removeItem(communityOnboardingKey(email));
      }
      if(shouldOpen) {
        intent=JSON.parse(window.localStorage.getItem(signupCommunityIntentKey(email))||"null");
        window.localStorage.removeItem(signupCommunityIntentKey(email));
      }
    } catch(e) {}
    if(!shouldOpen)return;
    setTimeout(function(){
      if(!session||guestMode)return;
      var tab=intent&&intent.intent==="create"?"create":"join";
      openCommunityModal(tab);
      if(tab==="join"&&intent&&intent.username) $("joinCommunityUsername").value=String(intent.username).toLowerCase();
    },900);
  }
  function loadSignupCommunityDirectory(search) {
    var list=$("signupCommunityDirectory"); if(!list)return;
    list.innerHTML='<p class="muted">Communities load ho rahi hain…</p>';
    sb("rpc/khata_list_communities",{method:"POST",body:{p_search:search||""}}).then(function(res){
      if(!res.ok)throw new Error("directory");
      var rows=Array.isArray(res.body)?res.body:[];
      list.innerHTML="";
      if(!rows.length){var empty=document.createElement("p");empty.className="community-empty";empty.textContent="Koi public community nahi mili. Aap apni community create kar sakte hain.";list.appendChild(empty);return;}
      rows.forEach(function(w){
        var card=document.createElement("article");card.className="community-card";
        var title=document.createElement("strong");title.textContent=w.community_name;
        var handle=document.createElement("span");handle.className="community-handle";handle.textContent="@"+w.community_username;
        var meta=document.createElement("small");meta.textContent=(w.member_count||0)+" members"+(w.description?" · "+w.description:"");
        var pick=document.createElement("button");pick.type="button";pick.className="btn btn-primary community-join-pick";pick.textContent="Select community";
        pick.addEventListener("click",function(){
          saveSignupCommunityIntent("join",w.community_username);
          $("signupCommunityChoice").textContent="Community select ho gayi: "+w.community_name+" (@"+w.community_username+"). Account banane ke baad password darj karke join request bhej dein.";
          $("signupCommunityChoice").className="msg ok";
          $("signupCommunityChoice").className="msg ok";
        });
        card.appendChild(title);card.appendChild(handle);card.appendChild(meta);card.appendChild(pick);list.appendChild(card);
      });
    }).catch(function(){list.innerHTML='<p class="community-empty">Community list nahi khul saki. Internet check karke dobara try karein.</p>';});
  }

  function afterAuth(res, isSignup) {
    var body = res.body || {};
    if (!body.access_token) {
      var pendingUser = body.user || (body.id && body.email ? body : null);
      if (pendingUser) {
        if (isSignup) {
          try { window.localStorage.setItem(communityOnboardingKey(pendingUser.email), "1"); } catch(e) {}
        }
        setAuthMsg("Account ban gaya! Email mein bheja gaya confirmation link khol kar account confirm karein, phir login karein. Us ke baad aap apna hisaab shuru kar sakte hain ya community bana/join kar sakte hain.", true);
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
      maybeOfferGuestMigration();
      if(isSignup) {
        try { window.localStorage.setItem(communityOnboardingKey(email), "1"); } catch(e) {}
      }
      openPendingCommunityOnboarding();
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
    // v79 (#7): server (Supabase Auth) ab kam se kam 8 harf mangta hai.
    // Sirf SIGNUP par 8 check karo — login par nahi, warna purane 6-7 harf
    // wale password se login band ho jayega (server login par length nahi
    // check karta, sirf signup/change par).
    if (authMode === "signup" && password.length < 8) { setAuthMsg("Password kam se kam 8 harf ka ho.", false); return; }
    var btn = $("authSubmitBtn");
    var isSignup = authMode === "signup";
    if(isSignup){try{if(signupCommunityIntentMemory)window.localStorage.setItem(signupCommunityIntentKey(email),JSON.stringify(signupCommunityIntentMemory));var pendingIntent=window.localStorage.getItem(signupCommunityIntentKey(email));if(!pendingIntent)saveSignupCommunityIntent("join","");}catch(e){}}
    btn.disabled = true;
    var p = isSignup
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
      afterAuth(res, isSignup);
    }).catch(function () {
      btn.disabled = false;
      setAuthMsg("Internet connection nahi mil raha. Dobara koshish karein.", false);
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
        setForgotMsg("Internet connection nahi mil raha. Dobara koshish karein.", false);
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
    if (!p1 || p1.length < 8) { setPassMsg("Password kam se kam 8 harf ka ho.", false); return; }
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
      setPassMsg("Internet connection nahi mil raha. Dobara koshish karein.", false);
    });
  }
  function doReset() {
    var p1 = $("resetPassword").value;
    var p2 = $("resetPassword2").value;
    if (!p1 || p1.length < 8) { setResetMsg("Password kam se kam 8 harf ka ho.", false); return; }
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
      setResetMsg("Internet connection nahi mil raha. Dobara koshish karein.", false);
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
    if (!session || !session.access_token) {
      // v24.1: koi login session nahi to app seedha guest dashboard kholta
      // hai — login screen pehle nahi dikhti. Login/Sign-up navbar ke
      // login icon se khulta hai.
      enterGuestMode();
      return;
    }
    fetchWithTimeout(API + "/auth/v1/user", {
      headers: { "apikey": ANON, "Authorization": "Bearer " + session.access_token }
    }, 8000).then(function (r) {
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
      maybeShowPinLock(); // v78: purani session restore — PIN set ho to lock screen
      openPendingCommunityOnboarding(); // signup email confirmation ke baad bhi community setup khule
      // v74: refresh par dobara offer NAHI — sirf login/signup ke waqt (afterAuth).
    }).catch(function (e) {
      // v24.8: network fail (offline) session EXPIRE nahi hota — sirf
      // "expired" (401 / refresh fail) par session wipe + guest. Offline
      // ho aur cache ho to apna hisaab cache se dikhao (loadAll khud cache
      // fallback karta hai); cache na ho to hi guest fallback.
      if (e && e.message === "expired") {
        saveSession(null);
        enterGuestMode();
        return;
      }
      if (session && session.access_token && loadCache()) {
        showApp();
        loadAll();
        maybeShowPinLock(); // v78: offline cache boot — PIN set ho to lock screen
        return;
      }
      saveSession(null);
      // v24.1: session expire/invalid bhi guest dashboard par le jata hai
      // (login screen nahi) — dobara login navbar ke Login icon se hota hai.
      enterGuestMode();
    });
  }

  /* ---------- data ---------- */
  function tableMissing(res) {
    if (res.status === 404) return true;
    var code = res.body && res.body.code;
    return code === "PGRST205" || code === "42P01";
  }

  function profilesQuery(withPhone) {
    // v24.4: avatar_url + username bhi load karo. Root cause (live DB se sabit):
    // save PATCH avatar_url likhta tha aur Storage upload bhi hota tha, lekin
    // ye SELECT columns hi nahi mangta tha — refresh ke baad me.avatar_url
    // undefined hota tha aur pic gayab ho jati thi (sirf initials dikhte the).
    return sb("khata_profiles?select=id,name,email,created_at,avatar_url,username,active_workspace_id" + (withPhone ? ",phone" : "") + "&order=name.asc");
  }

  function renderWorkspaceBar() {
    var bar=$("workspaceBar"); if(!bar)return;
    bar.hidden=guestMode||!session; if(bar.hidden)return;
    var sel=$("workspaceSelect"), active=null; sel.innerHTML="";
    workspaces.forEach(function(w){var o=document.createElement("option");o.value=w.id;o.textContent=(w.type==="personal"?"Personal · ":"Business · ")+w.name;o.setAttribute("data-ic",w.type==="business"?"🏢":"👤");sel.appendChild(o);if(w.id===currentWorkspaceId)active=w;});
    sel.value=currentWorkspaceId;
    cdSync(sel); // v73: custom dropdown ka label + menu fresh karo
    // v70: bar icon follows the active workspace — business 🏢, personal 👤.
    var ic=$("workspaceIcon"); if(ic)ic.textContent=active&&active.type==="business"?"🏢":"👤";
    closeWorkspaceMenu();
    $("workspaceInviteBtn").hidden=!active||active.type!=="business";
    $("workspaceMembersBtn").hidden=!active||active.type!=="business";
    $("workspaceSetupBtn").hidden=!active||active.type!=="business"||active.community_listed||active.current_role!=="owner";
  }
  /* ---------- Workspace menu (v70) ---------- */
  // Bar par sirf switcher + ⋯ dikhta hai; baaki community actions menu ke
  // andar hain (page ke andar, aik tap door). Buttons ki ids/handlers wahi
  // hain — sirf markup badla hai, is liye koi binding nahi badli.
  function openWorkspaceMenu(){var m=$("workspaceMenu");if(!m)return;m.hidden=false;$("workspaceMenuBtn").setAttribute("aria-expanded","true");}
  function closeWorkspaceMenu(){var m=$("workspaceMenu");if(!m||m.hidden)return;m.hidden=true;$("workspaceMenuBtn").setAttribute("aria-expanded","false");}
  function toggleWorkspaceMenu(){$("workspaceMenu").hidden?openWorkspaceMenu():closeWorkspaceMenu();}
  /* ---------- Custom dropdowns (v73) ----------
     Native <select> ka popup OS ka hota hai — dark, app design se bilkul
     alag (screenshot mein workspace switcher aisa hi dikh raha tha). Is liye
     har select ke saath aik custom button + menu lagta hai; asli select
     chhupa rehta hai aur STATE STORE ka kaam karta hai — us ki value aur
     change handlers sab waisay hi chalte hain, is liye purani logic mein
     koi tabdeeli nahi. Menu share-sheet wale radio style mein hai. */
  function cdItemHtml(opt, currentValue) {
    var active = opt.value === currentValue;
    var ic = opt.getAttribute("data-ic") || "";
    return '<button type="button" class="cd-item' + (active ? " is-active" : "") + '" role="option" aria-selected="' + active + '" data-value="' + esc(opt.value) + '">' +
      (ic ? '<span class="cd-item-ic" aria-hidden="true">' + esc(ic) + '</span>' : "") +
      '<span class="cd-item-label">' + esc(opt.textContent) + '</span>' +
      '<span class="cd-radio" aria-hidden="true"></span></button>';
  }
  function cdSync(sel) {
    if (!sel) return;
    var wrap = sel.parentElement;
    if (!wrap || !wrap.classList.contains("cd-wrap")) return;
    var btn = wrap.querySelector(".cd-btn"), menu = wrap.querySelector(".cd-menu");
    if (!btn || !menu) return;
    btn.disabled = !!sel.disabled;
    var label = sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "";
    btn.querySelector(".cd-btn-label").textContent = label || "";
    var html = "";
    Array.prototype.forEach.call(sel.childNodes, function (node) {
      if (node.tagName === "OPTGROUP") {
        html += '<div class="cd-group">' + esc(node.label || "") + '</div>';
        Array.prototype.forEach.call(node.childNodes, function (o) { if (o.tagName === "OPTION") html += cdItemHtml(o, sel.value); });
      } else if (node.tagName === "OPTION") {
        html += cdItemHtml(node, sel.value);
      }
    });
    menu.innerHTML = html || '<div class="cd-empty">Koi option nahi</div>';
  }
  function cdCloseAll() {
    document.querySelectorAll(".cd-menu").forEach(function (m) { m.hidden = true; });
    document.querySelectorAll(".cd-btn").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  // v86: menu position:fixed hai — button ke viewport rect se lagta hai,
  // is liye scrolling modal/list ke andar bhi cut nahi hota. Neeche jagah na
  // ho to upar khulta hai; dayein kinare se bahar nahi jata. jsdom mein
  // measurements 0 hote hain — wahan fallback (left/top button rect se).
  function cdPositionMenu(sel) {
    var wrap = sel.parentElement;
    if (!wrap || !wrap.classList.contains("cd-wrap")) return;
    var menu = wrap.querySelector(".cd-menu"), btn = wrap.querySelector(".cd-btn");
    if (!menu || !btn) return;
    var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, top: 0, bottom: 0, width: 0 };
    var vw = window.innerWidth || document.documentElement.clientWidth || 360;
    var vh = window.innerHeight || document.documentElement.clientHeight || 640;
    menu.style.visibility = "hidden";
    menu.style.minWidth = Math.min(Math.max(180, r.width || 0), Math.max(180, vw - 16)) + "px";
    menu.style.left = "0px";
    menu.style.top = "0px";
    var mw = menu.offsetWidth || 0, mh = menu.offsetHeight || 0;
    var left = r.left || 0;
    if (mw > 0) left = Math.max(8, Math.min(left, vw - mw - 8));
    var top = (r.bottom || 0) + 6;
    if (mh > 0 && top + mh > vh - 8 && (r.top || 0) - 6 - mh >= 8) top = (r.top || 0) - 6 - mh;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.visibility = "";
  }
  function cdToggle(sel) {
    if (!sel) return;
    var wrap = sel.parentElement;
    if (!wrap || !wrap.classList.contains("cd-wrap")) return;
    var menu = wrap.querySelector(".cd-menu"), btn = wrap.querySelector(".cd-btn");
    if (!menu || !btn || sel.disabled) return;
    var willOpen = menu.hidden;
    cdCloseAll();
    closeWorkspaceMenu();
    if (willOpen) { cdSync(sel); menu.hidden = false; btn.setAttribute("aria-expanded", "true"); cdPositionMenu(sel); }
  }
  function cdPick(sel, value) {
    if (!sel) return;
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    cdSync(sel);
    cdCloseAll();
  }
  function cdAttach(sel) {
    if (!sel || sel.dataset.cdAttached) return;
    if (sel.hasAttribute("data-native")) return; // v84: native select — custom dropdown nahi
    sel.dataset.cdAttached = "1";
    sel.classList.add("cd-native");
    var wrap = document.createElement("div");
    wrap.className = "cd-wrap";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cd-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="cd-btn-label"></span><span class="cd-chevron" aria-hidden="true">⌄</span>';
    var menu = document.createElement("div");
    menu.className = "cd-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    // Label (agar select se jura ho) ab button ki taraf ishara kare.
    try { var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab && sel.id) { btn.id = "cdBtn-" + sel.id; lab.htmlFor = btn.id; } } catch (e) {}
    sel.addEventListener("change", function () { cdSync(sel); }); // v86: programmatic set par bhi label taaza
    btn.addEventListener("click", function (e) { e.stopPropagation(); cdToggle(sel); });
    menu.addEventListener("click", function (e) {
      var item = e.target.closest ? e.target.closest(".cd-item") : null;
      if (!item) return;
      cdPick(sel, item.getAttribute("data-value"));
    });
    cdSync(sel);
  }
  function cdAttachStatic() {
    ["workspaceSelect", "txnPerson", "txnFilterPerson", "adminUserStatus", "adminUserSort", "adminCommunityStatus", "adminMemberCommunityFilter", "workspaceInviteRole", "txnRepeatFreq", "txnRepeatDay"].forEach(function (id) {
      var sel = $(id);
      if (sel) cdAttach(sel);
    });
  }
  function cdAttachIn(container) {
    if (!container) return;
    container.querySelectorAll("select").forEach(function (sel) { cdAttach(sel); });
  }
  function loadWorkspaces(){
    return sb("khata_workspaces?select=id,name,type,created_by,status,community_username,community_listed&status=eq.active&order=created_at.asc").then(function(res){
      if(!res.ok)throw new Error("workspaces load failed");
      workspaces=Array.isArray(res.body)?res.body:[];
      if(!workspaces.some(function(w){return w.id===currentWorkspaceId;}))throw new Error("active workspace inaccessible");
      return sb("khata_workspace_members?select=workspace_id,role&user_id=eq."+encodeURIComponent(myId())+"&status=eq.active").then(function(mr){
        var roles=mr.ok&&Array.isArray(mr.body)?mr.body:[];
        workspaces.forEach(function(w){var m=roles.filter(function(x){return x.workspace_id===w.id;})[0];w.current_role=m?m.role:""});
        renderWorkspaceBar();return workspaces;
      });
    });
  }
  function switchWorkspace(id){
    if(!id||id===currentWorkspaceId)return;
    // Pin pre-tenant legacy queued inserts to the workspace they were created in
    // before switching. New operations already carry workspace_id.
    var pendingOps=loadOutbox(),pinned=false;
    pendingOps.forEach(function(op){
      if(op.body&&!op.body.workspace_id&&(op.table==="khata_transactions"||op.table==="khata_contacts")&&currentWorkspaceId){
        op.body.workspace_id=currentWorkspaceId;pinned=true;
      }
    });
    if(pinned)saveOutbox(pendingOps);
    $("workspaceSelect").disabled=true;
    cdSync($("workspaceSelect")); // v73: custom button bhi disabled dikhe
    sb("rpc/khata_set_active_workspace",{method:"POST",body:{p_workspace_id:id}}).then(function(res){
      $("workspaceSelect").disabled=false;
      if(!res.ok){setTxnMsg("Community change nahi ho saki. Dobara koshish karein.",false);renderWorkspaceBar();return;}
      currentWorkspaceId=id;
      try { window.localStorage.setItem(ACTIVE_WS_KEY,id); } catch(e) {}
      profiles=[];txns=[];myContacts=[];hiddenTxnIds={};teardownRealtime();loadAll();
    }).catch(function(){$("workspaceSelect").disabled=false;renderWorkspaceBar();setTxnMsg("Community change nahi ho saki. Internet check karke dobara koshish karein.",false);});
  }
  function createBusinessWorkspace(){ openCommunityModal("create"); }
  function openCommunityModal(tab){
    var modal=$("communityOverlay");if(!modal)return;
    modal.hidden=false;
    ["create","join","setup"].forEach(function(k){$("communityPanel"+k.charAt(0).toUpperCase()+k.slice(1)).hidden=(k!==tab);});
    $("communityTabCreate").classList.toggle("active",tab==="create");
    $("communityTabJoin").classList.toggle("active",tab==="join");
    $("communityModalTitle").textContent=tab==="create"?"Create a business community":tab==="setup"?"Secure your community":"Explore communities";
    if(tab==="join"){loadCommunityDirectory("");var linkedUsername="";try{linkedUsername=new URLSearchParams(window.location.search).get("community")||"";}catch(e){}if(linkedUsername) $("joinCommunityUsername").value=linkedUsername.toLowerCase();}
    if(tab==="setup"){
      var active=workspaces.filter(function(w){return w.id===currentWorkspaceId;})[0];
      $("communitySetupUsername").textContent=active&&active.community_username?"@"+active.community_username:"Username not set";
    }
  }
  function closeCommunityModal(){ $("communityOverlay").hidden=true; }
  function showCommunityMessage(msg,ok){
    var el=$("communityMsg");el.textContent=msg;el.className="msg "+(ok?"success":"error");el.hidden=false;
  }
  function loadCommunityDirectory(search){
    var list=$("communityDirectory");list.innerHTML='<p class="muted">Communities load ho rahi hain…</p>';
    sb("rpc/khata_list_communities",{method:"POST",body:{p_search:search||""}}).then(function(res){
      if(!res.ok)throw new Error("directory");
      var rows=Array.isArray(res.body)?res.body:[];
      list.innerHTML="";
      if(!rows.length){var empty=document.createElement("p");empty.className="community-empty";empty.textContent="Abhi koi public community nahi mili. Username se search karein.";list.appendChild(empty);return;}
      rows.forEach(function(w){
        var card=document.createElement("article");card.className="community-card";
        var title=document.createElement("strong");title.textContent=w.community_name;
        var handle=document.createElement("span");handle.className="community-handle";handle.textContent="@"+w.community_username;
        var meta=document.createElement("small");meta.textContent=(w.member_count||0)+" members"+(w.description?" · "+w.description:"");
        var btn=document.createElement("button");btn.type="button";btn.className="btn btn-primary community-join-pick";btn.textContent="Join request";
        btn.addEventListener("click",function(){
          $("joinCommunityUsername").value=w.community_username;
          $("joinCommunityPassword").focus();
          $("joinCommunityPassword").scrollIntoView({behavior:"smooth",block:"center"});
        });
        card.appendChild(title);card.appendChild(handle);card.appendChild(meta);card.appendChild(btn);list.appendChild(card);
      });
    }).catch(function(){list.innerHTML='<p class="community-empty">Community list load nahi hui. Internet check karein.</p>';});
  }
  function submitCommunityCreate(){
    var name=$("newCommunityName").value.trim(),username=$("newCommunityUsername").value.trim().toLowerCase(),password=$("newCommunityPassword").value,description=$("newCommunityDescription").value.trim();
    if(name.length<2||name.length>100){showCommunityMessage("Community name 2-100 characters ka hona chahiye.",false);return;}
    if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)){showCommunityMessage("Username 3-30 characters: a-z, 0-9, dot, underscore ya hyphen.",false);return;}
    if(password.length<10){showCommunityMessage("Password kam az kam 10 characters ka rakhein.",false);return;}
    $("communityCreateSubmit").disabled=true;
    sb("rpc/khata_create_business_community",{method:"POST",body:{p_name:name,p_username:username,p_password:password,p_description:description}}).then(function(res){
      $("communityCreateSubmit").disabled=false;
      if(!res.ok){showCommunityMessage((res.body&&res.body.message)||"Community create nahi hui. Username availability check karein.",false);return;}
      closeCommunityModal();$("newCommunityPassword").value="";currentWorkspaceId=(typeof res.body==="string"?res.body:(Array.isArray(res.body)?res.body[0]:res.body));
      if(currentWorkspaceId&&typeof currentWorkspaceId==="object")currentWorkspaceId=currentWorkspaceId.khata_create_business_community;
      teardownRealtime();loadAll();
      if(isAdmin()){
        setAdminMsg("Community create ho gayi. Admin community list refresh ho rahi hai…",true);
        loadAdminWorkspaceManagement();
      }
    }).catch(function(){$("communityCreateSubmit").disabled=false;showCommunityMessage("Community create nahi hui. Internet check karein.",false);});
  }
  function submitCommunityJoin(){
    var username=$("joinCommunityUsername").value.trim().toLowerCase(),password=$("joinCommunityPassword").value;
    if(!username||!password){showCommunityMessage("Community username aur password dono likhein.",false);return;}
    $("communityJoinSubmit").disabled=true;
    sb("rpc/khata_request_community_join",{method:"POST",body:{p_username:username,p_password:password}}).then(function(res){
      $("communityJoinSubmit").disabled=false;
      if(!res.ok){showCommunityMessage((res.body&&res.body.message)||"Username ya password sahi nahi.",false);return;}
      var status=Array.isArray(res.body)?res.body[0]:res.body;
      if(status&&typeof status==="object")status=status.khata_request_community_join;
      $("joinCommunityPassword").value="";
      showCommunityMessage(status==="already_member"?"Aap pehle se is community ke member hain.":status==="pending"?"Request owner ko bhej di gayi hai. Approval ke baad community aapki list mein aa jayegi.":"Join request submit ho gayi.",true);
    }).catch(function(){$("communityJoinSubmit").disabled=false;showCommunityMessage("Request submit nahi hui. Internet check karein.",false);});
  }
  function submitCommunityPassword(){
    var password=$("communitySetupPassword").value;
    if(password.length<10){showCommunityMessage("Password kam az kam 10 characters ka hona chahiye.",false);return;}
    $("communitySetupSubmit").disabled=true;
    sb("rpc/khata_set_community_password",{method:"POST",body:{p_workspace_id:currentWorkspaceId,p_password:password,p_listed:true}}).then(function(res){
      $("communitySetupSubmit").disabled=false;
      if(!res.ok){showCommunityMessage("Password save nahi hua. Sirf community owner change kar sakta hai.",false);return;}
      $("communitySetupPassword").value="";closeCommunityModal();loadAll();
    }).catch(function(){$("communitySetupSubmit").disabled=false;showCommunityMessage("Password save nahi hua.",false);});
  }
  function manageWorkspaceMembers(){
    if(!currentWorkspaceId)return;
    memberSearchQ="";var ms=$("workspaceMemberSearch");if(ms)ms.value="";
    var active=workspaces.filter(function(w){return w.id===currentWorkspaceId;})[0];
    var sub=$("membersModalSub");if(sub)sub.textContent=active?(active.name||"Community"):"";
    $("membersOverlay").hidden=false;
    loadCommunityJoinRequests();
    loadWorkspaceMemberCards();
  }
  function cmAvatar(name){
    var ch=String(name||"?").trim().charAt(0).toUpperCase()||"?";
    var el=document.createElement("span");el.className="cm-avatar";el.textContent=ch;return el;
  }
  function cmRoleChip(role){
    var r=String(role||"staff").toLowerCase();
    var label=r.charAt(0).toUpperCase()+r.slice(1);
    var el=document.createElement("span");el.className="cm-role-chip role-"+r;el.textContent=label;return el;
  }
  function loadCommunityJoinRequests(){
    var box=$("communityRequestsList");box.innerHTML='<p class="muted">Requests load ho rahi hain…</p>';
    var countEl=$("communityRequestsCount");if(countEl)countEl.textContent="";
    sb("rpc/khata_list_community_join_requests",{method:"POST",body:{p_workspace_id:currentWorkspaceId}}).then(function(res){
      if(!res.ok)throw new Error("requests");
      var rows=Array.isArray(res.body)?res.body:[];box.innerHTML="";
      if(countEl)countEl.textContent=rows.length?"("+rows.length+")":"";
      if(!rows.length){var p=document.createElement("p");p.className="community-empty";p.textContent="Koi pending join request nahi.";box.appendChild(p);return;}
      rows.forEach(function(r){
        var card=document.createElement("article");card.className="community-request-card";
        var top=document.createElement("div");top.className="cm-member-top";
        top.appendChild(cmAvatar(r.user_name||r.user_email));
        var main=document.createElement("div");main.className="cm-main";
        var who=document.createElement("strong");who.textContent=r.user_name||"New member";
        var email=document.createElement("small");email.textContent=r.user_email||"";
        main.appendChild(who);main.appendChild(email);top.appendChild(main);
        var chip=document.createElement("span");chip.className="cm-role-chip role-pending";chip.textContent="Pending";top.appendChild(chip);
        var actions=document.createElement("div");actions.className="community-request-actions";
        [["Approve",true],["Reject",false]].forEach(function(pair){
          var b=document.createElement("button");b.type="button";b.className="btn "+(pair[1]?"btn-primary":"btn-neutral");b.textContent=pair[0];
          b.addEventListener("click",function(){b.disabled=true;sb("rpc/khata_review_community_join_request",{method:"POST",body:{p_request_id:r.request_id,p_approve:pair[1]}}).then(function(out){if(!out.ok){b.disabled=false;setTxnMsg("Request update nahi hui.",false);return;}loadCommunityJoinRequests();loadWorkspaceMemberCards();});});
          actions.appendChild(b);
        });
        card.appendChild(top);card.appendChild(actions);box.appendChild(card);
      });
    }).catch(function(){box.innerHTML='<p class="community-empty">Requests load nahi ho sakin.</p>';});
  }
  function loadWorkspaceMemberCards(){
    var box=$("workspaceMemberCards");box.innerHTML='<p class="muted">Members load ho rahe hain…</p>';
    sb("khata_workspace_members?select=user_id,role,status,joined_at&workspace_id=eq."+encodeURIComponent(currentWorkspaceId)+"&status=eq.active&order=joined_at.asc").then(function(res){
      if(!res.ok)throw new Error("members");
      lastMemberRows=Array.isArray(res.body)?res.body:[];
      renderWorkspaceMemberCards(lastMemberRows);
    }).catch(function(){box.innerHTML='<p class="community-empty">Members load nahi ho sake.</p>';});
  }
  function renderWorkspaceMemberCards(rows){
    var box=$("workspaceMemberCards");if(!box)return;box.innerHTML="";
    var q=memberSearchQ.trim().toLowerCase();
    var shown=rows.filter(function(m){
      if(!q)return true;
      var p=profiles.filter(function(x){return x.id===m.user_id;})[0]||{};
      return [p.name,p.email,m.role].join(" ").toLowerCase().indexOf(q)!==-1;
    });
    var countEl=$("workspaceMemberCount");if(countEl)countEl.textContent="("+rows.length+")";
    var sub=$("membersModalSub");
    if(sub){var active=workspaces.filter(function(w){return w.id===currentWorkspaceId;})[0];if(active)sub.textContent=active.name+" · "+rows.length+" members";}
    if(!shown.length){
      var p=document.createElement("p");p.className="community-empty";
      p.textContent=q?"Koi member nahi mila — search badal kar dekhein.":"Abhi koi active member nahi.";
      box.appendChild(p);return;
    }
    var myRole=(workspaces.filter(function(w){return w.id===currentWorkspaceId;})[0]||{}).current_role;
    var canManage=["owner","admin"].indexOf(myRole)>=0;
    shown.forEach(function(m){
      var p=profiles.filter(function(x){return x.id===m.user_id;})[0]||{};
      var isSelf=m.user_id===myId();
      var isOwner=String(m.role||"").toLowerCase()==="owner";
      var card=document.createElement("article");card.className="community-member-card";
      var top=document.createElement("div");top.className="cm-member-top";
      top.appendChild(cmAvatar(p.name||p.email));
      var main=document.createElement("div");main.className="cm-main";
      var name=document.createElement("strong");name.textContent=(p.name||p.email||"Member")+(isSelf?" · You":"");
      var meta=document.createElement("small");meta.textContent=(p.email||"")+(m.joined_at?" · Joined "+fmtDate(m.joined_at):"");
      main.appendChild(name);main.appendChild(meta);top.appendChild(main);
      top.appendChild(cmRoleChip(m.role));
      card.appendChild(top);
      // v80: owner ka role/remove UI mein nahi — owner ko sirf owner badal sakta hai (server rule).
      // Apna card bhi action-free. Role picker CUSTOM hai (v86) — fixed-position
      // menu list ke andar overlap/truncate nahi karta; OS ka dark popup nahi.
      if(!isSelf&&!isOwner&&canManage){
        var actions=document.createElement("div");actions.className="cm-actions";
        var roleSelect=document.createElement("select");roleSelect.className="member-role-select";roleSelect.setAttribute("aria-label","Role for "+(p.name||p.email||"member"));
        ["admin","accountant","staff","viewer"].forEach(function(r){var op=document.createElement("option");op.value=r;op.textContent=r.charAt(0).toUpperCase()+r.slice(1);roleSelect.appendChild(op);});
        roleSelect.value=m.role;
        var saveRole=document.createElement("button");saveRole.type="button";saveRole.className="btn btn-neutral";saveRole.textContent="Save role";
        saveRole.addEventListener("click",function(){saveRole.disabled=true;sb("rpc/khata_set_workspace_member_role",{method:"POST",body:{p_workspace_id:currentWorkspaceId,p_user_id:m.user_id,p_role:roleSelect.value}}).then(function(out){saveRole.disabled=false;if(out.ok){setTxnMsg("Member role update ho gaya.",true);loadWorkspaceMemberCards();}else setTxnMsg("Role update nahi hua — owner/admin permission check karein.",false);});});
        var remove=document.createElement("button");remove.type="button";remove.className="btn btn-neutral";remove.textContent="Remove";
        remove.addEventListener("click",async function(){if(!(await appConfirm("Is member ka community access band karein? Purana hisaab mehfooz rahega.")))return;sb("rpc/khata_remove_workspace_member",{method:"POST",body:{p_workspace_id:currentWorkspaceId,p_user_id:m.user_id}}).then(function(out){if(out.ok)loadWorkspaceMemberCards();else setTxnMsg("Member remove nahi hua.",false);});});
        actions.appendChild(roleSelect);cdAttach(roleSelect);actions.appendChild(saveRole);actions.appendChild(remove);card.appendChild(actions);
      }
      box.appendChild(card);
    });
  }
  function inviteWorkspaceMember(){
    memberSearchQ="";var ms=$("workspaceMemberSearch");if(ms)ms.value="";
    $("membersOverlay").hidden=false;
    loadCommunityJoinRequests();loadWorkspaceMemberCards();
    $("workspaceInviteEmail").focus();
  }
  function copyCommunityJoinLink(){
    var active=workspaces.filter(function(w){return w.id===currentWorkspaceId;})[0];
    if(!active||active.type!=="business"||!active.community_username){setTxnMsg("Community username set nahi hai. Owner se setup complete karwayein.",false);return;}
    var link=window.location.origin+window.location.pathname+"?community="+encodeURIComponent(active.community_username);
    copyText(link).then(function(){setTxnMsg("Community join link copy ho gaya. Link khol kar username aur password se join request bheji ja sakti hai.",true);})
      .catch(function(){setTxnMsg("Community join link: "+link,true);});
  }
  function submitWorkspaceInvite(){
    if(!currentWorkspaceId||workspaceInviteBusy)return;
    var email=$("workspaceInviteEmail").value.trim(),role=$("workspaceInviteRole").value;
    if(!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)){setTxnMsg("Valid email address likhein.",false);return;}
    workspaceInviteBusy=true;$("workspaceInviteSubmit").disabled=true;
    sb("rpc/khata_create_workspace_invite",{method:"POST",body:{p_workspace_id:currentWorkspaceId,p_email:email,p_role:role}}).then(function(res){
      workspaceInviteBusy=false;$("workspaceInviteSubmit").disabled=false;
      if(!res.ok||!res.body){setTxnMsg("Invite create nahi hua. Owner/admin permission check karein.",false);return;}
      var token=typeof res.body==="string"?res.body:(Array.isArray(res.body)?res.body[0]:res.body);
      if(token&&typeof token==="object")token=token.khata_create_workspace_invite;
      var link=window.location.origin+window.location.pathname+"?invite="+encodeURIComponent(token);
      copyText(link).then(function(){setTxnMsg("7 din valid invite link copy ho gaya. Isay "+email+" ko bhej dein.",true);})
        .catch(function(){setTxnMsg("Invite bana. Link: "+link,true);});
      $("workspaceInviteEmail").value="";
    }).catch(function(){workspaceInviteBusy=false;$("workspaceInviteSubmit").disabled=false;setTxnMsg("Invite create nahi hua.",false);});
  }
  var inviteAccepting=false;
  function acceptInviteFromUrl(){
    if(inviteAccepting||!session||!session.access_token)return Promise.resolve(false);
    var token="";try{token=new URLSearchParams(window.location.search).get("invite")||"";}catch(e){}
    if(!token)return Promise.resolve(false);inviteAccepting=true;
    return sb("rpc/khata_accept_workspace_invite",{method:"POST",body:{p_token:token}}).then(function(res){
      inviteAccepting=false;if(!res.ok){setTxnMsg("Invite accept nahi hua. Email, login aur expiry check karein.",false);return false;}
      try{window.history.replaceState(null,"",window.location.pathname);}catch(e){}
      var id=typeof res.body==="string"?res.body:(Array.isArray(res.body)?res.body[0]:res.body);if(id&&typeof id==="object")id=id.khata_accept_workspace_invite;
      if(!id)return false;
      return sb("rpc/khata_set_active_workspace",{method:"POST",body:{p_workspace_id:id}}).then(function(sw){if(sw.ok)currentWorkspaceId=id;return sw.ok;});
    }).catch(function(){inviteAccepting=false;return false;});
  }

  // Outbox sync: pending ops ko order mein server par bhejein.
  // Settled-lock rejection = op drop karein (kabhi accept nahi hoga),
  // network error = ruk jayein (ops queued rahein, baad mein retry).
  function flushOutbox() {
    if (guestMode) return Promise.resolve(false); // v24: guest ka koi outbox nahi — kuch sync nahi hota
    if (syncing) return Promise.resolve(false);
    var ops = loadOutbox();
    // Older queued operations may not have a tenant id. Prefer the last saved
    // account cache workspace (the workspace in which the offline work began),
    // and only fall back to the current workspace for legacy installations.
    var legacyCache = loadCache();
    var legacyWorkspaceId = (legacyCache && legacyCache.workspaceId) || currentWorkspaceId;
    ops.forEach(function (o) {
      if (o.body && !o.body.workspace_id && (o.table === "khata_transactions" || o.table === "khata_contacts") && legacyWorkspaceId) {
        o.body.workspace_id = legacyWorkspaceId;
      }
    });
    // v24.11: purane version se queued khata_transactions delete ops — real
    // DELETE kabhi nahi bhejte; hide (khata_txn_hidden insert) mein badal dein.
    var converted = false;
    ops.forEach(function (o) {
      if (o.op === "delete" && o.table === "khata_transactions") {
        o.op = "insert"; o.table = "khata_txn_hidden";
        o.body = { txn_id: o.id, user_id: myId() };
        converted = true;
      }
    });
    if (converted) saveOutbox(ops);
    if (!ops.length) return Promise.resolve(false);
    syncing = true;
    setTxnMsg("Aap ke pending records update ho rahe hain…", true);
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
        var msg = "Ho gaya! " + done + " record update ho gaye.";
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
      } else if (op.op === "unhide") {
        p = sb("khata_txn_hidden?txn_id=eq." + encodeURIComponent(op.id) + "&user_id=eq." + encodeURIComponent(myId()), { method: "DELETE" });
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
                triggerPush(other, isSettle ? "Hisaab barabar ho gaya" : myName() + " ne record add kiya", notifBodyFor(op.body, other), op.body.id);
              }
            } catch (e) {}
          }
          return next(i + 1);
        }
        if (res.status === 401 || res.status === 403) {
          syncing = false;
          renderOffline();
          setTxnMsg("Records update nahi ho sake. Dobara login karke try karein.", false);
          return Promise.resolve(false);
        }
        var errMsg = (res.body && res.body.message) || "";
        if (op.op === "insert" && (res.status === 409 || errMsg.indexOf("duplicate") !== -1)) {
          done++; // record pehle hi server par hai (lost response ke baad retry) — duplicate nahi
          dropOp(op.key);
          return next(i + 1);
        }
        // v24.8: 5xx jo "Settled" lock NAHI — aarzi server kharabi hai, data
        // loss nahi: op queued rakho, flush roko, baad mein retry hoga.
        // Sirf permanent rejects drop hote hain (Settled lock, 4xx bad data).
        if (res.status >= 500 && errMsg.indexOf("Settled") === -1) {
          syncing = false;
          renderOffline();
          setTxnMsg("Internet aate hi pending records khud update ho jayenge.", false);
          return Promise.resolve(false);
        }
        skipped++;
        if (errMsg.indexOf("Settled") !== -1) skippedSettled++;
        dropOp(op.key);
        return next(i + 1);
      }).catch(function () {
        syncing = false;
        renderOffline();
        setTxnMsg("Internet aate hi pending records khud update ho jayenge.", false);
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
      created_by: body.created_by, workspace_id: body.workspace_id || currentWorkspaceId,
      created_at: body.created_at || new Date().toISOString()
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
  function offlineTxnHide(id) {
    // Keep a pending transaction insert: it must reach the server before its
    // hide row (FK). Queue hide after it; restore can cancel only this hide op.
    var ops = loadOutbox();
    var dup = false;
    ops.forEach(function (o) { if (o.op === "insert" && o.table === "khata_txn_hidden" && o.id === id) dup = true; });
    if (!dup) queueOp({ key: newUuid(), op: "insert", table: "khata_txn_hidden", id: id, body: { txn_id: id, user_id: myId() }, ts: Date.now() });
    hiddenTxnIds[id] = true;
    saveCache();
    renderAll();
  }
  function offlineContactInsert(body) {
    var rec = {
      id: body.id || newUuid(),
      owner_id: body.owner_id, workspace_id: body.workspace_id || currentWorkspaceId,
      name: body.name, phone: body.phone || null,
      created_at: body.created_at || new Date().toISOString(), manual: true
    };
    myContacts.push(rec);
    queueOp({ key: newUuid(), op: "insert", table: "khata_contacts", id: rec.id, body: {
      id: rec.id, owner_id: rec.owner_id, workspace_id: rec.workspace_id,
      name: rec.name, phone: rec.phone
    }, ts: Date.now() });
    saveCache();
    return rec;
  }

  function renderHiddenTxns() {
    var list = txns.filter(function (t) { return !!hiddenTxnIds[t.id]; });
    if (!list.length) { $("hiddenTxnList").innerHTML = '<p class="empty">Koi hidden record nahi.</p>'; return; }
    var html = "";
    list.sort(function (a,b) { return String(b.txn_date || "").localeCompare(String(a.txn_date || "")); }).forEach(function (t) {
      var other = t.payer_id === myId() ? t.receiver_id : t.payer_id;
      html += '<div class="txn"><div class="t-main">' + esc(profileName(other)) + '</div><div class="t-sub">' +
        esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + '</div><div class="t-foot"><span class="t-amt">' +
        esc(fmtRs(t.amount)) + '</span><button class="btn btn-soft" type="button" data-restore-hidden="' + esc(t.id) + '">Restore</button></div></div>';
    });
    $("hiddenTxnList").innerHTML = html;
  }
  function restoreHiddenTxn(id) {
    if (!hiddenTxnIds[id] || guestMode) return;
    delete hiddenTxnIds[id]; saveCache(); renderAll(); renderHiddenTxns();
    sb("khata_txn_hidden?txn_id=eq." + encodeURIComponent(id) + "&user_id=eq." + encodeURIComponent(myId()), { method: "DELETE" })
      .then(function (res) {
        if (!res.ok) { hiddenTxnIds[id] = true; saveCache(); renderAll(); renderHiddenTxns(); setTxnMsg("Record wapas nahi aa saka. Dobara try karein.", false); }
      }).catch(function () {
        queueOp({ key: newUuid(), op: "unhide", table: "khata_txn_hidden", id: id, ts: Date.now() });
      });
  }

  function loadHiddenIds() {
    // v24.11: meri hidden record ids lao (khata_txn_hidden). Table na ho
    // (purana SQL) to khaali set — load kabhi is par fail nahi hota.
    if (guestMode) return Promise.resolve(hiddenTxnIds);
    return sb("khata_txn_hidden?select=txn_id&user_id=eq." + encodeURIComponent(myId()), {})
      .then(function (res) {
        if (res.ok && res.body) {
          hiddenTxnIds = {};
          res.body.forEach(function (r) { if (r.txn_id) hiddenTxnIds[r.txn_id] = true; });
        }
        return hiddenTxnIds;
      }).catch(function () { return hiddenTxnIds; });
  }

  // Fetch the full ledger in bounded pages so balances never silently stop
  // counting after the first 500 records. A 500-row page stays below the
  // common PostgREST max_rows setting and keeps each response manageable.
  // v86: DELTA SYNC — har boot par poora hisaab dobara nahi; sirf woh rows
  // jo aakhri sync ke baad badli hain (updated_at > watermark). Base = is
  // workspace ki taaza local rows (in-memory agar maujood, warna cache).
  // FULL fetch: pehli dafa (koi watermark nahi), 24h se purana full sync
  // (server-side delete kisi aur device se — us ki staleness ka bound),
  // ya delta par 42703 (PostgREST schema cache mein updated_at abhi nahi).
  function txnWatermark(rows) {
    var max = null;
    (rows || []).forEach(function (t) {
      var u = t && t.updated_at;
      if (u && (!max || u > max)) max = u;
    });
    return max;
  }
  function sortTxnsDesc(rows) {
    return rows.slice().sort(function (a, b) {
      if (a.txn_date !== b.txn_date) return a.txn_date < b.txn_date ? 1 : -1;
      var ca = a.created_at || "\uffff", cb = b.created_at || "\uffff"; // Postgres DESC: NULL pehle
      if (ca !== cb) return ca < cb ? 1 : -1;
      return 0;
    });
  }
  function loadAllTransactions() {
    var pageSize = 500, offset = 0, rows = [];
    var cached = loadCache(currentWorkspaceId);
    var base = [];
    var mem = (txns || []).filter(function (t) { return t.workspace_id === currentWorkspaceId; });
    if (mem.length) base = mem;
    else if (cached && Array.isArray(cached.txns)) base = cached.txns;
    var watermark = txnWatermark(base);
    if (cached && cached.txnFullSyncAt) txnFullSyncAt = cached.txnFullSyncAt;
    var needFull = !watermark || !txnFullSyncAt || (Date.now() - txnFullSyncAt > 24 * 60 * 60 * 1000);
    function loadPage() {
      var q = "khata_transactions?select=*&workspace_id=eq." + encodeURIComponent(currentWorkspaceId)
        + (needFull
          ? "&order=txn_date.desc&order=created_at.desc"
          : "&updated_at=gt." + encodeURIComponent(watermark) + "&order=updated_at.asc&order=created_at.asc");
      return sb(q, {
        range: offset + "-" + (offset + pageSize - 1)
      }).then(function (res) {
        if (!res.ok) {
          if (!needFull && res.body && res.body.code === "42703") { needFull = true; offset = 0; rows = []; return loadPage(); }
          throw new Error("txns load failed");
        }
        var page = Array.isArray(res.body) ? res.body : [];
        rows = rows.concat(page);
        if (page.length === pageSize) {
          offset += pageSize;
          return loadPage();
        }
        if (needFull) { txnFullSyncAt = Date.now(); return rows; }
        var byId = {};
        base.forEach(function (t) { byId[t.id] = t; });
        rows.forEach(function (t) { byId[t.id] = t; });
        return sortTxnsDesc(Object.keys(byId).map(function (k) { return byId[k]; }));
      });
    }
    return loadPage();
  }

  function loadAll() {
    if (guestMode) {
      // v24: guest mode mein Refresh sirf local store dobara parhta hai —
      // server ko koi call nahi jati.
      loadGuestIntoState();
      renderAll();
      runRecurringDue(); // v87: guest rules bhi due hon to local record bane
      setTxnMsg("", true);
      return;
    }
    setTxnMsg("");
    acceptInviteFromUrl().then(function (accepted) {
      if (accepted) { teardownRealtime(); loadAll(); return; }
      profilesQuery(true).then(function (res) {
      // If a column doesn't exist yet (purana SQL), load with the minimal
      // columns — warna 42703 retry bhi wahi columns mangta.
      if (!res.ok && res.body && res.body.code === "42703") return sb("khata_profiles?select=id,name,email,created_at&order=name.asc");
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
      var selfProfile = null;
      profiles.forEach(function (p) { if (p.id === myId()) selfProfile = p; });
      currentWorkspaceId = (selfProfile && selfProfile.active_workspace_id) || currentWorkspaceId;
      if (!currentWorkspaceId) throw new Error("active workspace missing");
      try { window.localStorage.setItem(ACTIVE_WS_KEY,currentWorkspaceId); } catch(e) {}
      return loadWorkspaces().then(function () { return loadAllTransactions(); });
    }).then(function (rows) {
      if (!rows) return;
      txns = rows;
      rtLastFetch = Date.now();
      offlineMode = false;
      return loadHiddenIds().then(function () {
        renderAll();
        if (currentView === "admin") renderAdminDashboard();
        setupRealtime();
        loadNotifs();
        loadContacts();
        loadRecurringRules().then(function () { runRecurringDue(); }); // v87: due rules ke record banein
        saveCache();
        flushOutbox();
      });
    }).catch(function () {
      // Offline: aakhri save hua data dikhayein (agar cache hai).
      var c = loadCache(currentWorkspaceId);
      if (c) {
        offlineMode = true;
        startOfflineRecheck(); // v68: 15s probe — theek hote hi badge khud hat jaye
        dbReady = true;
        profiles = c.profiles || [];
        workspaces = Array.isArray(c.workspaces) ? c.workspaces : workspaces;
        currentWorkspaceId = c.workspaceId || currentWorkspaceId;
        try { if(currentWorkspaceId) window.localStorage.setItem(ACTIVE_WS_KEY,currentWorkspaceId); } catch(e) {}
        txns = c.txns || [];
        hiddenTxnIds = {};
        (c.hidden || []).forEach(function (hid) { hiddenTxnIds[hid] = true; });
        myContacts = (c.contacts || []).map(function (x) { x.manual = true; return x; });
        notifs = c.notifs || [];
        recurringRules = c.recurring || []; // v87: offline bhi rules cache se
        renderWorkspaceBar();
        renderAll();
        renderNotifBadge();
        setTxnMsg("Connection nahi mil raha. Filhal aapko is community ka aakhri saved hisaab dikhaya ja raha hai.", false);
        renderOffline();
        runRecurringDue(); // v87: offline bhi due record queue ho jaye
        return;
      }
      setTxnMsg("Records load nahi hue — refresh karein.", false);
      renderAll(); // v24.8: cache na ho to bhi khaali state saaf render ho (blank screen nahi)
    });
    });
  }

  /* ---------- guest -> account migration (v24) ----------
     Signup/login ke baad, agar is device par guest hisaab maujood ho to
     aik dafa poocha jata hai ke use cloud account mein save karna hai ya
     nahi. SAFE design: guest UUIDs random hain, is liye contact/record ids
     wahi rehte hain — sirf guestMe ki jagah naya user id aata hai
     (payer/receiver/created_by/owner_id). Settlement notes waisi ki waisi
     rehti hain, to settled-lock bhi saath chalta hai. Agar koi record fail
     ho to guest store NAHI mit-ta — data mehfooz rehta hai aur agle login
     par dobara offer hoti hai. Guest store sirf tab mit-ta hai jab sab
     kuch kamyab ho jaye. */
  var guestMigrationOffered = false;
  function maybeOfferGuestMigration() {
    if (guestMigrationOffered || guestMode) return;
    if (!guestHasData()) return;
    guestMigrationOffered = true;
    offerGuestMigration();
  }
  // v74: DOHRI confirmation — pehle "Save karein", phir "Pakka save karein?"
  // (Haan, save karein) — tab jaa kar doGuestMigration chalta hai. Cancel
  // kisi bhi step par = kuch nahi hota, guest hisaab mehfooz rehta hai.
  function offerGuestMigration() {
    if (guestMode) return;
    if (!guestHasData()) return;
    var g = loadGuestStore();
    var n = (g.txns || []).length, c = (g.contacts || []).length, rr = (g.recurring || []).length;
    askConfirm("Guest hisaab save karein?",
      "Aap ke guest mode ke " + n + " records aur " + c + " dost is account mein save ho jayenge — phir ye cloud par mehfooz rahenge." + (rr ? " " + rr + " recurring rules bhi saath aayenge." : ""),
      "Save karein", function () {
        askConfirm("Pakka save karein?",
          "Ye " + n + " records aur " + c + " dost aap ke account mein save ho jayenge, aur guest mode se hat jayenge. Ye wapas nahi hoga.",
          "Haan, save karein", doGuestMigration);
      });
  }
  function doGuestMigration() {
    var g = loadGuestStore();
    if (!g) return;
    var me = myId();
    var guestMe = (g.me && g.me.id) || "";
    var contactJobs = (g.contacts || []).map(function (ct) {
      return sb("khata_contacts", { method: "POST", prefer: "return=representation", body: {
        id: ct.id, owner_id: me, workspace_id: currentWorkspaceId, name: ct.name, phone: ct.phone || null
      } });
    });
    Promise.all(contactJobs).then(function () {
      var txnJobs = (g.txns || []).map(function (t) {
        return sb("khata_transactions", { method: "POST", prefer: "return=representation", body: {
          id: t.id,
          payer_id: t.payer_id === guestMe ? me : t.payer_id,
          receiver_id: t.receiver_id === guestMe ? me : t.receiver_id,
          amount: t.amount, note: t.note, txn_date: t.txn_date,
          created_by: me, workspace_id: currentWorkspaceId, created_at: t.created_at || new Date().toISOString()
        } });
      });
      return Promise.all(txnJobs);
    }).then(function (txnResults) {
      var txnFailed = txnResults.filter(function (r) { return !r.ok; }).length;
      // v87: guest recurring rules bhi migrate hon (ids wahi, guestMe -> me).
      var ruleJobs = (g.recurring || []).map(function (r) {
        return sb("khata_recurring", { method: "POST", prefer: "return=representation", body: {
          id: r.id, owner_id: me, workspace_id: currentWorkspaceId,
          payer_id: r.payer_id === guestMe ? me : r.payer_id,
          receiver_id: r.receiver_id === guestMe ? me : r.receiver_id,
          amount: r.amount, note: r.note || "", frequency: r.frequency, day_value: r.day_value,
          next_due: r.next_due, is_active: r.is_active !== false,
          created_at: r.created_at || new Date().toISOString()
        } });
      });
      return Promise.all(ruleJobs).then(function (ruleResults) {
        return txnFailed + ruleResults.filter(function (r) { return !r.ok; }).length;
      });
    }).then(function (failed) {
      if (failed) {
        setTxnMsg(failed + " records migrate nahi hue — guest hisaab mehfooz hai, agle login par phir poocha jayega.", false);
        return;
      }
      try { window.localStorage.removeItem(GUEST_KEY); } catch (e) {}
      loadAll(); // pehle load (ye txnMsg saaf karta hai), phir kamyabi ka message
      setTxnMsg("Aap ka guest hisaab account mein save ho gaya! ✓", true);
    }).catch(function () {
      setTxnMsg("Hisaab transfer nahi ho saka. Internet check karke dobara koshish karein. Aapka mehmaan wala hisaab mehfooz hai.", false);
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
    renderRecurringList(); // v87: recurring page ki list taaza (chhoti list, sasti)
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
  var rtRetryTimer = null;
  var rtLastFetch = 0;
  var rtGeneration = 0;
  function liveReload() {
    if (guestMode) return; // v71: guest mode mein kabhi account data fetch nahi
    var ind = $("liveUpdating");
    var slowTimer = setTimeout(function () { if (ind) ind.hidden = false; }, 800);
    var done = function () { clearTimeout(slowTimer); if (ind) ind.hidden = true; rtLastFetch = Date.now(); };
    refreshTxns().then(function () { loadNotifs(); loadContacts(); loadRecurringRules(); done(); }).catch(function () { done(); });
  }
  function scheduleLiveReload() {
    if (guestMode) return; // v71: guest mode mein live reload kabhi nahi
    if (rtTimer) clearTimeout(rtTimer);
    rtTimer = setTimeout(function () { rtTimer = null; liveReload(); }, 300);
  }
  function scheduleRealtimeRetry() {
    if (guestMode || !session || rtRetryTimer) return;
    rtRetryTimer = setTimeout(function () {
      rtRetryTimer = null;
      if (!rtChannel && session && !guestMode) setupRealtime();
    }, 15000);
  }
  function setupRealtime() {
    try {
      if (!window.supabase || !window.supabase.createClient || !currentWorkspaceId || guestMode || !session) return;
      if (rtChannel) return;
      var generation = ++rtGeneration;
      var client = window.supabase.createClient(API, ANON);
      if (session.access_token && client.realtime && client.realtime.setAuth) client.realtime.setAuth(session.access_token);
      var channel = client.channel("easy-khata-live-" + currentWorkspaceId + "-" + generation)
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_transactions", filter: "workspace_id=eq." + currentWorkspaceId }, scheduleLiveReload)
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_notifications", filter: "user_id=eq." + myId() }, scheduleLiveReload)
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_contacts", filter: "workspace_id=eq." + currentWorkspaceId }, scheduleLiveReload)
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_recurring", filter: "workspace_id=eq." + currentWorkspaceId }, scheduleLiveReload)
        .on("postgres_changes", { event: "*", schema: "public", table: "khata_txn_hidden", filter: "user_id=eq." + myId() }, scheduleLiveReload);
      rtChannel = channel;
      channel.subscribe(function(status) {
        if (status === "SUBSCRIBED") { rtLastFetch = Date.now(); return; }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (rtChannel === channel) rtChannel = null;
          try { channel.unsubscribe(); } catch(e) {}
          scheduleRealtimeRetry();
        }
      });
    } catch (e) {
      rtChannel = null;
      scheduleRealtimeRetry();
    }
  }
  window.EASY_KHATA_ON_SUPABASE_READY = function () { if (session && !guestMode) setupRealtime(); };
  // v82: CSP — supabase script tag ka inline onload attribute hata diya;
  // SDK ready hone ka signal JS se sunte hain (sync load ho to foran)
  (function () {
    var s = document.getElementById("supabaseSdk");
    if (!s) return;
    if (window.supabase) { window.EASY_KHATA_ON_SUPABASE_READY && window.EASY_KHATA_ON_SUPABASE_READY(); }
    else s.addEventListener("load", function () { window.EASY_KHATA_ON_SUPABASE_READY && window.EASY_KHATA_ON_SUPABASE_READY(); });
  })();
  function teardownRealtime() {
    try {
      rtGeneration++;
      if (rtTimer) { clearTimeout(rtTimer); rtTimer = null; }
      if (rtRetryTimer) { clearTimeout(rtRetryTimer); rtRetryTimer = null; }
      if (rtChannel) { var old=rtChannel; rtChannel=null; old.unsubscribe(); }
    } catch (e) { rtChannel = null; }
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && session && !guestMode && Date.now() - rtLastFetch > 30000) { // v71: guestMode guard — warna guest view mein account data aa jata tha
      scheduleLiveReload();
      if (!rtChannel) setupRealtime();
    }
  });
  window.addEventListener("online", function () {
    if (session && !guestMode) { setupRealtime(); loadAll(); }
  });
  // Realtime is an optimization, not the only source of truth. Poll quietly
  // while the tab is visible so a dropped socket cannot leave stale balances.
  setInterval(function () {
    if (session && !guestMode && !document.hidden && Date.now() - rtLastFetch > 90000) {
      scheduleLiveReload();
      if (!rtChannel) setupRealtime();
    }
    if (session && !guestMode && loadOutbox().length) flushOutbox();
  }, 30000);
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
  var notifAudioCtx = null, notifAudioUnlocked = false, notifFirstLoad = true, seenNotifIds = {};
  function unlockNotifAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!notifAudioCtx) notifAudioCtx = new Ctx();
      if (notifAudioCtx.state === "suspended") {
        var resume = notifAudioCtx.resume();
        if (resume && resume.then) resume.then(function () { notifAudioUnlocked = notifAudioCtx.state === "running"; });
      }
      notifAudioUnlocked = true;
    } catch (e) { notifAudioUnlocked = false; }
  }
  function playNotifSound() {
    if (!notifAudioUnlocked || !notifAudioCtx || notifAudioCtx.state !== "running") return;
    try {
      var ctx = notifAudioCtx, now = ctx.currentTime;
      [880, 1174].forEach(function (hz, i) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, now + i * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.13 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.13 + 0.11);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.13); osc.stop(now + i * 0.13 + 0.12);
      });
    } catch (e) {}
  }
  document.addEventListener("pointerdown", unlockNotifAudio, { passive: true });
  document.addEventListener("keydown", unlockNotifAudio);
  var notifCleanupDone = false; // v81: 90-din purani PARHI notifications — session mein sirf aik dafa
  var cleanedNotifIds = {}; // v81: DELETE-confirmed ids — dobara fetch (boot 2 dafa
  // loadNotifs chalata hai) par wapas na aayein; DELETE fail ho to set nahi hota
  function cleanupOldReadNotifs(rows){
    if(notifCleanupDone||guestMode||!session||!session.access_token)return;
    notifCleanupDone=true;
    var cutoffIso=new Date(Date.now()-90*24*3600*1000).toISOString();
    var stale=rows.filter(function(n){return n.is_read&&n.created_at&&new Date(n.created_at)<new Date(cutoffIso);});
    if(!stale.length)return;
    sb("khata_notifications?user_id=eq."+encodeURIComponent(myId())+"&is_read=eq.true&created_at=lt."+encodeURIComponent(cutoffIso),{method:"DELETE"}).then(function(res){
      if(!res.ok)return; // delete fail ho to rows agle fetch par wapas aa jayengi — local se nahi hatate
      var staleIds={};stale.forEach(function(n){staleIds[n.id]=true;cleanedNotifIds[n.id]=true;});
      notifs=notifs.filter(function(n){return !staleIds[n.id];});
      renderNotifBadge();syncAppBadge();
      if(!$("notifView").hidden)renderNotifList();
      saveCache();
    }).catch(function(){});
  }
  function loadNotifs() {
    if (guestMode || !session || !session.access_token) return; // v71: guest mode mein kabhi account notifs nahi
    sb("khata_notifications?select=*&user_id=eq." + encodeURIComponent(myId()) + "&order=created_at.desc&limit=50")
      .then(function (res) {
        if (!res.ok) return;
        var incoming = Array.isArray(res.body) ? res.body : [];
        incoming = incoming.filter(function (n) { return !(n.id && cleanedNotifIds[n.id]); }); // v81: delete-confirmed wapas nahi
        var fresh = incoming.filter(function (n) { return n.id && !seenNotifIds[n.id]; });
        if (notifFirstLoad) { incoming.forEach(function (n) { if (n.id) seenNotifIds[n.id] = true; }); notifFirstLoad = false; }
        else if (fresh.length) {
          fresh.forEach(function (n) { seenNotifIds[n.id] = true; });
          // Foreground popup + tone only while visible. Background/closed
          // delivery is handled by the push service workers (system sound).
          if (document.visibilityState === "visible") {
            playNotifSound();
            if (window.Notification && Notification.permission === "granted") {
              fresh.slice(0, 3).forEach(function (n) { try { new Notification(n.title || "Easy Khata", { body: n.body || "Nayi notification aayi hai.", icon: "icons/icon.svg", tag: "easy-khata-" + n.id }); } catch (e) {} });
            }
          }
        }
        notifs = incoming;
        cleanupOldReadNotifs(incoming); // v81: 90 din se purani PARHI notifications saaf (unread kabhi nahi)
        renderNotifBadge();
        syncAppBadge(); // v24.4: icon badge = asal unread count
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
  // v24.4: app icon badge (Badging API) — PWA install hone par home screen ke
  // app icon par unread count dikhe, taake notification bina app khole nazar
  // aaye. API na ho to silent skip (koi crash/error nahi). Badge hamesha
  // ASAL unread count hota hai; list khuli ho to sync rukta hai (user dekh
  // raha hai — badge wapas tab aata hai jab list band ho aur unread bachein).
  var appBadgeCount = -1; // aakhri baar icon par kya set kiya (-1 = unknown)
  function clearAppBadgeNow() {
    try {
      if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) {
        var c = navigator.clearAppBadge();
        if (c && c.catch) c.catch(function () {});
      }
    } catch (e) {}
    appBadgeCount = 0;
  }
  function syncAppBadge() {
    try {
      if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
      if (!$("notifView").hidden) return; // Yaad Dehani khuli hai — user dekh raha hai
      var n = unreadNotifCount();
      if (n === appBadgeCount) return; // pehle se wahi hai — dobara set nahi
      appBadgeCount = n;
      if (n > 0) { var p = navigator.setAppBadge(n); if (p && p.catch) p.catch(function () {}); }
      else if ("clearAppBadge" in navigator) { var c2 = navigator.clearAppBadge(); if (c2 && c2.catch) c2.catch(function () {}); }
    } catch (e) {}
  }
  // v79: Yaad Dehani redesign — kind icon, relative time, tappable links,
  // 3-line clamp + tap to expand, filter chips (Sab/Naye/Parhe hue) + counts.
  var notifFilter = "all";
  var expandedNotifIds = {};
  function fmtRelTime(ts) {
    try {
      var d = new Date(ts).getTime();
      if (!d) return fmtDate(ts);
      var s = Math.max(0, Math.floor((Date.now() - d) / 1000));
      if (s < 60) return "Abhi";
      var m = Math.floor(s / 60);
      if (m < 60) return m + " minute pehle";
      var h = Math.floor(m / 60);
      if (h < 24) return h + (h === 1 ? " ghanta pehle" : " ghante pehle");
      var days = Math.floor(h / 24);
      if (days === 1) return "Kal";
      if (days < 7) return days + " din pehle";
      return fmtDate(ts);
    } catch (e) { return fmtDate(ts); }
  }
  function notifKindMeta(kind) {
    if (kind === "remind") return { ic: "🔔", cls: "kind-remind" };
    if (kind === "settle") return { ic: "✅", cls: "kind-settle" };
    if (kind === "admin") return { ic: "🛡️", cls: "kind-admin" };
    if (kind === "record") return { ic: "➕", cls: "kind-record" };
    return { ic: "💬", cls: "kind-other" };
  }
  function linkifyNotifBody(text) {
    // Pehle escape (XSS safe), phir http(s) links ko tappable banao.
    var safe = esc(text || "");
    return safe.replace(/https?:\/\/[^\s<]+/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>";
    });
  }
  function renderNotifList() {
    var unread = unreadNotifCount();
    var badge = $("notifCountBadge");
    if (badge) { badge.hidden = unread === 0; badge.textContent = unread + " nayi"; }
    var markAll = $("markAllReadBtn");
    if (markAll) markAll.hidden = unread === 0;
    document.querySelectorAll("[data-notif-filter]").forEach(function (b) {
      var f = b.getAttribute("data-notif-filter");
      var n = f === "unread" ? unread : f === "read" ? (notifs.length - unread) : notifs.length;
      b.textContent = (f === "all" ? "Sab" : f === "unread" ? "Naye" : "Parhe hue") + " (" + n + ")";
      b.classList.toggle("is-active", f === notifFilter);
    });
    var list = notifs.filter(function (x) {
      return notifFilter === "unread" ? !x.is_read : notifFilter === "read" ? x.is_read : true;
    });
    if (!list.length) {
      $("notifList").innerHTML = '<p class="empty">' +
        (notifFilter === "unread" ? "Koi nayi yaad dehani nahi — sab parha hua hai. ✓"
          : notifFilter === "read" ? "Abhi koi parhi hui notification nahi."
          : "Abhi koi notification nahi.") + "</p>";
      return;
    }
    var html = "";
    list.forEach(function (x) {
      var meta = notifKindMeta(x.kind);
      var expanded = !!expandedNotifIds[x.id];
      html += '<div class="notif' + (x.is_read ? "" : " unread") + (expanded ? " expanded" : "") + '" data-notif="' + esc(x.id) + '">' +
        '<span class="notif-ic ' + meta.cls + '" aria-hidden="true">' + meta.ic + "</span>" +
        '<span class="notif-main"><span class="notif-title">' + esc(x.title || "") + (x.is_read ? "" : '<span class="notif-dot" aria-hidden="true"></span>') + "</span>" +
        '<span class="notif-body">' + linkifyNotifBody(x.body || "") + "</span>" +
        '<span class="notif-time">' + esc(fmtRelTime(x.created_at)) + " · " + esc(fmtNotifTime(x.created_at)) + "</span></span></div>";
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
    clearAppBadgeNow(); // v24.4: list kholi = dekh liya — icon badge clear
    loadNotifs();
  }

  /* ---------- manual contacts ---------- */
  var myContacts = [];
  function loadContacts() {
    if (guestMode || !session || !session.access_token) return Promise.resolve(0); // v71: guest mode mein kabhi account contacts nahi
    return sb("khata_contacts?select=*&workspace_id=eq." + encodeURIComponent(currentWorkspaceId) + "&owner_id=eq." + encodeURIComponent(myId()) + "&order=created_at.asc")
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
    // Never delete the manual contact until every matching ledger row has
    // actually been migrated. PostgREST can return 2xx with zero rows under RLS.
    function moveParty(field) {
      var filter = field + "=eq." + encodeURIComponent(c.id) + "&created_by=eq." + encodeURIComponent(me);
      return sb("khata_transactions?select=id&" + filter)
        .then(function (found) {
          if (!found.ok) throw new Error("contact-link-read-failed");
          var rows = Array.isArray(found.body) ? found.body : [];
          if (!rows.length) return true;
          return sb("khata_transactions?" + filter, {
            method: "PATCH",
            prefer: "return=representation",
            body: (function () { var x = {}; x[field] = target.id; return x; })()
          }).then(function (updated) {
            if (!updated.ok || !Array.isArray(updated.body) || updated.body.length !== rows.length) {
              throw new Error("contact-link-update-incomplete");
            }
            return true;
          });
        });
    }
    return moveParty("payer_id").then(function () {
      return moveParty("receiver_id");
    }).then(function () {
      return sb("khata_contacts?id=eq." + encodeURIComponent(c.id) +
        "&owner_id=eq." + encodeURIComponent(me), { method: "DELETE", prefer: "return=representation" });
    }).then(function (removed) {
      if (!removed.ok) throw new Error("contact-link-cleanup-failed");
      myContacts = myContacts.filter(function (x) { return x.id !== c.id; });
      return true;
    }).catch(function () { return false; });
  }
  function refreshTxns() {
    if (guestMode) return Promise.resolve(); // v71: guest mode mein kabhi account txns fetch nahi
    return loadAllTransactions()
      .then(function (rows) {
        txns = rows;
        return loadHiddenIds().then(function () { renderAll(); });
      }).catch(function () {});
  }

  /* ---------- recurring records (v87) ----------
     Rule = aik record jo har mahina / har hafta khud ban jata hai.
     - Table khata_recurring (owner-only RLS); guest rules local store mein.
     - Due check loadAll par chalta hai: next_due <= aaj wale active rules
       ke liye txn banta hai (txn_date = due date, imandari se), phir
       next_due aik period aage. Aik run mein zyada se zyada 3 chhoote hue
       (lambi chhutti ke baad sailaab na aaye — baaki agle run mein).
     - Txn id deterministic hai (rule + due date) — dobara run ya khoi hui
       response par bhi duplicate nahi banta (POST 409 = pehle hi bana hua). */
  var WEEKDAYS_UR = ["Peer", "Mangal", "Budh", "Jumeraat", "Jumma", "Hafta", "Itwaar"];
  function loadRecurringRules() {
    if (guestMode) return Promise.resolve(recurringRules);
    if (!currentWorkspaceId) return Promise.resolve(recurringRules);
    return sb("khata_recurring?select=*&workspace_id=eq." + encodeURIComponent(currentWorkspaceId) + "&order=next_due.asc")
      .then(function (res) {
        if (res.ok) recurringRules = Array.isArray(res.body) ? res.body : [];
        return recurringRules;
      }).catch(function () { return recurringRules; });
  }
  function saveRecurringRule(rule) {
    if (guestMode) { saveGuestStore(); saveCache(); return Promise.resolve(true); }
    return sb("khata_recurring?id=eq." + encodeURIComponent(rule.id), { method: "PATCH", prefer: "return=minimal", body: { next_due: rule.next_due, last_run_at: rule.last_run_at, is_active: rule.is_active, updated_at: new Date().toISOString() } })
      .then(function (res) {
        if (res.ok) { saveCache(); return true; }
        if (isTransientResponse(res)) { queueOp({ key: newUuid(), op: "update", table: "khata_recurring", id: rule.id, body: { next_due: rule.next_due, last_run_at: rule.last_run_at, is_active: rule.is_active }, ts: Date.now() }); saveCache(); return true; }
        return false;
      }).catch(function () {
        queueOp({ key: newUuid(), op: "update", table: "khata_recurring", id: rule.id, body: { next_due: rule.next_due, last_run_at: rule.last_run_at, is_active: rule.is_active }, ts: Date.now() });
        saveCache();
        return true;
      });
  }
  function createRecurringTxn(rule, dueDate) {
    var id = recurringDueId(rule.id, dueDate);
    var exists = null;
    txns.forEach(function (t) { if (t.id === id) exists = t; });
    if (exists) return Promise.resolve(0);
    var body = { payer_id: rule.payer_id, receiver_id: rule.receiver_id, amount: rule.amount, note: rule.note, txn_date: dueDate, created_by: rule.owner_id, workspace_id: rule.workspace_id };
    if (guestMode) {
      txns.unshift(Object.assign({ id: id, created_at: new Date().toISOString() }, body));
      saveGuestStore();
      return Promise.resolve(1);
    }
    return sb("khata_transactions", { method: "POST", prefer: "return=representation", body: Object.assign({ id: id }, body) })
      .then(function (res) {
        if (res.ok) {
          var created = res.body && res.body[0];
          if (created) {
            txns.unshift(created);
            var other = rule.payer_id === myId() ? rule.receiver_id : rule.payer_id;
            if (other && other !== myId()) { sendNotif(other, "record", created); triggerPush(other, myName() + " ne record add kiya", notifBodyFor(created, other), created.id); }
          }
          return 1;
        }
        if (res.status === 409) return 0;
        if (isTransientResponse(res)) { offlineTxnInsert(Object.assign({ id: id }, body)); return 1; }
        return 0;
      }).catch(function () { offlineTxnInsert(Object.assign({ id: id }, body)); return 1; });
  }
  function runRecurringDue() {
    if (recurringDueRunning) return Promise.resolve(0);
    if (!guestMode && !currentWorkspaceId) return Promise.resolve(0);
    recurringDueRunning = true;
    var today = todayLocal();
    var due = recurringRules.filter(function (r) { return r.is_active && r.next_due && r.next_due <= today; });
    if (!due.length) { recurringDueRunning = false; return Promise.resolve(0); }
    var created = 0;
    var jobs = due.map(function (rule) {
      var dates = [];
      var d = rule.next_due;
      while (d <= today && dates.length < 3) { dates.push(d); d = nextRecurringDate(rule.frequency, rule.day_value, d); }
      var chain = Promise.resolve();
      dates.forEach(function (dueDate) { chain = chain.then(function () { return createRecurringTxn(rule, dueDate); }); });
      return chain.then(function (n) {
        created += n;
        rule.next_due = d;
        rule.last_run_at = new Date().toISOString();
        return saveRecurringRule(rule);
      });
    });
    return Promise.all(jobs).then(function () {
      recurringDueRunning = false;
      if (created) { saveCache(); renderAll(); }
      return created;
    }).catch(function () { recurringDueRunning = false; return created; });
  }
  function renderRecurringList() {
    var box = $("recurringList");
    if (!box) return;
    var list = recurringRules.slice().sort(function (a, b) { return (a.next_due || "") < (b.next_due || "") ? -1 : 1; });
    if (!list.length) {
      box.innerHTML = '<p class="empty">Abhi koi recurring record nahi — naya record save karte waqt "Har dafa repeat karein" tick karein.</p>';
      return;
    }
    var html = "";
    list.forEach(function (r) {
      var other = r.payer_id === myId() ? r.receiver_id : r.payer_id;
      var name = profileName(other) || "—";
      var dir = r.payer_id === myId() ? "Diye" : "Liye";
      var freqTxt = r.frequency === "weekly"
        ? ("Har hafta · " + WEEKDAYS_UR[(r.day_value || 1) - 1])
        : ("Har mahina · " + r.day_value + " tareekh");
      html += '<div class="rec-rule"><div class="rec-rule-main"><strong>' + esc(name) + " — " + esc(fmtRs(r.amount)) + " (" + dir + ")</strong>"
        + '<span class="muted">' + esc(freqTxt) + " · Agla: " + esc(r.next_due || "—") + (r.is_active ? "" : " · ⏸ Paused") + "</span>"
        + (r.note ? '<span class="muted">' + esc(r.note) + "</span>" : "")
        + '</div><div class="rec-actions"><button class="btn btn-soft" type="button" data-rec-toggle="' + r.id + '">' + (r.is_active ? "Pause" : "Resume") + '</button>'
        + '<button class="btn btn-ghost" type="button" data-rec-del="' + r.id + '">Delete</button></div></div>';
    });
    box.innerHTML = html;
  }
  function toggleRecurringRule(id) {
    var rule = null;
    recurringRules.forEach(function (r) { if (r.id === id) rule = r; });
    if (!rule) return;
    rule.is_active = !rule.is_active;
    renderRecurringList();
    saveRecurringRule(rule);
    setRecurringMsg(rule.is_active ? "Recurring dobara on ho gaya." : "Recurring pause ho gaya — agla record nahi banega.", true);
  }
  function deleteRecurringRule(id) {
    var rule = null;
    recurringRules.forEach(function (r) { if (r.id === id) rule = r; });
    if (!rule) return;
    var other = rule.payer_id === myId() ? rule.receiver_id : rule.payer_id;
    askConfirm("Recurring hatayein?", "Ye repeat band ho jayega — " + (profileName(other) || "dost") + " ke saath " + fmtRs(rule.amount) + " ka record ab khud nahi banega. Pehle se bane hue records nahi hatenge.", "Hata dein", function () {
      recurringRules = recurringRules.filter(function (r) { return r.id !== id; });
      renderRecurringList();
      if (guestMode) { saveGuestStore(); setRecurringMsg("Recurring hata diya gaya.", true); return; }
      sb("khata_recurring?id=eq." + encodeURIComponent(id), { method: "DELETE" })
        .then(function (res) {
          if (res.ok) { saveCache(); setRecurringMsg("Recurring hata diya gaya.", true); return; }
          if (isTransientResponse(res)) { queueOp({ key: newUuid(), op: "delete", table: "khata_recurring", id: id, ts: Date.now() }); saveCache(); setRecurringMsg("Recurring hata diya gaya. Internet aate hi update ho jayega.", true); return; }
          setRecurringMsg("Recurring hataya nahi gaya — dobara try karein.", false);
        }).catch(function () {
          queueOp({ key: newUuid(), op: "delete", table: "khata_recurring", id: id, ts: Date.now() });
          saveCache();
          setRecurringMsg("Recurring hata diya gaya. Internet aate hi update ho jayega.", true);
        });
    });
  }
  function setRecurringMsg(text, ok) {
    var el = $("recurringMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
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
    if (guestMode) {
      // v24: guest contact — sirf local store, server ko kuch nahi.
      var guestRec = { id: newUuid(), owner_id: guestMeId, name: name, phone: phone || null, created_at: new Date().toISOString(), manual: true };
      myContacts.push(guestRec);
      saveGuestStore();
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost add ho gaya!", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      $("txnPerson").value = guestRec.id;
      cdSync($("txnPerson")); // v73: custom dropdown label bhi naye dost par le jao
      return;
    }
    var btn = $("saveContactBtn");
    btn.disabled = true;
    var contactBody = { id: newUuid(), owner_id: myId(), workspace_id: currentWorkspaceId, name: name, phone: phone || null };
    sb("khata_contacts", { method: "POST", prefer: "return=representation", body: contactBody }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) {
        if(isTransientResponse(res)){markConnectionIssue();var queued=offlineContactInsert(contactBody);$("newContactName").value="";$("newContactPhone").value="";setContactMsg("Server se rabta nahi ho saka" + saveErrDetail(res) + ". Dost ka naam phone mein save ho gaya; thodi der mein khud update ho jayega.",true);renderSummary();renderPeople();renderPersonSelect();renderTxnFilterOptions();$("txnPerson").value=queued.id;cdSync($("txnPerson"));return;}
        setContactMsg("Dost save nahi hua ("+res.status+")" + saveErrDetail(res) + " — dobara try karein.", false); return;
      }
      var created = res.body && res.body[0];
      if (created) { created.manual = true; myContacts.push(created); }
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost add ho gaya!", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      if (created) { $("txnPerson").value = created.id; cdSync($("txnPerson")); } // v73: label sync
    }).catch(function () {
      btn.disabled = false;
      var createdOffline = offlineContactInsert(contactBody);
      $("newContactName").value = "";
      $("newContactPhone").value = "";
      setContactMsg("Dost ka naam save ho gaya. Internet aate hi update ho jayega.", true);
      renderSummary();
      renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
      $("txnPerson").value = createdOffline.id;
      cdSync($("txnPerson")); // v73: label sync
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
    visibleTxns().forEach(function (t) {
      if ((t.payer_id === id || t.receiver_id === id) && (t.payer_id === myId() || t.receiver_id === myId())) { count++; if (isTxnLocked(t)) hasLocked = true; }
    });
    if (hasLocked) { setPeopleMsg("Is dost ka settled hisaab history mein save hai — usay delete nahi kar sakte.", false); return; }
    var text = count > 0
      ? "'" + (c.name || "") + "' — contacts se remove karein? Un ke " + count + " records sirf aapki history se hat jayenge — doosre dost ko koi fark nahi parega. Ye wapas nahi hoga."
      : "'" + (c.name || "") + "' ko contacts se remove karein?";
    askConfirm("Dost remove karein?", text, "Remove karein", function () {
      if (guestMode) {
        // v24: guest contact — sirf local: us ke saare records + contact
        // delete, koi server call, koi outbox nahi. Settled history pehle
        // hi upar rok di gayi hai (hasLocked check).
        txns = txns.filter(function (t) { return !(t.payer_id === id || t.receiver_id === id); });
        myContacts = myContacts.filter(function (x) { return x.id !== id; });
        saveGuestStore();
        renderAll(); // v86: poora render — khata list + detail bhi taaza (stale rows na rahein)
        setPeopleMsg("Contact remove ho gaya.", true);
        return;
      }
      var deleteRowOffline = function () {
        // Pending contact insert hai to use hata dein (delete op nahi chahiye).
        if (!removePendingInsert("khata_contacts", id)) {
          queueOp({ key: newUuid(), op: "delete", table: "khata_contacts", id: id, ts: Date.now() });
        }
        myContacts = myContacts.filter(function (x) { return x.id !== id; });
        saveCache();
        renderSummary();
        renderPeople(); renderPersonSelect(); renderTxnFilterOptions();
        setPeopleMsg("Dost ka naam remove ho gaya. Internet aate hi update ho jayega.", true);
      };
      var deleteTxnsOffline = function () {
        // v24.11: mere + is dost ke saare visible records (banane wala koi bhi ho) — sirf mere liye hide, delete nahi. Locked wale pehle hi rok diye gaye.
        var mine = visibleTxns().filter(function (t) { return (t.payer_id === id || t.receiver_id === id) && (t.payer_id === myId() || t.receiver_id === myId()); });
        mine.forEach(function (t) { offlineTxnHide(t.id); });
      };
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
      // v24.11: records DELETE nahi — har aik ko mere liye hide karein (khata_txn_hidden), phir contact row delete karein.
      var hideIds = visibleTxns().filter(function (t) { return (t.payer_id === id || t.receiver_id === id) && (t.payer_id === myId() || t.receiver_id === myId()); }).map(function (t) { return t.id; });
      Promise.all(hideIds.map(function (tid) {
        return sb("khata_txn_hidden", { method: "POST", prefer: "return=minimal", body: { txn_id: tid, user_id: myId() } })
          .then(function (r) { return (r.ok || r.status === 409) ? tid : null; })
          .catch(function () { return null; });
      })).then(function (done) {
        var failed = hideIds.filter(function (tid) { return done.indexOf(tid) === -1; });
        failed.forEach(function (tid) { offlineTxnHide(tid); });
        hideIds.forEach(function (tid) { if (done.indexOf(tid) !== -1) hiddenTxnIds[tid] = true; });
        saveCache();
        renderAll();
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
  // v24.5: per-USER subscription rows — on_conflict ab (endpoint, user_id)
  // hai, sirf endpoint nahi. Wajah (live sabit, Awais case): endpoint/token
  // DEVICE se bandha hota hai, account se nahi — ek hi phone par Asad ki
  // row pehle se hoti hai, to Awais ka upsert usi row ko UPDATE karne lagta
  // tha aur RLS (USING: user_id = auth.uid()) 403 deta tha. Composite
  // unique index (endpoint, user_id) ke saath har account ki apni row banti
  // hai. + res.ok check: pehle sb() ka resolve (403 par bhi) seedha "on"
  // kar deta tha — VAPID path par jhootha "On ✓" (FCM path par ye check
  // pehle se tha).
  function savePushSub(sub) {
    var k = sub.toJSON();
    return sb("khata_push_subs?on_conflict=endpoint,user_id", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: myId(), endpoint: sub.endpoint, p256dh: k.keys.p256dh, auth: k.keys.auth }
    }).then(function (res) {
      if (!res.ok) { var e = new Error("save failed: " + res.status); e.status = res.status; throw e; }
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
  // v24.5: per-USER rows — on_conflict ab (fcm_token, user_id) hai (wajah
  // upar savePushSub wali: FCM token bhi device se bandha hota hai).
  // Error mein ab HTTP status bhi hota hai taake 401/403 (permission) ko
  // network failure se alag dikhaya ja sake.
  function saveFcmToken(token) {
    return sb("khata_push_subs?on_conflict=fcm_token,user_id", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: myId(), fcm_token: token }
    }).then(function (res) {
      if (!res.ok) { var e = new Error("save failed: " + res.status); e.status = res.status; throw e; }
    });
  }
  // FCM token ki maujoodgi check (self-heal: token milte hi DB mein save).
  // v23.1: "on" sirf tab jab DB save CONFIRM ho — pehle token milte hi
  // "on" set ho jata tha aur save error chhup jata tha, is liye UI jhootha
  // "On ✓" dikhata tha jab ke DB mein zero rows thi (Awais case).
  function fcmTokenState() {
    var messaging;
    try { messaging = fcmMessaging(); } catch (e) { return Promise.resolve("off"); }
    return fcmServiceWorker().then(function (reg) {
      return messaging.getToken({ vapidKey: cfg.FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    }).then(function (token) {
      if (!token) return "off";
      return saveFcmToken(token).then(function () {
        pushState = "on"; updatePushToggleLabel();
        return "on";
      }, function () {
        pushState = "off"; updatePushToggleLabel();
        return "off";
      });
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
        }, function (e) { return { ok: false, reason: saveReason(e) }; });
      }).catch(function (e) {
        return { ok: false, reason: "fcm-token-failed", detail: String((e && e.message) || e) };
      });
    }).catch(function () { return { ok: false, reason: "permission-default" }; });
  }
  // v24.5: save fail ki ASAL wajah — fetch throw (network, status nahi) vs
  // HTTP 401/403 (permission). 403 ka matlab "internet nahi" NAHI hota —
  // yehi ghalat message Awais ke case mein dikh raha tha.
  function saveReason(e) {
    if (e && (e.status === 401 || e.status === 403)) return "save-denied";
    return "save-failed";
  }
  // Har failure ki ASAL wajah — v22 ka generic "dobara khol kar try karein"
  // chhupa deta tha ke kaunsa step fail hua (user ko 23:11 PKT wahi mila tha).
  function pushReasonText(reason, detail) {
    if (reason === "unsupported") return "Is browser mein notifications available nahi hain. Chrome mein app khol kar try karein.";
    if (reason === "permission-denied") return "Notifications block hain — Chrome ki site settings mein ja kar Easy Khata ke liye Notifications allow karein.";
    if (reason === "permission-default") return "Chrome ne permission ka popup nahi dikhaya — aap ne pehle kai dafa mana kiya hoga, is liye Chrome ne prompt band kar diya hai. Chrome ke address bar mein lock 🔒 icon par tap karein → Site settings → Notifications → Allow karein, phir dobara try karein.";
    if (reason === "sw-not-ready") return "Service worker ready nahi hua — app band kar ke dobara kholein, phir try karein.";
    if (reason === "subscribe-failed") return "Subscription nahi bani" + (detail ? " (" + detail + ")" : "") + " — Chrome mein kholein (WhatsApp/Facebook ke andar wale browser se nahi), internet check karein, phir try karein.";
    if (reason === "fcm-init-failed") return "Firebase start nahi hua" + (detail ? " (" + detail + ")" : "") + " — app refresh kar ke dobara try karein.";
    if (reason === "fcm-token-failed") return "Notifications tayyar nahi ho sakin. Internet check karke dobara try karein.";
    if (reason === "save-failed") return "Internet se rabta nahi ho raha. Dobara try karein.";
    if (reason === "save-denied") return "Notifications on nahi ho sakin. App dobara khol kar try karein.";
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
      // v23.1: "on" sirf tab jab DB save CONFIRM ho — pehle subscription
      // milte hi "on" set ho jata tha aur save error chhup jata tha (FCM
      // wala hi bug). Save fail ho to "off" taake user dobara try kar sake.
      return savePushSub(sub).then(function () {
        pushState = "on"; updatePushToggleLabel();
        return pushState;
      }, function () {
        pushState = "off"; updatePushToggleLabel();
        return pushState;
      });
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
          }, function (e) { return { ok: false, reason: saveReason(e) }; });
        }, function (e) { return { ok: false, reason: "subscribe-failed", detail: String((e && e.message) || e) }; });
      });
    }).catch(function () {
      return { ok: false, reason: "permission-default" };
    });
  }
  // v22: Account menu ka "Notifications On karein" button — user gesture se
  // chalti hai, is liye Chrome prompt dikhata hai. v23: asal wajah dikhata hai.
  // v23.1: "on" par early return HATA DIYA — button dabane se enablePush()
  // HAMESHA dobara chalta hai (token/sub dobara save hota hai). Pehle ye
  // shortcut save fail ko hamesha chhupa deta tha (Awais case: UI "On ✓",
  // DB mein zero rows). "pehle se on hain" sirf tab jab save pehle se
  // confirm ho (pushState "on" = save confirm, fcmTokenState/vapidPushState
  // ke baad) — aur phir bhi dobara save karke confirm kiya jata hai.
  function enablePushFromButton() {
    if (!pushSupported) { setPushMsg(pushReasonText("unsupported"), false); return; }
    if (window.Notification && Notification.permission === "denied") {
      setPushMsg(pushReasonText("permission-denied"), false);
      return;
    }
    var wasOn = (pushState === "on");
    setPushMsg("Notifications on ho rahi hain…", true);
    enablePush().then(function (r) {
      if (r.ok) {
        if (wasOn) setPushMsg("Notifications pehle se on hain ✓", true);
        else setPushMsg("Notifications on ho gayi! ✓ Ab jab koi record save karega to popup aayega — app band ho to bhi.", true);
      } else setPushMsg(pushReasonText(r.reason, r.detail), false);
    });
  }
  function triggerPush(recipientId, title, text, txnId) {
    // Fire-and-forget: the server function sends the push to the recipient.
    // The save flow never waits on this.
    if (!recipientId || recipientId === myId() || !session || !session.access_token) return;
    var real = false;
    profiles.forEach(function (p) { if (p.id === recipientId) real = true; });
    if (!real) return; // a manual contact has no account
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ recipientId: recipientId, title: title, body: text, txnId: txnId || null })
    }).catch(function () {});
  }

  /* ---------- admin panel ---------- */
  function setAdminMsg(text, ok) {
    var el = $("adminMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function adminDateKey(value) { return String(value || "").slice(0, 10); }
  function adminChartBars(items, formatter, showValues) {
    if (!items.length) return '<p class="empty">Abhi chart ke liye data nahi.</p>';
    var max = Math.max.apply(Math, items.map(function (x) { return Number(x.value) || 0; }).concat([1]));
    return '<div class="admin-bars">' + items.map(function (x) {
      var value = Number(x.value) || 0;
      var height = Math.max(4, Math.round(value / max * 100));
      var fullLabel = x.title || x.label || "";
      var shortLabel = x.shortLabel || x.label || "";
      return '<div class="admin-bar-col"><div class="admin-bar-value">' + (showValues ? esc(formatter(value)) : '') + '</div><div class="admin-bar-track"><span style="height:' + height + '%"></span></div><div class="admin-bar-label" title="' + esc(fullLabel) + '"><span class="admin-bar-label-full">' + esc(x.label) + '</span><span class="admin-bar-label-short">' + esc(shortLabel) + '</span></div></div>';
    }).join('') + '</div>';
  }
  function renderAdminDashboard() {
    var users = adminUsers || [], rows = txns || [];
    var blocked = users.filter(function (u) { return !!u.blocked; }).length;
    var active = users.length - blocked;
    var totalAmountMinor = rows.reduce(function (sum, t) { return sum + moneyToMinor(t.amount); }, 0);
    var totalAmount = moneyFromMinor(totalAmountMinor);
    var today = todayLocal();
    var todayCount = rows.filter(function (t) { return adminDateKey(t.txn_date) === today; }).length;
    var kpis = [
      {label:"Total users",value:users.length,meta:active+" active · "+blocked+" blocked",icon:"♙",tone:"blue"},
      {label:"Ledger records",value:rows.length,meta:"Latest records loaded",icon:"▤",tone:"violet"},
      {label:"Recorded volume",value:fmtRs(totalAmount),meta:"Across loaded records",icon:"↗",tone:"green"},
      {label:"Today’s activity",value:todayCount,meta:"Transactions dated today",icon:"◷",tone:"amber"}
    ];
    $("adminKpis").innerHTML = kpis.map(function (k) {
      return '<article class="admin-kpi"><div class="admin-kpi-top"><span>'+esc(k.label)+'</span><i class="admin-kpi-icon '+k.tone+'">'+k.icon+'</i></div><strong>'+esc(k.value)+'</strong><small>'+esc(k.meta)+'</small></article>';
    }).join('');
    var dayItems=[];
    for(var d=13;d>=0;d--){
      var date=new Date(); date.setDate(date.getDate()-d);
      var key=date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
      var count=rows.filter(function(t){return adminDateKey(t.txn_date)===key;}).length;
      var dayMonth = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getMonth()];
      dayItems.push({label:pad(date.getDate())+" "+dayMonth,shortLabel:String(date.getDate()),title:pad(date.getDate())+" "+dayMonth+" "+date.getFullYear(),value:count});
    }
    $("adminDailyChart").innerHTML=adminChartBars(dayItems,function(v){return String(v);},true);
    var monthItems=[];
    for(var m=5;m>=0;m--){
      var md=new Date(); md.setDate(1); md.setMonth(md.getMonth()-m);
      var mk=md.getFullYear()+"-"+pad(md.getMonth()+1);
      var amountMinor=rows.filter(function(t){return adminDateKey(t.txn_date).slice(0,7)===mk;}).reduce(function(s,t){return s+moneyToMinor(t.amount);},0);
      var amount=moneyFromMinor(amountMinor);
      monthItems.push({label:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][md.getMonth()],value:amount});
    }
    $("adminMonthlyChart").innerHTML=adminChartBars(monthItems,function(v){return v>=100000?(v/1000).toFixed(0)+"k":v.toLocaleString("en-US");},true);
    var recent=rows.slice().sort(function(x,y){return String(y.created_at||y.txn_date).localeCompare(String(x.created_at||x.txn_date));}).slice(0,7);
    $("adminRecentActivity").innerHTML=recent.length?recent.map(function(t){
      var p=profileName(t.payer_id),r=profileName(t.receiver_id);
      return '<div class="admin-recent-row"><span class="admin-activity-icon">↔</span><div class="admin-recent-main"><strong>'+esc(p)+' → '+esc(r)+'</strong><small>'+esc(t.note||"Ledger entry")+' · '+esc(fmtDate(t.txn_date))+'</small></div><b>'+esc(fmtRs(t.amount))+'</b></div>';
    }).join(''):'<p class="empty">No recent transactions.</p>';
    var top=users.slice().sort(function(x,y){return (Number(y.records)||0)-(Number(x.records)||0);}).slice(0,6);
    $("adminTopUsers").innerHTML=top.length?top.map(function(u,i){
      var count=Number(u.records)||0, max=Math.max(1,Number(top[0].records)||0);
      return '<div class="admin-top-row"><span class="admin-rank">'+(i+1)+'</span><div class="admin-top-main"><strong>'+esc(u.name||u.email||"Unknown")+'</strong><div class="admin-mini-track"><span style="width:'+Math.round(count/max*100)+'%"></span></div></div><b>'+count+'</b></div>';
    }).join(''):'<p class="empty">No users found.</p>';
    var recordTotal=users.reduce(function(s,u){return s+(Number(u.records)||0);},0);
    $("adminStats").textContent=users.length+" accounts · "+recordTotal+" user-linked records (may count a shared record for both participants)";
    renderAdminUserList();
  }
  function renderAdminUserList() {
    var list=(adminUsers||[]).slice(), query=String(adminUserSearchText||"").toLowerCase();
    if(adminUserStatusFilter==="active") list=list.filter(function(u){return !u.blocked;});
    if(adminUserStatusFilter==="blocked") list=list.filter(function(u){return !!u.blocked;});
    if(query) list=list.filter(function(u){return [u.name,u.email,u.phone,u.id].join(" ").toLowerCase().indexOf(query)!==-1;});
    list.sort(function(x,y){
      if(adminUserSortMode==="records") return (Number(y.records)||0)-(Number(x.records)||0);
      if(adminUserSortMode==="name") return String(x.name||x.email||"").localeCompare(String(y.name||y.email||""));
      return String(y.created_at||"").localeCompare(String(x.created_at||""));
    });
    var shown=list.slice(0,adminUserShown);
    $("adminUserCount").textContent="Showing "+shown.length+" of "+list.length+" users";
    if(!list.length){$("adminUserList").innerHTML='<p class="empty">Is filter ke mutabiq koi user nahi mila.</p>';return;}
    var me=myId();
    $("adminUserList").innerHTML=shown.map(function(u){
      var isMe=u.id===me;
      return '<article class="admin-user-card"><button class="admin-user-open" type="button" data-admin-open="'+esc(u.id)+'"><span class="admin-user-avatar">'+esc(initials(u.name||u.email))+'</span><span class="admin-user-copy"><strong>'+esc(u.name||u.email||"Unknown")+'</strong><small>'+esc(u.email||"No email")+'</small><small>'+esc(u.phone||"Phone not added")+'</small></span><span class="admin-user-status '+(u.blocked?'blocked':'active')+'">'+(u.blocked?'Blocked':'Active')+'</span></button><div class="admin-user-meta"><span>'+esc(Number(u.records)||0)+' records</span><span>Joined '+esc(fmtDate(u.created_at)||"—")+'</span><span>'+(isMe?'Administrator':'Member')+'</span></div><div class="admin-user-actions"><button class="btn btn-soft btn-mini" type="button" data-admin-open="'+esc(u.id)+'">Manage account →</button>'+(isMe?'':'<button class="btn btn-danger btn-mini" type="button" data-admin-del="'+esc(u.id)+'">Delete</button>')+'</div></article>';
    }).join('')+(list.length>shown.length?'<button class="btn btn-soft btn-block" id="adminUserMoreBtn" type="button">Show more — '+(list.length-shown.length)+' baqi</button>':"");
    var moreBtn=$("adminUserMoreBtn");
    if(moreBtn)moreBtn.addEventListener("click",function(){adminUserShown+=20;renderAdminUserList();});
  }
  function exportAdminUsers() {
    if(!isAdmin()) return;
    var rows=[["Name","Email","Phone","Status","Records","Joined"]];
    (adminUsers||[]).forEach(function(u){rows.push([u.name||"",u.email||"",u.phone||"",u.blocked?"Blocked":"Active",Number(u.records)||0,u.created_at||""]);});
    var csv=rows.map(function(row){return row.map(function(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';}).join(",");}).join("\r\n");
    var blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    var url=URL.createObjectURL(blob), link=document.createElement("a");
    link.href=url;link.download="easy-khata-users-"+todayLocal()+".csv";document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }
  function renderAdmin() {
    if (!isAdmin()) { $("navAdminBtn").hidden = true; return; }
    $("navAdminBtn").hidden = false;
    setAdminMsg("Dashboard data load ho raha hai…",true);
    sb("rpc/admin_list_users", { method: "POST", body: {} })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("Users load nahi hue ("+res.status+") — dobara try karein.", false); return; }
        adminUsers = Array.isArray(res.body) ? res.body : [];
        renderAdminDashboard();
        loadAdminWorkspaceManagement();
        setAdminMsg("Dashboard update ho gaya · "+new Date().toLocaleTimeString(), true);
      }).catch(function () { setAdminMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
  }
  function adminSetCommunityEditMsg(message, ok) {
    var el=$("adminCommunityEditMsg"); if(!el)return;
    el.textContent=message||"";el.className="msg"+(ok?" ok":message?" err":"");
  }
  function loadAdminWorkspaceManagement() {
    if(!isAdmin())return Promise.resolve(false);
    return Promise.all([
      sb("rpc/admin_list_workspaces",{method:"POST",body:{}}),
      sb("rpc/admin_list_workspace_members",{method:"POST",body:{}})
    ]).then(function(results){
      if(!results[0].ok||!results[1].ok)throw new Error("Community management data could not load");
      adminWorkspaces=Array.isArray(results[0].body)?results[0].body:[];
      adminWorkspaceMembers=Array.isArray(results[1].body)?results[1].body:[];
      var memberFilter=$("adminMemberCommunityFilter"),previousCommunity=memberFilter?memberFilter.value:"";
      if(memberFilter){memberFilter.innerHTML='<option value="">All communities</option>'+adminWorkspaces.filter(function(w){return w.type==="business";}).map(function(w){return '<option value="'+esc(w.id)+'">'+esc(w.name)+'</option>';}).join("");if(adminWorkspaces.some(function(w){return w.id===previousCommunity;}))memberFilter.value=previousCommunity;cdSync(memberFilter);}
      renderAdminCommunities();renderAdminCommunityMembers();
      return true;
    }).catch(function(){
      $("adminCommunityList").innerHTML='<p class="empty">Communities load nahi ho sakin. Refresh karein.</p>';
      $("adminCommunityMemberList").innerHTML='<p class="empty">Members load nahi ho sake.</p>';
      return false;
    });
  }
  function renderAdminCommunities() {
    var box=$("adminCommunityList");if(!box)return;
    var q=String($("adminCommunitySearch").value||"").trim().toLowerCase();
    var status=$("adminCommunityStatus").value||"all";
    var communities=adminWorkspaces.filter(function(w){return w.type==="business";});
    var summary=$("adminCommunitySummary");
    if(summary){var active=communities.filter(function(w){return w.status==="active";}).length;var listed=communities.filter(function(w){return !!w.community_listed;}).length;var members=communities.reduce(function(n,w){return n+Number(w.member_count||0);},0);summary.innerHTML=[{label:"Total communities",value:communities.length},{label:"Active",value:active},{label:"Directory listed",value:listed},{label:"Community members",value:members}].map(function(x){return '<div class="admin-community-stat"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong></div>';}).join("");}
    var rows=communities.filter(function(w){
      if(status!=="all"&&w.status!==status)return false;
      return !q||[w.name,w.community_username,w.id].join(" ").toLowerCase().indexOf(q)!==-1;
    });
    if(!rows.length){box.innerHTML='<p class="empty">Koi community nahi mili.</p>';return;}
    var shown=rows.slice(0,adminCommunityShown);
    box.innerHTML=shown.map(function(w){
      var suspended=w.status!=="active";
      return '<article class="admin-user-card admin-community-card">'+
        '<div class="admin-community-head"><div><strong>'+esc(w.name)+'</strong><small>@'+esc(w.community_username||"not-set")+'</small></div><span class="admin-user-status '+(suspended?'blocked':'active')+'">'+esc(w.status)+'</span></div>'+
        '<div class="admin-user-meta"><span>'+Number(w.member_count||0)+' members</span><span>'+Number(w.transaction_count||0)+' records</span><span>'+esc(fmtRs(w.transaction_volume||0))+'</span></div>'+
        '<div class="admin-user-meta"><span>'+(w.password_configured?'Password protected':'Password missing')+'</span><span>'+(w.community_listed?'Directory listed':'Unlisted')+'</span><span>'+Number(w.contact_count||0)+' contacts</span></div>'+
        '<div class="admin-user-actions"><button class="btn btn-soft btn-mini" data-admin-community-edit="'+esc(w.id)+'" type="button">Edit</button>'+
        '<button class="btn btn-soft btn-mini" data-admin-community-status="'+esc(w.id)+'" data-next-status="'+(suspended?'active':'suspended')+'" type="button">'+(suspended?'Restore':'Suspend')+'</button>'+
        '<button class="btn btn-danger btn-mini" data-admin-community-delete="'+esc(w.id)+'" type="button">Delete if empty</button></div>'+
        '<div class="admin-community-add-member"><input type="email" data-admin-add-email="'+esc(w.id)+'" placeholder="Existing user email">'+
        '<select data-admin-add-role="'+esc(w.id)+'"><option value="staff">Staff</option><option value="accountant">Accountant</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>'+
        '<button class="btn btn-primary btn-mini" data-admin-add-member="'+esc(w.id)+'" type="button">Add member</button></div></article>';
    }).join("")+(rows.length>shown.length?'<button class="btn btn-soft btn-block" id="adminCommunityMoreBtn" type="button">Show more — '+(rows.length-shown.length)+' baqi</button>':"");
    var commMoreBtn=$("adminCommunityMoreBtn");
    if(commMoreBtn)commMoreBtn.addEventListener("click",function(){adminCommunityShown+=20;renderAdminCommunities();});
    cdAttachIn(box); // v73: per-row role picker bhi custom dropdown
  }
  function renderAdminCommunityMembers() {
    var box=$("adminCommunityMemberList");if(!box)return;
    var q=String($("adminMemberSearch").value||"").trim().toLowerCase();
    var communityId=$("adminMemberCommunityFilter")?$("adminMemberCommunityFilter").value:"";
    var rows=adminWorkspaceMembers.filter(function(m){
      if(communityId&&m.workspace_id!==communityId)return false;
      return !q||[m.workspace_name,m.user_name,m.user_email,m.user_phone,m.role,m.member_status].join(" ").toLowerCase().indexOf(q)!==-1;
    });
    var countEl=$("adminCommunityMemberCount");
    if(countEl)countEl.textContent=rows.length?rows.length+" members"+(q||communityId?" — filtered":""):"";
    if(!rows.length){box.innerHTML='<p class="empty">Koi community member nahi mila.</p>';return;}
    var shown=rows.slice(0,adminCommunityMemberShown);
    box.innerHTML=shown.map(function(m){
      var owner=m.role==="owner";
      var initial=String(m.user_name||m.user_email||"?").trim().charAt(0).toUpperCase()||"?";
      return '<article class="admin-user-card admin-community-member-card">'+
        '<div class="admin-community-head"><span class="cm-avatar">'+initial+'</span><div><strong>'+esc(m.user_name||m.user_email||"Member")+'</strong><small>'+esc(m.user_email||"")+' · '+esc(m.workspace_name)+'</small></div><span class="cm-role-chip role-'+esc(String(m.role||"staff").toLowerCase())+'">'+esc(m.role)+'</span><span class="admin-user-status '+(m.member_status==="active"?"active":"blocked")+'">'+esc(m.member_status)+'</span></div>'+
        '<div class="admin-user-meta"><span>Joined '+esc(fmtDate(m.joined_at))+'</span><span>'+(m.blocked?'Account blocked':'Account active')+'</span></div>'+
        '<div class="admin-community-member-controls"><select aria-label="Role for '+esc(m.user_name||m.user_email||"member")+'" data-admin-member-role="'+esc(m.workspace_id+"|"+m.user_id)+'">'+(owner?'<option value="owner" selected>owner</option>':'')+["admin","accountant","staff","viewer"].map(function(role){return '<option value="'+role+'" '+(m.role===role?'selected':'')+'>'+role+'</option>';}).join("")+'</select>'+
        '<select data-admin-member-status="'+esc(m.workspace_id+"|"+m.user_id)+'">'+["active","suspended","removed"].map(function(st){return '<option value="'+st+'" '+(m.member_status===st?'selected':'')+'>'+st+'</option>';}).join("")+'</select>'+
        '<button class="btn btn-primary btn-mini" data-admin-member-save="'+esc(m.workspace_id+"|"+m.user_id)+'" type="button">Save</button>'+
        (owner?'':'<button class="btn btn-soft btn-mini" data-admin-member-owner="'+esc(m.workspace_id+"|"+m.user_id)+'" type="button">Make owner</button>')+
        '</div></article>';
    }).join("")+(rows.length>shown.length?'<button class="btn btn-soft btn-block" id="adminCommunityMemberMoreBtn" type="button">Show more — '+(rows.length-shown.length)+' baqi</button>':"");
    var moreBtn=$("adminCommunityMemberMoreBtn");
    if(moreBtn)moreBtn.addEventListener("click",function(){adminCommunityMemberShown+=20;renderAdminCommunityMembers();});
    cdAttachIn(box); // v73: per-row role/status picker bhi custom dropdown
  }
  function editAdminCommunity(id) {
    var w=adminWorkspaces.filter(function(x){return x.id===id;})[0];if(!w)return;
    adminEditingWorkspace=w;
    $("adminCommunityName").value=w.name||"";
    $("adminCommunityUsername").value=w.community_username||"";
    $("adminCommunityDescription").value=w.community_description||"";
    $("adminCommunityListed").checked=!!w.community_listed;
    $("adminCommunityPassword").value="";
    adminSetCommunityEditMsg("");
    $("adminCommunityEditOverlay").hidden=false;
  }
  function saveAdminCommunity() {
    if(!isAdmin()||!adminEditingWorkspace)return;
    var name=$("adminCommunityName").value.trim();
    var username=$("adminCommunityUsername").value.trim().toLowerCase();
    var description=$("adminCommunityDescription").value.trim();
    var password=$("adminCommunityPassword").value;
    if(name.length<2||name.length>100||!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)){adminSetCommunityEditMsg("Community name ya username sahi nahi.",false);return;}
    if(password&&password.length<10){adminSetCommunityEditMsg("Naya password kam az kam 10 characters ka ho.",false);return;}
    var btn=$("adminCommunityEditSave");btn.disabled=true;
    sb("rpc/admin_update_workspace",{method:"POST",body:{
      p_workspace_id:adminEditingWorkspace.id,p_name:name,p_username:username,
      p_description:description,p_listed:$("adminCommunityListed").checked,p_password:password||null
    }}).then(function(res){
      btn.disabled=false;
      if(!res.ok){adminSetCommunityEditMsg((res.body&&res.body.message)||"Community update nahi hui.",false);return;}
      $("adminCommunityEditOverlay").hidden=true;adminEditingWorkspace=null;
      setAdminMsg("Community update ho gayi.",true);loadAdminWorkspaceManagement();
    }).catch(function(){btn.disabled=false;adminSetCommunityEditMsg("Connection issue — changes save nahi huay.",false);});
  }
  async function setAdminCommunityStatus(id,status) {
    var w=adminWorkspaces.filter(function(x){return x.id===id;})[0];if(!w)return;
    if(!(await appConfirm((status==="suspended"?"Community suspend":"Community restore")+" karein? Ledger history delete nahi hogi.")))return;
    sb("rpc/admin_set_workspace_status",{method:"POST",body:{p_workspace_id:id,p_status:status}}).then(function(res){
      if(!res.ok){setAdminMsg((res.body&&res.body.message)||"Community status update nahi hua.",false);return;}
      setAdminMsg("Community status update ho gaya.",true);loadAdminWorkspaceManagement();
    }).catch(function(){setAdminMsg("Connection issue — status update nahi hua.",false);});
  }
  async function deleteAdminCommunity(id) {
    var w=adminWorkspaces.filter(function(x){return x.id===id;})[0];if(!w)return;
    if(!(await appConfirm("'"+w.name+"' permanently delete sirf tab hoga jab is mein transactions aur contacts na hon aur sirf ek active member ho. Financial data wali community delete nahi hogi. Continue?")))return;
    sb("rpc/admin_delete_workspace",{method:"POST",body:{p_workspace_id:id}}).then(function(res){
      if(!res.ok){setAdminMsg((res.body&&res.body.message)||"Community delete nahi hui. Data wali community ko suspend karein.",false);return;}
      setAdminMsg("Empty community delete ho gayi.",true);loadAdminWorkspaceManagement();
    }).catch(function(){setAdminMsg("Connection issue — community delete nahi hui.",false);});
  }
  function adminAddCommunityMember(id) {
    var email=$("adminCommunityList").querySelector('[data-admin-add-email="'+id+'"]').value.trim();
    var role=$("adminCommunityList").querySelector('[data-admin-add-role="'+id+'"]').value;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setAdminMsg("Registered user ka valid email likhein.",false);return;}
    sb("rpc/admin_add_workspace_member",{method:"POST",body:{p_workspace_id:id,p_email:email,p_role:role}}).then(function(res){
      if(!res.ok){setAdminMsg((res.body&&res.body.message)||"Member add nahi hua. Email account registered hona chahiye.",false);return;}
      setAdminMsg("User community mein add ho gaya.",true);loadAdminWorkspaceManagement();
    }).catch(function(){setAdminMsg("Connection issue — member add nahi hua.",false);});
  }
  function adminSaveCommunityMember(key) {
    var parts=key.split("|"),id=parts[0],user=parts[1];
    var role=$("adminCommunityMemberList").querySelector('[data-admin-member-role="'+key+'"]').value;
    var status=$("adminCommunityMemberList").querySelector('[data-admin-member-status="'+key+'"]').value;
    sb("rpc/admin_update_workspace_member",{method:"POST",body:{p_workspace_id:id,p_user_id:user,p_role:role,p_status:status}}).then(function(res){
      if(!res.ok){setAdminMsg((res.body&&res.body.message)||"Member update nahi hua. Last owner ko transfer kiye baghair remove nahi kar sakte.",false);return;}
      setAdminMsg("Community member update ho gaya.",true);loadAdminWorkspaceManagement();
    }).catch(function(){setAdminMsg("Connection issue — member update nahi hua.",false);});
  }
  async function adminMakeCommunityOwner(key) {
    var parts=key.split("|");
    if(!(await appConfirm("Is member ko community owner banayein? Current active owner admin ban jayega.")))return;
    sb("rpc/admin_transfer_workspace_owner",{method:"POST",body:{p_workspace_id:parts[0],p_new_owner:parts[1]}}).then(function(res){
      if(!res.ok){setAdminMsg((res.body&&res.body.message)||"Ownership transfer nahi hui.",false);return;}
      setAdminMsg("Community ownership transfer ho gayi.",true);loadAdminWorkspaceManagement();
    }).catch(function(){setAdminMsg("Connection issue — ownership transfer nahi hui.",false);});
  }

  async function deleteUser(id) {
    var p = null;
    adminUsers.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) p = findPerson(id);
    if (!p || id === myId()) return;
    // v24.8: admin kaam online-only — confirm se pehle saaf refusal.
    if (!(await appConfirm("'" + (p.name || p.email) + "' — account deactivate karein?\n\nUn ka login band ho jayega aur community ka access ruk jayega. Purane hisaab mehfooz rahenge."))) return;
    sb("rpc/admin_delete_user", { method: "POST", body: { target_id: id } })
      .then(function (res) {
        if (!res.ok) { setAdminMsg("User delete nahi hua — dobara try karein.", false); return; }
        setAdminMsg("User deactivate ho gaya. Un ka ledger data mehfooz hai.", true);
        if (adminCurrentUser && adminCurrentUser.id === id) {
          adminCurrentUser = null;
          showView("admin");
        }
        loadAll();
      }).catch(function () { setAdminMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
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
    var name = $("adminAddName").value.trim();
    var email = $("adminAddEmail").value.trim();
    var phone = $("adminAddPhone").value.trim();
    var pass = $("adminAddPass").value;
    if (!name) { setAdminAddMsg("Naam likhein.", false); return; }
    if (email.indexOf("@") === -1 || email.indexOf(".") === -1) { setAdminAddMsg("Sahi email likhein.", false); return; }
    if (!pass || pass.length < 8) { setAdminAddMsg("Password kam se kam 8 harf ka ho.", false); return; }
    var btn = $("adminAddSaveBtn");
    btn.disabled = true;
    sb("rpc/admin_create_user", { method: "POST", body: { p_name: name, p_email: email, p_phone: phone, p_password: pass } })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          var msg = (res.body && res.body.message) || "";
          if (msg.indexOf("email already registered") !== -1) setAdminAddMsg("Ye email pehle se registered hai.", false);
          else if (msg.indexOf("not admin") !== -1) setAdminAddMsg("Sirf admin user bana sakta hai.", false);
          else if (msg.indexOf("password too short") !== -1) setAdminAddMsg("Password kam se kam 8 harf ka ho.", false);
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
      }).catch(function () { btn.disabled = false; setAdminAddMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
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
  var adminHiddenByTxn = {}, adminHiddenStatusLoaded = false;
  function renderAdminUserTxnRows(u, mine) {
    if (!mine.length) { $("adminUserTxns").innerHTML = '<p class="empty">Is user ka koi record nahi.</p>'; return; }
    var html = "";
    mine.forEach(function (t) {
      var other = t.payer_id === u.id ? profileName(t.receiver_id) : profileName(t.payer_id);
      var dir = t.payer_id === u.id ? "→ " + other + " (diye)" : "← " + other + " (liye)";
      var lock = isTxnLocked(t), hidden = adminHiddenByTxn[t.id] || [];
      var hiddenText = hidden.length ? '<div class="t-sub">Hidden by: ' + esc(hidden.join(", ")) + '</div>' : (adminHiddenStatusLoaded ? '<div class="t-sub">Visible in both histories</div>' : '<div class="t-sub">Hidden status unavailable</div>');
      var controls = lock ? '<span class="t-lock">🔒 Settled</span>' : '<span class="t-btns"><button class="btn-danger" type="button" data-admin-txn-edit="' + esc(t.id) + '">Edit</button><button class="btn-danger" type="button" data-admin-txn-del="' + esc(t.id) + '">Delete permanently</button></span>';
      html += '<div class="txn"><div class="t-main">' + esc(dir) + '</div><div class="t-sub">' + esc(t.note || "Food") + ' · ' + esc(fmtDate(t.txn_date)) + ' · By: ' + esc(profileName(t.created_by)) + '</div>' + hiddenText + '<div class="t-foot"><span class="t-amt">' + esc(fmtRs(t.amount)) + '</span>' + controls + '</div></div>';
    });
    $("adminUserTxns").innerHTML = html;
  }
  async function adminEditTxn(id) {
    if (!isAdmin()) return;
    var t = txns.find(function (x) { return x.id === id; }); if (!t) return;
    if (isTxnLocked(t)) { setAdminUserMsg(LOCK_MSG, false); return; }
    var amount = await appPrompt("Nayi raqam (Rs):", String(t.amount), {title:"Edit transaction",inputType:"number"}); if (amount === null) return;
    var note = await appPrompt("Note:", t.note || "Food", {title:"Transaction note"}); if (note === null) return;
    var date = await appPrompt("Date (YYYY-MM-DD):", String(t.txn_date || todayLocal()), {title:"Transaction date"}); if (date === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 10000000 || Math.abs(Number(amount) * 100 - Math.round(Number(amount) * 100)) > 1e-7 || !note.trim() || note.trim().length > 500) { setAdminUserMsg("Raqam 2 decimal places tak (zyada se zyada Rs 10,000,000), note 500 harf tak, aur date sahi likhein.", false); return; }
    sb("rpc/admin_update_txn", { method: "POST", body: { p_txn_id: id, p_amount: Number(amount), p_note: note.trim(), p_txn_date: date } }).then(function (res) {
      if (!res.ok) { setAdminUserMsg("Admin update nahi ho saki. Dobara koshish karein.", false); return; }
      t.amount = Number(amount); t.note = note.trim(); t.txn_date = date;
      renderAll(); openAdminUser(adminCurrentUser.id); loadAll();
      setAdminUserMsg("Record update ho gaya.", true);
    }).catch(function (e) { setAdminUserMsg("Record update nahi ho saka. Dobara try karein.", false); });
  }
  async function adminDeleteTxn(id) {
    if (!isAdmin()) return;
    var t = txns.find(function (x) { return x.id === id; }); if (!t) return;
    if (isTxnLocked(t)) { setAdminUserMsg(LOCK_MSG, false); return; }
    if (!(await appConfirm("Ye record dono users ki history se hamesha ke liye delete ho jayega. Isay wapas nahi la sakenge. Kya aap jari rakhna chahte hain?"))) return;
    sb("rpc/admin_delete_txn", { method: "POST", body: { p_txn_id: id } }).then(function (res) {
      if (!res.ok) { setAdminUserMsg("Delete nahi ho saka. Dobara koshish karein.", false); return; }
      txns = txns.filter(function (x) { return x.id !== id; });
      saveCache(); // v86: cache base bhi foran saaf — delta merge row wapas na laye
      renderAll(); openAdminUser(adminCurrentUser.id); loadAll();
      setAdminUserMsg("Record hamesha ke liye delete ho gaya.", true);
    }).catch(function (e) { setAdminUserMsg("Record delete nahi ho saka. Dobara try karein.", false); });
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
    var givenMinor = 0, takenMinor = 0;
    mine.forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === u.id) givenMinor += a;
      if (t.receiver_id === u.id) takenMinor += a;
    });
    var given = moneyFromMinor(givenMinor), taken = moneyFromMinor(takenMinor);
    var net = moneyFromMinor(givenMinor - takenMinor);
    $("adminUserSummary").innerHTML =
      '<div class="sum-card"><span class="sum-label">Diye</span><strong>' + esc(fmtRs(given)) + '</strong></div>' +
      '<div class="sum-card"><span class="sum-label">Liye</span><strong>' + esc(fmtRs(taken)) + '</strong></div>' +
      '<div class="sum-card net"><span class="sum-label">Net (diye − liye)</span><strong>' + esc(fmtRs(net)) + '</strong></div>';
    adminHiddenStatusLoaded = false;
    renderAdminUserTxnRows(u, mine);
    sb("rpc/admin_list_txn_hides", { method: "POST", body: {} }).then(function (res) {
      if (!res.ok) return;
      adminHiddenByTxn = {};
      (res.body || []).forEach(function (row) { if (!adminHiddenByTxn[row.txn_id]) adminHiddenByTxn[row.txn_id] = []; adminHiddenByTxn[row.txn_id].push(row.user_name || row.user_id); });
      adminHiddenStatusLoaded = true;
      if (adminCurrentUser && adminCurrentUser.id === u.id) renderAdminUserTxnRows(u, mine);
    }).catch(function () {});
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
      }).catch(function () { btn.disabled = false; setAdminEditMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
  }
  function saveAdminPass() {
    if (!isAdmin() || !adminCurrentUser) return;
    var p1 = $("adminNewPass1").value;
    var p2 = $("adminNewPass2").value;
    if (!p1 || p1.length < 8) { setAdminPassMsg("Password kam se kam 8 harf ka ho.", false); return; }
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
      }).catch(function () { btn.disabled = false; setAdminPassMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
  }
  async function toggleAdminBlock() {
    if (!isAdmin() || !adminCurrentUser) return;
    var u = adminCurrentUser;
    if (u.id === myId()) { setAdminUserMsg("Khud ko block nahi kar sakte.", false); return; }
    var blocking = !u.blocked;
    if (!(await appConfirm(blocking
      ? ("'" + (u.name || u.email) + "' — BLOCK karein?\n\nWo dobara login nahi kar sakega (un ka data mehfooz rahega).")
      : ("'" + (u.name || u.email) + "' — UNBLOCK karein?")))) return;
    sb("rpc/admin_set_user_blocked", { method: "POST", body: { p_target: u.id, p_blocked: blocking } })
      .then(function (res) {
        if (!res.ok) { setAdminUserMsg("Block update nahi hua — dobara try karein.", false); return; }
        u.blocked = blocking;
        $("adminBlockBtn").textContent = blocking ? "Unblock" : "Block";
        $("adminUserBadges").innerHTML = (u.id === myId() ? '<span class="badge-admin">Admin (you)</span> ' : '') +
          (blocking ? '<span class="badge-blocked">Blocked</span>' : '<span class="badge-admin">Active</span>');
        setAdminUserMsg(blocking ? "User block ho gaya — ab login nahi kar sakega." : "User unblock ho gaya.", true);
        loadAll();
      }).catch(function () { setAdminUserMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
  }

  function setAdminSetMsg(text, ok) {
    var el = $("adminSetMsg");
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function saveAdminSet() {
    if (!isAdmin() || !adminCurrentUser) return;
    var amount = parseFloat($("adminSetAmount").value);
    if (!amount || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) { setAdminSetMsg("Raqam 0 se zyada aur maximum 2 decimal places mein honi chahiye.", false); return; }
    amount = moneyFromMinor(moneyToMinor(amount));
    var dir = (document.querySelector('input[name="adminSetDir"]:checked') || {}).value || "take";
    var note = $("adminSetNote").value.trim() || "Admin ne raqam set ki";
    var me = myId();
    var u = adminCurrentUser;
    var body = {
      payer_id: dir === "take" ? u.id : me,
      receiver_id: dir === "take" ? me : u.id,
      amount: amount, note: note, txn_date: todayLocal(), created_by: me, workspace_id: currentWorkspaceId
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
          triggerPush(u.id, "Admin ne record add kiya", notifBodyFor(created, u.id), created.id);
          txns.unshift(created);
        }
        $("adminSetAmount").value = "";
        $("adminSetNote").value = "";
        setAdminSetMsg("Raqam set ho gayi!", true);
        openAdminUser(u.id);
        loadAll();
      }).catch(function () { btn.disabled = false; setAdminSetMsg("Internet connection nahi mil raha. Dobara koshish karein.", false); });
  }

  function renderMonthStats() {
    var el = $("monthStats");
    if (!visibleTxns().length) { el.hidden = true; return; }
    var s = monthStats(); // v69: computation shared with the share sheet
    el.hidden = false;
    el.innerHTML =
      '<div class="khata-stat-head"><span class="khata-stat-icon" aria-hidden="true">📅</span><div><strong>Is mahine ka hisaab</strong><small>' + esc(s.label) + '</small></div></div>' +
      '<div class="khata-stat-grid">' +
        '<div class="khata-stat-cell is-given"><span>Diye</span><strong>' + esc(fmtRs(s.given)) + '</strong></div>' +
        '<div class="khata-stat-cell is-taken"><span>Liye</span><strong>' + esc(fmtRs(s.taken)) + '</strong></div>' +
        '<div class="khata-stat-cell"><span>Records</span><strong>' + s.count + '</strong></div>' +
      '</div>';
  }

  function renderInsights() {
    var el = $("insightStats");
    var me = myId();
    var mine = visibleTxns().filter(function (t) { return t.payer_id === me || t.receiver_id === me; });
    if (!mine.length) { el.hidden = true; return; }
    var biggest = mine[0], totalMinor = 0;
    var counts = {};
    mine.forEach(function (t) {
      var a = moneyToMinor(t.amount);
      totalMinor += a;
      if (a > moneyToMinor(biggest.amount)) biggest = t;
      var other = t.payer_id === me ? t.receiver_id : t.payer_id;
      counts[other] = (counts[other] || 0) + 1;
    });
    var topId = null, topN = 0;
    Object.keys(counts).forEach(function (id) { if (counts[id] > topN) { topN = counts[id]; topId = id; } });
    var avg = moneyFromMinor(Math.round(totalMinor / mine.length));
    el.hidden = false;
    el.innerHTML =
      '<div class="khata-stat-head"><span class="khata-stat-icon" aria-hidden="true">📊</span><div><strong>Hisaab ki jhalak</strong><small>Aap ke tamam visible records</small></div></div>' +
      '<div class="khata-insight-grid">' +
        '<div class="khata-insight-cell"><span>Sab se bara record</span><strong>' + esc(fmtRs(biggest.amount)) + '</strong><small>' + esc(biggest.note || "Detail nahi") + ' · ' + esc(fmtDate(biggest.txn_date)) + '</small></div>' +
        '<div class="khata-insight-cell"><span>Sab se zyada len-den</span><strong>' + esc(profileName(topId) || "—") + '</strong><small>' + topN + ' dafa</small></div>' +
        '<div class="khata-insight-cell"><span>Aosat raqam</span><strong>' + esc(fmtRs(avg)) + '</strong><small>Har record ki average</small></div>' +
      '</div>';
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
  // v24.4: tooti/khali pic par initials fallback — kabhi toota image icon na
  // dikhe (header, account card, person detail, DOST list — har jagah).
  function jsq(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
  function avatarHtml(url, initial) {
    var ini = initial || "?";
    // v82: CSP — inline onerror attribute hata diya; fallback data-fallback
    // par hai, document-level error listener (capture) img ko initial se badalta hai
    if (url) return '<img src="' + esc(url) + '" alt="" data-fallback="' + esc(ini) + '">';
    return esc(ini);
  }
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.getAttribute && t.getAttribute("data-fallback") != null) {
      var ini = t.getAttribute("data-fallback");
      if (t.parentNode) t.parentNode.replaceChild(document.createTextNode(ini), t);
    }
  }, true); // capture — img error events bubble nahi karte
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
  // v24.11: access token 1 ghante ka hota hai. Save se pehle check karein —
  // expired ho to refresh_token se naya lein (authValidate wala flow);
  // refresh na ho to false (caller dobara login ka message dikhaye).
  function ensureFreshToken() {
    if (!session || !session.access_token) return Promise.resolve(false);
    var expMs = Number(session.expires_at) || 0;
    if (expMs && expMs < 1e12) expMs *= 1000; // GoTrue expires_at seconds mein deta hai
    if (expMs && expMs - Date.now() > 60000) return Promise.resolve(true);
    if (!session.refresh_token) {
      // Expiry unknown aur refresh ka rasta nahi — save try karein, 401 par
      // dobara-login ka message aayega (token shayad abhi valid ho).
      return Promise.resolve(!expMs);
    }
    return authCall("/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (res) {
        if (res.ok && res.body && res.body.access_token) {
          if (!res.body.user && session.user) res.body.user = session.user;
          saveSession(res.body);
          return true;
        }
        return false;
      });
    // NOTE: yahan .catch nahi — refresh ka network throw caller tak jaye
    // (saveProfile ka isNetErr mapping), taake network failure kabhi
    // "session khatam" na dikhe.
  }
  function isNetErr(e) {
    return !!e && (e.name === "TypeError" || e.message === "request-timeout" || /failed to fetch|networkerror|network request failed|load failed|network offline/i.test(String(e.message || "")));
  }
  function isTransientResponse(res) {
    return !!res && (res.status === 408 || res.status === 429 || res.status >= 500);
  }
  function saveErrDetail(res) {
    // Server ne save kyun mana kiya — asal wajah dikhao, sirf
    // "dobara try karein" nahi (v68: Personal save ka 403 isi liye
    // ghanton chhupa raha).
    var m = res && res.body && (res.body.message || res.body.error);
    m = m ? String(m).slice(0, 120) : "";
    return m ? ": " + m : "";
  }
  function markConnectionIssue() {
    // v68: server ne jawab de diya (408/429/5xx) = internet maujood hai,
    // is liye offlineMode NAHI lagate — pehle yehi ghalat badge
    // "Internet nahi hai" lagata tha. Sirf pending count update karo;
    // record waise bhi outbox mein queue ho jata hai.
    renderOffline();
  }
  // v24.11: network throw par aik dafa retry (upload + PATCH dono idempotent
  // hain — upload path pehle se fixed hai, PATCH/upsert dobara safe hai).
  function withNetRetry(fn, triesLeft) {
    return fn().catch(function (e) {
      if (triesLeft > 0 && isNetErr(e)) return withNetRetry(fn, triesLeft - 1);
      throw e;
    });
  }

  function uploadAvatar(file, path) {
    return downscaleImage(file).then(function (blob) {
      path = path || (myId() + "/" + Date.now() + ".jpg");
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
    // v24.11: offline pre-check hata diya — navigator.onLine ka ghalat false
    // flag save rok deta tha jabke internet theek tha (yehi Toseef ke case
    // ka sab se likely cause hai: koi network call hue baghair hi "internet
    // check karein" dikh gaya). Ab seedha save try hota hai; network throw
    // par aik dafa retry, aur har failure ki ASLI wajah dikhai jati hai
    // (session khatam / permission / network) — 401/403 kabhi "internet"
    // ka message nahi banenge.
    var btn = $("savePhoneBtn");
    btn.disabled = true;
    setPhoneMsg("Profile save ho rahi hai…", true);
    // Upload path aik dafa banayein — retry par wahi path dobara use ho
    // (x-upsert se dobara upload safe hai).
    var avatarPath = pendingAvatarFile ? (myId() + "/" + Date.now() + ".jpg") : null;
    ensureFreshToken().then(function (fresh) {
      if (!fresh) throw new Error("session-expired");
      var doSave = function () {
        var checkUsername = username
          ? sb("khata_profiles?select=id&username=ilike." + encodeURIComponent(username.replace(/%/g, "\\%").replace(/_/g, "\\_")) + "&id=neq." + encodeURIComponent(myId()), {})
            .then(function (res) {
              if (res.ok && res.body && res.body.length) throw new Error("username-taken");
            })
          : Promise.resolve();
        return checkUsername.then(function () {
          if (pendingAvatarFile) return uploadAvatar(pendingAvatarFile, avatarPath);
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
            if (!res.ok) throw new Error("profile-save-failed " + res.status);
            if (res.body && res.body.length) return res.body[0];
            // No profile row exists — PATCH silently does nothing, so create it.
            var up = { id: myId(), name: name, email: (session.user && session.user.email) || "", phone: phone || null, username: username || null };
            if (body.avatar_url) up.avatar_url = body.avatar_url;
            return sb("khata_profiles?on_conflict=id", {
              method: "POST",
              prefer: "resolution=merge-duplicates,return=minimal",
              body: up
            }).then(function (res2) {
              if (!res2.ok) throw new Error("profile-save-failed " + res2.status);
              return up;
            });
          }).then(function (saved) {
            // Auth metadata bhi sync karein (header ka naam wahi se aata hai).
            return updateUserMeta({ full_name: name, phone: phone || "" }).then(function () { return saved; }, function () { return saved; });
          });
        });
      };
      return withNetRetry(doSave, 1);
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
      var m = (e && e.message) || "";
      if (m === "username-taken") setPhoneMsg("Ye username kisi aur ne liya hua hai — koi aur chunein.", false);
      // v24.11 (v24.5 wala saveReason pattern): 401/403 = session khatam —
      // kabhi "internet check karein" nahi; network throw = internet;
      // baaki = dobara try karein (bina internet ka ilzaam).
      else if (m === "session-expired" || /^profile-save-failed (401|403)/.test(m) || /^upload failed (401|403)/.test(m)) setPhoneMsg("Session khatam ho gaya — dobara login karein.", false);
      else if (/^upload failed/.test(m)) setPhoneMsg("Photo upload nahi hui — dobara try karein.", false);
      else if (isNetErr(e)) setPhoneMsg("Internet se rabta nahi ho raha — dobara try karein.", false);
      else setPhoneMsg("Profile save nahi hui — dobara try karein.", false);
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

  /* ---------- Balance hide/show (v66) ---------- */
  // TOTAL BALANCE ke upar chhota eye button: tap karo to dono cardon ki
  // raqam chhup jati hai ("Rs ••••••") — aas-paas koi dekh raha ho to kaam
  // aata hai. Pasand is device par save rehti hai (localStorage), dobara
  // kholo to wahi haal milta hai. Sirf TOTAL BALANCE card chhupte hain;
  // DOST list ki raqam waisi hi dikhti hai.
  var BALANCE_HIDE_KEY = "easykhata_hide_balance";
  function balanceHidden() {
    try { return window.localStorage.getItem(BALANCE_HIDE_KEY) === "1"; } catch (e) { return false; }
  }
  function renderBalanceEye() {
    var btn = $("balanceEyeBtn");
    if (!btn) return;
    var hidden = balanceHidden();
    btn.textContent = hidden ? "🙈" : "👁️";
    btn.setAttribute("aria-pressed", hidden ? "true" : "false");
    btn.setAttribute("aria-label", hidden ? "Balance dikhayein" : "Balance chhupayein");
    btn.title = hidden ? "Balance dikhayein" : "Balance chhupayein";
  }
  function toggleBalanceEye() {
    try { window.localStorage.setItem(BALANCE_HIDE_KEY, balanceHidden() ? "0" : "1"); } catch (e) {}
    renderBalanceEye();
    renderSummary();
    renderPeople(); // v76: eye DOST list ki raqam bhi chhupata/dikhata hai
  }

  function renderSummary() {
    // TOTAL BALANCE: two cards — what I have to receive (lene hain, green)
    // and what I have to give (dene hain, red). Per-person nets, not totals.
    var map = peopleMap();
    var toReceiveMinor = 0, toPayMinor = 0, rc = 0, pc = 0;
    Object.keys(map).forEach(function (id) {
      var netMinor = map[id].givenMinor - map[id].takenMinor;
      if (netMinor > 0) { toReceiveMinor += netMinor; rc++; }
      else if (netMinor < 0) { toPayMinor += -netMinor; pc++; }
    });
    var hide = balanceHidden();
    $("sumReceive").textContent = hide ? "Rs ••••••" : fmtRs(moneyFromMinor(toReceiveMinor));
    $("sumReceiveCount").textContent = rc ? rc + (rc === 1 ? " dost se" : " doston se") : "Koi nahi";
    $("sumPay").textContent = hide ? "Rs ••••••" : fmtRs(moneyFromMinor(toPayMinor));
    $("sumPayCount").textContent = pc ? pc + (pc === 1 ? " dost ko" : " doston ko") : "Koi nahi";
    renderBalanceEye();
  }

  function personStats(id) {
    var givenMinor = 0, takenMinor = 0;
    balanceTxns().forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === myId() && t.receiver_id === id) givenMinor += a;
      if (t.receiver_id === myId() && t.payer_id === id) takenMinor += a;
    });
    var given = moneyFromMinor(givenMinor), taken = moneyFromMinor(takenMinor);
    return { given: given, taken: taken, net: moneyFromMinor(givenMinor - takenMinor) }; // +: they owe me, -: I owe them
  }
  function latestTxnWith(id) {
    // Most recent record between me and this person (by date, then by creation time).
    var me = myId(), best = null;
    visibleTxns().forEach(function (t) {
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
    visibleTxns().forEach(function (t) {
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
  // v84: aik hi alert-box design — legacy confirmOverlay hata diya; sab
  // confirmations appDialog (app-styled, z-3000, blur backdrop) se hote hain.
  function askConfirm(title, text, okLabel, cb) {
    appDialog(text, { mode: "confirm", title: title, okText: okLabel || "Confirm" }).then(function (v) { if (v && cb) cb(); });
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
      created_by: me,
      workspace_id: currentWorkspaceId
    };
    if (guestMode) {
      // v24: guest settlement — sirf local; settled-lock yahan bhi lagta hai.
      txns.unshift(Object.assign({ created_at: new Date().toISOString() }, body));
      saveGuestStore();
      renderAll();
      setPeopleMsg("Hisaab barabar ho gaya!", true);
      return;
    }
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: body })
      .then(function (res) {
        if (!res.ok) {
          if(isTransientResponse(res)){markConnectionIssue();offlineTxnInsert(body);setPeopleMsg("Server se rabta nahi ho saka" + saveErrDetail(res) + ". Hisaab phone mein save ho gaya; thodi der mein khud update ho jayega.",true);return;}
          setPeopleMsg("Hisaab barabar nahi ho saka" + saveErrDetail(res) + " — dobara try karein.", false); return;
        }
        var created = res.body && res.body[0];
        if (created) { sendNotif(id, "settle", created); triggerPush(id, "Hisaab barabar ho gaya", notifBodyFor(created, id), created.id); }
        setPeopleMsg("Hisaab barabar ho gaya!", true);
        loadAll();
      }).catch(function () {
        offlineTxnInsert(body);
        setPeopleMsg("Hisaab save ho gaya. Internet aate hi update ho jayega.", true);
      });
    });
  }
  function shareAll() {
    // v62.1 (user order 2026-11-08): "Share Easy Khata" mein SIRF link + chhota
    // message jaye — poora balance (Debit/Credit/Net/Latest) kabhi share na ho.
    // Per-person Share (personShareText) aur WhatsApp Remind (personShortText)
    // waisi hi hain — dost se hisaab barabar karne ke liye un mein rakam zaroori hai.
    var text = "Easy Khata — apna rozmarra ka hisaab aasani se rakhein!\n\nEasy Khata: " + APP_SHORT_URL;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    copyText(text).then(function () { setTxnMsg("Link copy ho gaya — kisi bhi app mein paste karein.", true); });
  }

  /* ---------- Share sheet (v69) ---------- */
  // "Apna balance share karein" button pehle shareAll() chalata tha — v63
  // ke baad woh sirf link bhejta tha, jab ke button ka naam balance kehta
  // hai. Ab sheet khulti hai: user chune ke kya share karna hai, preview
  // dekhe, phir share kare. Default "Sirf app link" (safe) — balance sirf
  // tab jaye jab user khud use chune aur preview dekh le (v63 privacy barkarar).
  function myTotals() {
    // Gross totals (TOTAL BALANCE cards wale netted sums NAHI — woh per-person
    // net ka sum hain; yahan kul diye / kul liye chahiye, jaise purana
    // "My Food Balance" text karta tha).
    var givenMinor = 0, takenMinor = 0;
    visibleTxns().forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === myId()) givenMinor += a;
      if (t.receiver_id === myId()) takenMinor += a;
    });
    return { given: moneyFromMinor(givenMinor), taken: moneyFromMinor(takenMinor), net: moneyFromMinor(givenMinor - takenMinor) };
  }
  function myBalanceShareText() {
    var s = myTotals();
    var netLine = s.net > 0 ? "Net: " + fmtRs(s.net) + " — I will receive."
      : s.net < 0 ? "Net: " + fmtRs(-s.net) + " — I have to pay." : "Net: settled up — no balance.";
    var latest = latestLine(latestTxn());
    return "Easy Khata — My Food Balance\n" + myName() + "\n\n" +
      "Debit (I gave): " + fmtRs(s.given) + "\n" +
      "Credit (I took): " + fmtRs(s.taken) + "\n\n" +
      netLine + "\n" +
      (latest ? "\n" + latest + "\n" : "") +
      "\nEasy Khata: " + APP_SHORT_URL;
  }
  function monthStats() {
    var now = todayLocal().slice(0, 7);
    var givenMinor = 0, takenMinor = 0, count = 0;
    visibleTxns().forEach(function (t) {
      if (String(t.txn_date || "").slice(0, 7) !== now) return;
      if (t.payer_id !== myId() && t.receiver_id !== myId()) return;
      var a = moneyToMinor(t.amount);
      count++;
      if (t.payer_id === myId()) givenMinor += a;
      if (t.receiver_id === myId()) takenMinor += a;
    });
    return { label: monthName(now + "-01"), given: moneyFromMinor(givenMinor), taken: moneyFromMinor(takenMinor), count: count };
  }
  function monthShareText() {
    var s = monthStats();
    return "Easy Khata — Is mahine ka hisaab (" + s.label + ")\n" + myName() + "\n\n" +
      "Diye: " + fmtRs(s.given) + "\n" +
      "Liye: " + fmtRs(s.taken) + "\n" +
      "Records: " + s.count + "\n\n" +
      "Easy Khata: " + APP_SHORT_URL;
  }
  var shareSheetKind = "link";
  function shareSheetText(kind) {
    if (kind === "balance") return myBalanceShareText();
    if (kind === "month") return monthShareText();
    return "Easy Khata — apna rozmarra ka hisaab aasani se rakhein!\n\nEasy Khata: " + APP_SHORT_URL;
  }
  function renderShareSheet() {
    var opts = document.querySelectorAll("#shareSheetOverlay .share-sheet-opt");
    opts.forEach(function (o) {
      var active = o.getAttribute("data-share-kind") === shareSheetKind;
      o.classList.toggle("is-active", active);
      o.setAttribute("aria-checked", active ? "true" : "false");
    });
    $("shareSheetPreview").textContent = shareSheetText(shareSheetKind);
  }
  function openShareSheet() {
    shareSheetKind = "link";
    renderShareSheet();
    $("shareSheetOverlay").hidden = false;
  }
  function closeShareSheet() { $("shareSheetOverlay").hidden = true; }

  /* ---------- Rate Easy Khata (v64) ---------- */
  // "Rate Easy Khata" pehle sirf promo text share karta tha — ab asal star
  // rating hai: 5 sitare + optional rai. Save: hamesha localStorage (guest
  // bhi); logged-in ho to Supabase khata_ratings mein upsert bhi (best effort,
  // fail ho to bhi rating local mehfooz rehti hai). Guest mode mein ZERO network.
  var RATING_KEY = "easykhata_my_rating";
  function myRating() {
    try {
      var r = JSON.parse(window.localStorage.getItem(RATING_KEY) || "null");
      return r && r.stars >= 1 && r.stars <= 5 ? r : null;
    } catch (e) { return null; }
  }
  function renderRateState() {
    var btn = $("acctRateBtn");
    if (!btn) return;
    var label = btn.querySelectorAll("span")[1];
    if (!label) return;
    var r = myRating();
    label.textContent = r ? "Rate Easy Khata " + "★".repeat(r.stars) + "☆".repeat(5 - r.stars) : "Rate Easy Khata";
  }
  var ratePicked = 0;
  function paintRateStars() {
    var stars = document.querySelectorAll("#rateStars .rate-star");
    stars.forEach(function (b) {
      var n = Number(b.getAttribute("data-stars"));
      b.textContent = n <= ratePicked ? "★" : "☆";
      b.classList.toggle("lit", n <= ratePicked);
      b.setAttribute("aria-checked", n === ratePicked ? "true" : "false");
    });
    var submit = $("rateSubmitBtn");
    if (submit) submit.disabled = !ratePicked;
  }
  function openRateDialog() {
    var overlay = $("rateOverlay");
    if (!overlay) return;
    var saved = myRating();
    ratePicked = saved ? saved.stars : 0;
    var fb = $("rateFeedback");
    if (fb) fb.value = saved && saved.feedback ? saved.feedback : "";
    var msg = $("rateMsg");
    if (msg) msg.textContent = "";
    paintRateStars();
    overlay.hidden = false;
    document.body.classList.add("dialog-open");
  }
  function closeRateDialog() {
    var o = $("rateOverlay");
    if (o) o.hidden = true;
    document.body.classList.remove("dialog-open");
  }
  function submitRating() {
    if (!ratePicked) return;
    var feedback = (($("rateFeedback") && $("rateFeedback").value) || "").trim().slice(0, 500);
    var rec = { stars: ratePicked, feedback: feedback, at: new Date().toISOString() };
    try { window.localStorage.setItem(RATING_KEY, JSON.stringify(rec)); } catch (e) {}
    renderRateState();
    closeRateDialog();
    if (!guestMode && session && session.user) {
      sb("khata_ratings?on_conflict=user_id", {
        method: "POST", prefer: "resolution=merge-duplicates",
        body: { user_id: session.user.id, stars: ratePicked, feedback: feedback || null, updated_at: new Date().toISOString() }
      }).catch(function () {});
    }
    if (ratePicked === 5) {
      appConfirm("Shukriya! ★★★★★\n\nAap ko Easy Khata pasand aaya — kya aap ise doston ke saath share karna chahenge?", { title: "Shukriya!", okText: "Share karein", cancelText: "Abhi nahi" }).then(function (ok) { if (ok) shareAll(); });
    } else {
      appDialog("Shukriya! Aap ki rating save ho gayi — aap ki rai se Easy Khata behtar hoga.", { mode: "notice", title: "Shukriya!" });
    }
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
      $("peopleList").innerHTML = guestMode
        ? '<p class="empty">Abhi koi dost nahi — neeche se pehla dost add karein.</p>'
        : '<p class="empty">Abhi koi dost nahi — dost account banayenge to yahan nazar aayenge.</p>';
      if (detailPersonId) renderPersonDetail(); // v86: aakhri dost gaya to khula detail bhi band ho (warna stale rehta)
      return;
    }
    if (!ids.length) {
      $("peopleList").innerHTML = '<p class="empty">Is naam ka koi dost nahi mila.</p>';
      return;
    }
    var html = "";
    var hideAmounts = balanceHidden(); // v76: eye on ho to DOST list ki raqam bhi chhupi
    ids.forEach(function (id) {
      var p = map[id];
      var net = p.net; // +: they owe me, -: I owe them
      var cls = net > 0 ? "pos" : net < 0 ? "neg" : "zero";
      var netText = net > 0 ? "+ " + fmtRs(net) : net < 0 ? "− " + fmtRs(-net) : "Settled";
      if (hideAmounts && net !== 0) netText = "Rs ••••••";
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
    // v24.1: header mein chhota Guest badge + navbar Login icon —
    // dono sirf guest mode mein dikhte hain.
    var gbd = $("guestBadge");
    if (gbd) gbd.hidden = !guestMode;
    var lb = $("loginIconBtn");
    if (lb) lb.hidden = !guestMode;
    setAvatarEl($("acctAvatar"), me && me.avatar_url, initial);
    $("acctName").textContent = name || "—";
    var phoneTxt = myPhone || "Number nahi diya";
    if (me && me.username) phoneTxt += " · @" + me.username;
    $("acctPhone").textContent = phoneTxt;
    // v24: guest mode mein Account sirf guest cheezein dikhata hai — profile
    // edit (server), push button aur privacy (account wali) chhup jate hain.
    var gb = $("guestAcctBox");
    if (gb) gb.hidden = !guestMode;
    if (guestMode) {
      $("acctName").textContent = guestMeName || "Aap";
      // v24.2: profile card ka subtitle ab "Guest mode — bina login ke" NAHI
      // kehta — wohi jumla guest box ki heading mein bhi tha (do baar repeat).
      // Subtitle ab mukhtalif aur chhota hai; poora notice sirf guest box mein.
      $("acctPhone").textContent = "Bina login ke — personal hisaab";
      var gn = $("guestNameInput");
      if (gn) gn.value = guestMeName || "";
    }
    $("acctPushBtn").hidden = guestMode;
    $("acctHiddenBtn").hidden = guestMode;
    $("acctPrivacyBtn").hidden = guestMode;
    $("acctEditBtn").hidden = guestMode;
    // v74: Settings mein guest hisaab transfer ka option — sirf logged-in
    // mode mein; label mein is device ke guest records/dost ki ginti.
    var gt = $("acctGuestTransferBtn");
    if (gt) {
      gt.hidden = guestMode;
      var gg = loadGuestStore();
      var gn = gg ? (gg.txns || []).length : 0, gc = gg ? (gg.contacts || []).length : 0;
      $("acctGuestTransferLabel").textContent = (gn || gc)
        ? ("Guest hisaab transfer karein — " + gn + " records · " + gc + " dost")
        : "Guest hisaab transfer karein";
    }
    renderRateState(); // v64: menu mein apni rating (sitare) dikhao, ho to
    renderWorkspaceBar();
    renderPinLockMenu(); // v78: PIN set ho to label "change / band" + "Abhi lock" dikhao
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
    if (!p) { detailPersonId = null; $("detailName").textContent = "—"; $("detailSince").textContent = ""; $("detailTxns").innerHTML = ""; var bn = $("detailBanner"); if (bn) { bn.className = "detail-banner"; bn.innerHTML = ""; } showView("khata"); return; }
    setDetailPdfMsg(""); // dost badle to purana PDF message na rahe
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
    var runMinor = 0;
    var balById = {};
    asc.forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === me) runMinor += a;
      else if (t.receiver_id === me) runMinor -= a;
      balById[t.id] = moneyFromMinor(runMinor);
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
      } else if (t.payer_id === me || t.receiver_id === me) {
        // v24.11: involved non-creator — sirf apne liye hide (Delete). Admin
        // normal view mein aam user hai — isAdmin() branch hata di gayi.
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
    cdSync(sel); // v73: custom dropdown ka label + menu fresh karo
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
    cdSync(sel); // v73: custom dropdown ka label + menu fresh karo
  }

  function filteredTxns() {
    var q = txnSearchText.trim().toLowerCase();
    return visibleTxns().filter(function (t) {
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
  // v77: JSON backup/restore — poora hisaab (dost + len-den + hidden flags) aik
  // file mein. Backup kabhi delete NAHI karta; restore sirf UPSERT karta hai
  // (PostgREST on_conflict=id + resolution=merge-duplicates), is liye dobara
  // restore karna bhi safe hai — duplicate nahi bante. Guest mode mein sab
  // kuch local hai (ZERO network): export guest store, import usi mein merge.
  var BACKUP_MARKER = "easy-khata-backup";
  function setAcctJsonMsg(text, ok) {
    var el = $("acctJsonMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  function buildBackupJson() {
    var data = {
      app: BACKUP_MARKER, version: 1,
      exported_at: new Date().toISOString(),
      user_id: guestMode ? guestMeId : myId(),
      contacts: (myContacts || []).map(function (c) {
        return { id: c.id, name: c.name, phone: c.phone || null, workspace_id: c.workspace_id || currentWorkspaceId };
      }),
      txns: (txns || []).map(function (t) {
        return { id: t.id, payer_id: t.payer_id, receiver_id: t.receiver_id, amount: t.amount, note: t.note || "", txn_date: t.txn_date, created_by: t.created_by, workspace_id: t.workspace_id, created_at: t.created_at };
      }),
      hidden: Object.keys(hiddenTxnIds)
    };
    return JSON.stringify(data);
  }
  function exportJsonBackup() {
    var blob = new Blob([buildBackupJson()], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, "easy-khata-backup-" + todayLocal() + ".json");
    setAcctJsonMsg("JSON backup download ho gaya (" + (txns || []).length + " records, " + (myContacts || []).length + " dost).", true);
  }
  function parseBackupJson(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return { error: "Ye file Easy Khata ka backup nahi lagti — JSON nahi hai." }; }
    if (!d || d.app !== BACKUP_MARKER || d.version !== 1 || !Array.isArray(d.contacts) || !Array.isArray(d.txns)) {
      return { error: "Ye file Easy Khata ka backup nahi hai." };
    }
    if (d.contacts.length > 5000 || d.txns.length > 10000) return { error: "Backup file bohot bari hai — ye Easy Khata ka backup nahi lagti." };
    var contacts = [], txns = [], hidden = [];
    d.contacts.forEach(function (c) {
      if (c && typeof c.id === "string" && c.id && typeof c.name === "string" && c.name.trim()) {
        contacts.push({ id: c.id, name: String(c.name).slice(0, 200), phone: typeof c.phone === "string" ? c.phone.slice(0, 30) : null, workspace_id: typeof c.workspace_id === "string" ? c.workspace_id : null });
      }
    });
    d.txns.forEach(function (t) {
      if (t && typeof t.id === "string" && t.id && typeof t.payer_id === "string" && t.payer_id
        && typeof t.receiver_id === "string" && t.receiver_id && typeof t.amount === "number"
        && t.amount > 0 && t.amount <= 10000000 && typeof t.txn_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(t.txn_date)) {
        txns.push({ id: t.id, payer_id: t.payer_id, receiver_id: t.receiver_id, amount: t.amount, note: typeof t.note === "string" ? t.note.slice(0, 500) : "", txn_date: t.txn_date.slice(0, 10), created_by: typeof t.created_by === "string" ? t.created_by : null, workspace_id: typeof t.workspace_id === "string" ? t.workspace_id : null, created_at: typeof t.created_at === "string" ? t.created_at : null });
      }
    });
    if (Array.isArray(d.hidden)) d.hidden.forEach(function (id) { if (typeof id === "string" && id) hidden.push(id); });
    return { data: { contacts: contacts, txns: txns, hidden: hidden, meId: typeof d.user_id === "string" ? d.user_id : "" } };
  }
  function restoreBackupOnline(data) {
    var me = myId();
    var cJobs = data.contacts.map(function (c) {
      return sb("khata_contacts?on_conflict=id", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: { id: c.id, owner_id: me, workspace_id: c.workspace_id || currentWorkspaceId, name: c.name, phone: c.phone || null } });
    });
    return Promise.all(cJobs).then(function (cRes) {
      var cOk = cRes.filter(function (r) { return r.ok; }).length;
      var tJobs = data.txns.map(function (t) {
        // created_by hamesha me: RLS insert mein created_by = auth.uid() chahiye;
        // payer/receiver/amount/date waisay hi rehte hain — hisaab same hai.
        return sb("khata_transactions?on_conflict=id", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: { id: t.id, payer_id: t.payer_id, receiver_id: t.receiver_id, amount: t.amount, note: t.note || "", txn_date: t.txn_date, created_by: me, workspace_id: t.workspace_id || currentWorkspaceId, created_at: t.created_at || new Date().toISOString() } });
      });
      return Promise.all(tJobs).then(function (tRes) {
        var tOk = tRes.filter(function (r) { return r.ok; }).length;
        var hJobs = (data.hidden || []).map(function (id) {
          return sb("khata_txn_hidden?on_conflict=txn_id,user_id", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: { txn_id: id, user_id: me } });
        });
        return Promise.all(hJobs).then(function (hRes) {
          var hOk = hRes.filter(function (r) { return r.ok; }).length;
          var failed = (data.contacts.length - cOk) + (data.txns.length - tOk) + ((data.hidden || []).length - hOk);
          loadAll();
          setAcctJsonMsg("Restore ho gaya: " + cOk + "/" + data.contacts.length + " dost, " + tOk + "/" + data.txns.length + " records, " + hOk + " hidden." + (failed ? " " + failed + " fail hue (shayad doosre account ka data ho)." : ""), (cOk + tOk) > 0);
        });
      });
    }).catch(function () {
      setAcctJsonMsg("Restore nahi ho saka — internet check karke dobara koshish karein.", false);
    });
  }
  function restoreBackupGuest(data) {
    // Guest store (local) mein merge — id se dedupe, kuch delete nahi hota.
    // Doosre device ke guest backup ka me.id is device ke guestMeId se map hota
    // hai (wahi pattern jo doGuestMigration mein hai).
    var fileMe = data.meId || "";
    var mapId = function (id) { return id === fileMe ? guestMeId : id; };
    var cSeen = {}, tSeen = {}, hSet = {};
    (myContacts || []).forEach(function (c) { cSeen[c.id] = true; });
    (txns || []).forEach(function (t) { tSeen[t.id] = true; });
    Object.keys(hiddenTxnIds).forEach(function (id) { hSet[id] = true; });
    var cNew = 0, tNew = 0;
    data.contacts.forEach(function (c) {
      if (cSeen[c.id]) return;
      myContacts.push({ id: c.id, name: c.name, phone: c.phone || null });
      cSeen[c.id] = true; cNew++;
    });
    data.txns.forEach(function (t) {
      if (tSeen[t.id]) return;
      txns.push({ id: t.id, payer_id: mapId(t.payer_id), receiver_id: mapId(t.receiver_id), amount: t.amount, note: t.note || "", txn_date: t.txn_date, created_by: mapId(t.created_by || ""), created_at: t.created_at || new Date().toISOString() });
      tSeen[t.id] = true; tNew++;
    });
    (data.hidden || []).forEach(function (id) { hSet[id] = true; });
    hiddenTxnIds = hSet;
    saveGuestStore();
    renderAll();
    setAcctJsonMsg("Restore ho gaya: " + cNew + " naye dost, " + tNew + " naye records. Pehle wala hisaab waisa hi hai.", true);
  }
  function onJsonRestoreFile(ev) {
    var input = ev.target;
    var file = input && input.files && input.files[0];
    if (input) input.value = ""; // dobara wohi file chuni ja sake
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setAcctJsonMsg("File bohot bari hai (5 MB se zyada) — backup file chhoti hoti hai.", false); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseBackupJson(String(reader.result || ""));
      if (parsed.error) { setAcctJsonMsg(parsed.error, false); return; }
      if (guestMode) restoreBackupGuest(parsed.data);
      else restoreBackupOnline(parsed.data);
    };
    reader.onerror = function () { setAcctJsonMsg("File parhi nahi gayi — dobara koshish karein.", false); };
    reader.readAsText(file);
  }
  // v78: PIN Lock — 4-digit app lock. Phone kisi ko do to hisaab na dikhe.
  // IMAANDARI NOTE: PIN sirf casual snooping se bachata hai — ye encryption
  // NAHI hai. PIN ka raw text KAHIN save nahi hota, sirf salt+hash
  // (cyrb53) localStorage mein rehta hai. Asal recovery account ka password
  // hai: PIN bhool jao to logout → dobara login → PIN dobara set karo.
  // Guest mode mein koi password nahi hota, is liye wahan PIN bhool jane ka
  // matlab hai guest hisaab DELETE (reset se pehle saaf bataya jata hai).
  var PIN_KEY = "easykhata_pin_v1";
  function pinHash(pin, salt) {
    var s = salt + ":" + pin, h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
  }
  function pinStored() {
    try {
      var r = JSON.parse(window.localStorage.getItem(PIN_KEY) || "null");
      return (r && typeof r.salt === "string" && typeof r.hash === "string") ? r : null;
    } catch (e) { return null; }
  }
  function pinIsSet() { return !!pinStored(); }
  function pinCheck(pin) { var s = pinStored(); return !!s && pinHash(pin, s.salt) === s.hash; }
  function pinSet(pin) {
    var salt = newUuid();
    try { window.localStorage.setItem(PIN_KEY, JSON.stringify({ salt: salt, hash: pinHash(pin, salt) })); } catch (e) {}
  }
  function pinClear() { try { window.localStorage.removeItem(PIN_KEY); } catch (e) {} }
  var pinFails = 0, pinLockedUntil = 0, pinHiddenAt = 0, pinLockCountdownId = 0;
  function stopPinLockCountdown() { if (pinLockCountdownId) { clearInterval(pinLockCountdownId); pinLockCountdownId = 0; } } // v86
  function showPinLock() {
    var o = $("pinLockOverlay");
    if (!o) return;
    pinFails = 0;
    stopPinLockCountdown(); // v86: purana countdown na chale
    var msg = $("pinLockMsg"); if (msg) msg.textContent = "";
    var inp = $("pinLockInput");
    inp.value = ""; inp.disabled = false;
    $("pinLockUnlockBtn").disabled = false;
    o.hidden = false;
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
  }
  function hidePinLock() { var o = $("pinLockOverlay"); if (o) o.hidden = true; }
  function maybeShowPinLock() { if (pinIsSet()) showPinLock(); }
  function tryPinUnlock() {
    var inp = $("pinLockInput");
    var pin = (inp.value || "").trim();
    var msg = $("pinLockMsg");
    if (Date.now() < pinLockedUntil) { msg.textContent = "Bohot koshishen — thodi der ruk kar dobara try karein."; return; }
    if (!/^\d{4}$/.test(pin)) { msg.textContent = "4-digit PIN likhein."; return; }
    if (pinCheck(pin)) { pinFails = 0; stopPinLockCountdown(); hidePinLock(); return; }
    pinFails++;
    inp.value = "";
    shakeAppDialog(); // v86: ghalat PIN par halki si shake
    if (pinFails >= 5) {
      pinLockedUntil = Date.now() + 30000;
      $("pinLockUnlockBtn").disabled = true;
      var remain = 30; // v86: live countdown (30, 29, 28...)
      msg.textContent = "5 dafa ghalat PIN — " + remain + " second ruk kar dobara try karein.";
      stopPinLockCountdown();
      pinLockCountdownId = setInterval(function () {
        remain--;
        if (remain <= 0) {
          stopPinLockCountdown();
          $("pinLockUnlockBtn").disabled = false;
          msg.textContent = "";
          var inp2 = $("pinLockInput");
          if (inp2) { inp2.value = ""; try { inp2.focus(); } catch (e) {} }
          return;
        }
        msg.textContent = "5 dafa ghalat PIN — " + remain + " second ruk kar dobara try karein.";
      }, 1000);
    } else {
      msg.textContent = "Ghalat PIN hai (" + pinFails + "/5).";
    }
  }
  async function pinForgot() {
    if (guestMode) {
      var okG = await appConfirm("Guest mode mein PIN bhool jane par hisaab wapas NAHI mil sakta. Reset karne se is device ka guest hisaab DELETE ho jayega. Pakka reset karein?", { title: "PIN bhool gaye?", okText: "Haan, reset karein", cancelText: "Wapas" });
      if (!okG) return;
      pinClear();
      try { window.localStorage.removeItem(GUEST_KEY); } catch (e) {}
      window.location.reload();
      return;
    }
    var ok = await appConfirm("PIN reset karne ke liye logout hona parega. Dobara login karne ke baad PIN dobara set kar sakte hain. Aap ka hisaab account mein mehfooz hai.", { title: "PIN bhool gaye?", okText: "Logout karein", cancelText: "Wapas" });
    if (!ok) return;
    pinClear();
    saveSession(null);
    hidePinLock();
    showAuth();
  }
  // v86: PIN setup — aik hi dialog mein saare steps (stayOpen): pehla
  // PIN dalne ke baad confirm wala page khulte waqt KOI blink/refresh nahi
  // (overlay band nahi hota, keyboard bhi khula rehta hai). Ghalat PIN ya
  // mismatch par flow ABORT nahi hota — usi dialog mein dobara mauka milta
  // hai (shake + error message). 4 digits type karte hi auto-Continue.
  async function managePinLock() {
    var PIN_OPTS = { title: "PIN Lock", inputType: "password", okText: "Continue", cancelText: "Wapas", stayOpen: true, autoSubmitLength: 4, inputmode: "numeric", maxlength: 4 };
    function pinStep(msg, okText) {
      var o = Object.assign({}, PIN_OPTS, { okText: okText || "Continue" });
      return appPrompt(msg, "", o);
    }
    if (pinIsSet()) {
      var curMsg = "Maujooda PIN likhein:";
      while (true) {
        var cur = await pinStep(curMsg, "Continue");
        if (cur === null) return;
        if (pinCheck((cur || "").trim())) break;
        shakeAppDialog();
        curMsg = "Ghalat PIN hai — dobara try karein:";
      }
      var nextMsg = "Naya 4-digit PIN likhein (PIN band karne ke liye khali chhorein):";
      var next = "";
      while (true) {
        next = await pinStep(nextMsg, "Continue");
        if (next === null) return;
        next = (next || "").trim();
        if (next === "" || /^\d{4}$/.test(next)) break;
        shakeAppDialog();
        nextMsg = "PIN sirf 4 digits ka hota hai (jaise 1234):";
      }
      if (next === "") {
        var off = await appConfirm("PIN Lock band kar dein? Is ke baad app khulte hi PIN nahi poochha jayega.", { title: "PIN Lock", okText: "Band karein", cancelText: "Wapas" });
        if (!off) return;
        pinClear();
        renderPinLockMenu();
        await appDialog("PIN Lock band ho gaya.", { mode: "notice", title: "PIN Lock" });
        return;
      }
      var againMsg = "Naya PIN dobara likhein:";
      while (true) {
        var again = await pinStep(againMsg, "Save karein");
        if (again === null) return;
        if ((again || "").trim() === next) break;
        shakeAppDialog();
        againMsg = "Dono PIN same nahi — dobara likhein:";
      }
      pinSet(next);
      renderPinLockMenu();
      await appDialog("PIN change ho gaya. App agli dafa khulte hi PIN poochhega.", { mode: "notice", title: "PIN Lock" });
      return;
    }
    var pin1Msg = "4-digit PIN set karein (jaise 1234):";
    var pin1 = "";
    while (true) {
      pin1 = await pinStep(pin1Msg, "Continue");
      if (pin1 === null) return;
      pin1 = (pin1 || "").trim();
      if (/^\d{4}$/.test(pin1)) break;
      shakeAppDialog();
      pin1Msg = "PIN sirf 4 digits ka hota hai (jaise 1234):";
    }
    var pin2Msg = "PIN dobara likhein:";
    while (true) {
      var pin2 = await pinStep(pin2Msg, "Save karein");
      if (pin2 === null) return;
      if ((pin2 || "").trim() === pin1) break;
      shakeAppDialog();
      pin2Msg = "Dono PIN same nahi — dobara likhein:";
    }
    pinSet(pin1);
    renderPinLockMenu();
    await appDialog("PIN Lock set ho gaya. App agli dafa khulte hi PIN poochhega — aur Account se abhi bhi lock kar sakte hain.", { mode: "notice", title: "PIN Lock" });
  }
  function renderPinLockMenu() {
    var label = $("acctPinLockLabel");
    if (label) label.textContent = pinIsSet() ? "PIN Lock — change / band karein" : "PIN Lock set karein";
    var lockBtn = $("acctLockNowBtn");
    if (lockBtn) lockBtn.hidden = !pinIsSet();
  }
  // Auto-relock: app 10 minute se zyada background mein rahi to wapas aate
  // hi PIN poochho (phone kisi ko dene wali surat mein).
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { pinHiddenAt = Date.now(); }
    else if (pinHiddenAt && Date.now() - pinHiddenAt > 10 * 60 * 1000) { pinHiddenAt = 0; maybeShowPinLock(); }
  });
  // v75: report libs LAZY load — jsPDF (~364KB) + xlsx-js-style (~425KB)
  // pehli visit par download NAHI hote; sirf jab export button dabao.
  // SRI hash wahi jo index.html ke (hataye gaye) tags par tha. SW CDN_LIBS
  // inhein pehli use ke baad offline ke liye cache karta hai. Load fail ho
  // to promise null deta hai aur agli koshish dobara try karti hai.
  var REPORT_LIBS = {
    jspdf: { url: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js", integrity: "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk", global: function () { return (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null; } },
    xlsx: { url: "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", integrity: "sha384-OUW9euuUyxyHcAhTqbhI+Iyb8LMssXt/cpz0yXhs9UWG2/R/uaWdakx/4cfww7Vb", global: function () { return window.XLSX || null; } }
  };
  var reportLibLoading = {};
  function ensureReportLib(kind) {
    var lib = REPORT_LIBS[kind];
    var existing = lib.global();
    if (existing) return Promise.resolve(existing);
    if (reportLibLoading[kind]) return reportLibLoading[kind];
    reportLibLoading[kind] = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = lib.url; s.setAttribute("integrity", lib.integrity); s.setAttribute("crossorigin", "anonymous"); s.async = true;
      s.onload = function () { resolve(lib.global()); };
      s.onerror = function () { reportLibLoading[kind] = null; resolve(null); };
      document.head.appendChild(s);
    });
    return reportLibLoading[kind];
  }
  // Khata screen PDF: current user's own transactions in the active community,
  // respecting the live search, member and date filters. Never export another
  // member's personal ledger just because the community ledger is shared.
  async function exportFilteredLedgerPdf() {
    var PdfCtor = await ensureReportLib("jspdf");
    if (!PdfCtor) { setTxnMsg("PDF tayyar nahi ho saki. Internet check karke dobara try karein.", false); return; }
    try {
      var me = myId();
      var list = filteredTxns().filter(function (t) {
        return t.payer_id === me || t.receiver_id === me;
      }).slice().sort(function (a, b) {
        var d = String(b.txn_date || "").localeCompare(String(a.txn_date || ""));
        return d || String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });
      if (!list.length) { setTxnMsg("Is filter mein aap ka koi record nahi mila.", false); return; }

      var givenMinor = 0, takenMinor = 0, people = {};
      list.forEach(function (t) {
        var amount = moneyToMinor(t.amount);
        var otherId = t.payer_id === me ? t.receiver_id : t.payer_id;
        if (!people[otherId]) people[otherId] = {
          name: profileName(otherId), givenMinor: 0, takenMinor: 0
        };
        if (t.payer_id === me) {
          givenMinor += amount;
          people[otherId].givenMinor += amount;
        } else {
          takenMinor += amount;
          people[otherId].takenMinor += amount;
        }
      });
      var given = moneyFromMinor(givenMinor);
      var taken = moneyFromMinor(takenMinor);
      var net = moneyFromMinor(givenMinor - takenMinor);
      var peopleList = Object.keys(people).map(function (id) {
        var p = people[id];
        p.given = moneyFromMinor(p.givenMinor);
        p.taken = moneyFromMinor(p.takenMinor);
        p.net = moneyFromMinor(p.givenMinor - p.takenMinor);
        return p;
      }).sort(function (a, b) { return b.net - a.net; });

      var active = workspaces.filter(function (w) { return w.id === currentWorkspaceId; })[0];
      var spaceName = active ? active.name : (guestMode ? "Personal hisaab" : "Personal");
      var base = pdfBase(new PdfCtor({ unit: "pt", format: "a4" }));
      var doc = base.doc, M = base.M, R = base.R, C = base.C;
      var rangeText = txnFromDate || txnToDate
        ? "Muddat: " + (txnFromDate ? fmtDate(txnFromDate) : "Shuru se") + " se " + (txnToDate ? fmtDate(txnToDate) : "Aaj tak")
        : "Muddat: Tamam tareekhein";
      var extraFilters = [];
      if (txnFilterPerson) extraFilters.push("Dost: " + profileName(txnFilterPerson));
      if (txnSearchText.trim()) extraFilters.push("Search: " + txnSearchText.trim());

      base.headerBand("Hisaab Report", fmtDateLong(todayLocal()));
      base.metaLine("Naam: " + myName() + "  |  Community: " + spaceName);
      base.metaLine(rangeText + (extraFilters.length ? "  |  " + extraFilters.join("  |  ") : "") + "  |  Aap ke records: " + list.length);
      base.summaryCards([
        { label: "Aap ne diye", value: fmtRs(given), color: C.red },
        { label: "Aap ko mile", value: fmtRs(taken), color: C.green },
        { label: "Net balance", value: netSignedTxt(net), color: C.blue }
      ]);

      base.section("Doston ka hisaab");
      base.metaLine("(+ ka matlab dost aap ko denge, - ka matlab aap dost ko denge)");
      function peopleHead() {
        base.tableHead([
          { t: "Dost", x: M, maxW: 190 },
          { t: "Aap ne diye", x: 310, align: "right", maxW: 76 },
          { t: "Aap ko mile", x: 400, align: "right", maxW: 76 },
          { t: "Balance", x: R, align: "right", maxW: 110 }
        ]);
      }
      peopleHead();
      if (!peopleList.length) base.emptyBox("Abhi koi dost ya record nahi.");
      peopleList.forEach(function (p, i) {
        if (base.needPage(14)) peopleHead();
        base.tableRow([
          { t: p.name || "Unknown", x: M, maxW: 190 },
          { t: fmtRs(p.given), x: 310, align: "right", maxW: 76 },
          { t: fmtRs(p.taken), x: 400, align: "right", maxW: 76 },
          { t: (p.net >= 0 ? "+ " : "- ") + fmtRs(Math.abs(p.net)), x: R, align: "right", maxW: 110 }
        ], i % 2 === 1);
      });
      if (peopleList.length) base.totalsRow([
        { t: "Total", x: M, maxW: 190 },
        { t: fmtRs(given), x: 310, align: "right", maxW: 76 },
        { t: fmtRs(taken), x: 400, align: "right", maxW: 76 },
        { t: netSignedTxt(net), x: R, align: "right", maxW: 110 }
      ]);

      base.section("Len-den ki tafseel (" + list.length + " records)");
      function historyHead() {
        base.tableHead([
          { t: "Tareekh", x: M, maxW: 54 },
          { t: "Dene wala", x: 100, maxW: 105 },
          { t: "Lene wala", x: 214, maxW: 105 },
          { t: "Raqam", x: 420, align: "right", maxW: 72 },
          { t: "Note", x: 430, maxW: 125 }
        ]);
      }
      historyHead();
      var historyTotalMinor = 0;
      list.forEach(function (t, i) {
        if (base.needPage(14)) historyHead();
        historyTotalMinor += moneyToMinor(t.amount);
        base.tableRow([
          { t: fmtDate(t.txn_date), x: M, maxW: 54 },
          { t: profileName(t.payer_id), x: 100, maxW: 105 },
          { t: profileName(t.receiver_id), x: 214, maxW: 105 },
          { t: fmtRs(t.amount), x: 420, align: "right", maxW: 72 },
          { t: t.note || "Food", x: 430, maxW: 125 }
        ], i % 2 === 1);
      });
      base.totalsRow([
        { t: "Total", x: M, maxW: 54 },
        { t: "", x: 100 },
        { t: "", x: 214 },
        { t: fmtRs(moneyFromMinor(historyTotalMinor)), x: 420, align: "right", maxW: 72 },
        { t: "", x: 430 }
      ]);
      base.addFooter();
      var safeName = base.fileName(myName());
      var safeSpace = base.fileName(spaceName);
      var link = document.createElement("a");
      var blob = doc.output("blob");
      link.href = URL.createObjectURL(blob);
      link.download = "Easy-Khata-" + safeName + "-" + safeSpace + "-" + todayLocal() + ".pdf";
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 500);
      setTxnMsg("Aap ki PDF report download ho gayi (" + list.length + " records).", true);
    } catch (e) {
      setTxnMsg("PDF report nahi ban saki. Dobara koshish karein.", false);
    }
  }

  function setAcctBackupMsg(text, ok) {
    var el = $("acctBackupMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  // v24.5: PDF Report — poora hisaab ek saaf professional PDF mein (Account
  // menu mein CSV backup ke saath). v24.9: PROFESSIONAL REDESIGN — navy
  // header band, 3 summary cards, navy table header + zebra rows + totals
  // row, designed empty state. Sirf jsPDF primitives (rect/text/line) — koi
  // extra PDF lib nahi. jsPDF CDN se (UMD) — load na ho to saaf error, kabhi
  // silent fail ya crash nahi. Sirf in-memory data use hoti hai, is liye
  // guest mode mein bhi chalta hai (koi server call nahi).
  // PDF mein sirf Roman Urdu/Latin text hota hai (jsPDF standard font).
  function fullReportData() {
    var me = myId();
    var givenMinor = 0, takenMinor = 0;
    var list = visibleTxns().slice().sort(function (a, b) { return String(b.txn_date || "").localeCompare(String(a.txn_date || "")); });
    list.forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === me) givenMinor += a;
      if (t.receiver_id === me) takenMinor += a;
    });
    var given = moneyFromMinor(givenMinor), taken = moneyFromMinor(takenMinor);
    var map = peopleMap();
    var people = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) { return p.givenMinor + p.takenMinor > 0; });
    people.sort(function (a, b) { return b.net - a.net; });
    return { list: list, given: given, taken: taken, net: moneyFromMinor(givenMinor - takenMinor), people: people };
  }
  // v24.9: per-person report data (PDF + Excel dono use karte hain) —
  // newest-first list + oldest-first running balance (renderDetailTxns logic).
  function personReportData(personId) {
    var me = myId();
    var sorted = personTxns(personId).slice().sort(function (a, b) {
      var d = String(b.txn_date || "").localeCompare(String(a.txn_date || ""));
      if (d) return d;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    var asc = sorted.slice().reverse();
    var runMinor = 0, balById = {};
    asc.forEach(function (t) {
      var a = moneyToMinor(t.amount);
      if (t.payer_id === me) runMinor += a;
      else if (t.receiver_id === me) runMinor -= a;
      balById[t.id] = moneyFromMinor(runMinor);
    });
    return { sorted: sorted, balById: balById };
  }
  function netSignedTxt(net) {
    return (net >= 0 ? "+ " : "− ") + fmtRs(Math.abs(net));
  }
  // v24.9: shared PDF layout — exportPdf (poora hisaab) aur exportPersonPdf
  // (aik dost ka hisaab) dono isi factory se page banate hain.
  function pdfBase(doc) {
    var W = 595, M = 40, R = W - M;
    var st = { y: 52 };
    var C = {
      navy: [10, 26, 47], steel: [18, 58, 95], cyan: [56, 189, 248],
      green: [22, 163, 74], red: [220, 38, 38], blue: [37, 99, 235],
      zebra: [245, 247, 250], box: [245, 247, 250], line: [220, 226, 235],
      grey: [100, 116, 139], dark: [15, 23, 42]
    };
    function trunc(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
    // v24.10: jsPDF Helvetica sirf WinAnsi (cp1252) glyphs render karta hai.
    // Unicode minus U+2212 "−" (app on-screen "− Rs 210" ke liye use karta hai)
    // WinAnsi mein NAHI hai — PDF mein woh toot kar `"` jaisa glyph banta tha
    // (user ki Awais Khan PDF screenshot: har negative amount `" Rs 210`).
    // Is liye PDF layer ka HAR text isi choke point se guzarta hai: pdfSafe()
    // minus ko ASCII "-" mein badalta hai, aur kisi bhi aur non-WinAnsi char
    // ko "?" karta hai (taake layout kabhi na toote). On-screen formatting
    // (app.js ke baaki hisse) bilkul nahi badla — sirf PDF draw path safe hai.
    function pdfSafe(s) {
      s = String(s == null ? "" : s);
      return s.replace(/[\u2212\u2013]/g, "-")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2022/g, "-")
        .replace(/[^\x20-\x7E\xA0-\xFF\u20AC\u201A\u0192\u201E\u2014\u2026\u2020\u2021\u2030\u2039\u203A\u0152\u0153\u0178\u017D\u017E\u2122]/g, "?");
    }
    function txt(t, x, y, o) { doc.text(pdfSafe(t), x, y, o); }
    // v24.10 overflow guard: har drawn string apne column/box ki chaudai
    // mein fit honi chahiye — kabhi bahar nahi (user: "Kuch value table
    // column SE bhr AA rhi hn"). fitText() text ko "…" se chhota karta hai
    // (sirf TEXT columns — naam/note/title — ke liye). Amounts kabhi
    // truncate nahi hote: un ke liye column chaudai + row font step-down
    // (10pt -> 9pt) hai, aur card amounts ke liye fitSize() (15pt -> 11pt).
    function fitText(s, maxW) {
      s = String(s == null ? "" : s);
      if (!maxW || doc.getTextWidth(s) <= maxW) return s;
      while (s.length > 1 && doc.getTextWidth(s + "…") > maxW) s = s.slice(0, -1);
      return s + "…";
    }
    function fitSize(text, maxW, start, min) {
      var sz = start;
      doc.setFontSize(sz);
      while (sz > min && doc.getTextWidth(text) > maxW) { sz -= 1; doc.setFontSize(sz); }
      return sz;
    }
    function hline(yy) { doc.setDrawColor(180, 180, 180); doc.line(M, yy, R, yy); }
    function needPage(minY) {
      if (st.y + minY > 775) { doc.addPage(); st.y = 52; return true; }
      return false;
    }
    function section(title) {
      needPage(34);
      st.y += 14;
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.setTextColor(C.navy[0], C.navy[1], C.navy[2]);
      txt(fitText(title, R - M), M, st.y); st.y += 8;
      doc.setDrawColor(C.line[0], C.line[1], C.line[2]); doc.line(M, st.y, R, st.y); st.y += 16;
      doc.setTextColor(0, 0, 0);
    }
    // Header band: poori chaudai navy band, neeche cyan accent line,
    // "EASY KHATA" white bold + subtitle, date right-aligned.
    function headerBand(subtitle, rightText) {
      doc.setFillColor(C.navy[0], C.navy[1], C.navy[2]);
      doc.rect(0, 0, W, 64, "F");
      doc.setFillColor(C.cyan[0], C.cyan[1], C.cyan[2]);
      doc.rect(0, 64, W, 3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      txt("EASY KHATA", M, 30);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      var subW = rightText ? (R - M - doc.getTextWidth(rightText) - 16) : (R - M);
      txt(fitText(subtitle, subW), M, 50);
      if (rightText) {
        doc.setFontSize(10);
        txt(rightText, R, 30, { align: "right" });
      }
      doc.setTextColor(0, 0, 0);
      st.y = 84;
    }
    function metaLine(text) {
      needPage(16);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.setTextColor(C.grey[0], C.grey[1], C.grey[2]);
      txt(fitText(text, R - M), M, st.y); st.y += 16;
      doc.setTextColor(0, 0, 0);
    }
    // 3 summary cards aik row mein: label (grey, 9pt) + bold amount (15pt),
    // upar 4pt accent bar (Diye red / Liye green / Net blue).
    function summaryCards(cards) {
      needPage(68);
      var gap = 8, bw = (R - M - gap * 2) / 3, bh = 54;
      cards.forEach(function (c, i) {
        var x = M + i * (bw + gap);
        doc.setFillColor(C.box[0], C.box[1], C.box[2]);
        doc.rect(x, st.y, bw, bh, "F");
        doc.setFillColor(c.color[0], c.color[1], c.color[2]);
        doc.rect(x, st.y, bw, 4, "F");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        doc.setTextColor(C.grey[0], C.grey[1], C.grey[2]);
        txt(fitText(c.label, bw - 20), x + 10, st.y + 20);
        doc.setFont("helvetica", "bold");
        // Card amount apne box mein fit hona chahiye — bara amount ho to
        // font 15pt se 11pt tak neeche aata hai (truncate kabhi nahi).
        fitSize(c.value, bw - 20, 15, 11);
        doc.setTextColor(C.dark[0], C.dark[1], C.dark[2]);
        txt(c.value, x + 10, st.y + 42);
        doc.setTextColor(0, 0, 0);
      });
      st.y += bh + 14;
    }
    // Table header: navy fill + white bold text. cols: [{t, x, align}]
    function tableHead(cols) {
      needPage(24);
      doc.setFillColor(C.navy[0], C.navy[1], C.navy[2]);
      doc.rect(M, st.y, R - M, 20, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      cols.forEach(function (c) { txt(c.maxW ? fitText(c.t, c.maxW) : c.t, c.x, st.y + 14, c.align ? { align: c.align } : undefined); });
      st.y += 20;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
    }
    // Table row: zebra fill (odd rows) + normal 10pt text. Page break ka
    // faisla caller karta hai (needPage + header dobara) — ye sirf draw karta hai.
    // Text columns maxW se "…" truncate hote hain; right-aligned amounts
    // kabhi truncate nahi hote — agar koi amount apni allotted chaudai se
    // bara ho to poori row 9pt ho jati hai (alignment barkarar).
    function tableRow(cols, zebra) {
      if (zebra) {
        doc.setFillColor(C.zebra[0], C.zebra[1], C.zebra[2]);
        doc.rect(M, st.y, R - M, 14, "F");
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      var small = cols.some(function (c) { return c.align === "right" && c.maxW && doc.getTextWidth(c.t) > c.maxW; });
      if (small) doc.setFontSize(9);
      cols.forEach(function (c) { txt(c.maxW && !c.align ? fitText(c.t, c.maxW) : c.t, c.x, st.y + 10, c.align ? { align: c.align } : undefined); });
      st.y += 14;
    }
    // Totals row: upar dark line + bold text.
    function totalsRow(cols) {
      needPage(18);
      doc.setDrawColor(C.dark[0], C.dark[1], C.dark[2]);
      doc.setLineWidth(1);
      doc.line(M, st.y, R, st.y);
      doc.setLineWidth(0.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      var small = cols.some(function (c) { return c.align === "right" && c.maxW && doc.getTextWidth(c.t) > c.maxW; });
      if (small) doc.setFontSize(9);
      cols.forEach(function (c) { txt(c.maxW && !c.align ? fitText(c.t, c.maxW) : c.t, c.x, st.y + 12, c.align ? { align: c.align } : undefined); });
      st.y += 18;
      doc.setFont("helvetica", "normal");
    }
    // Empty state: halka box + centred grey text (bare line nahi — user ki
    // screenshot mein 0-record PDF bilkul khaali lagta tha).
    function emptyBox(text) {
      needPage(44);
      doc.setFillColor(C.box[0], C.box[1], C.box[2]);
      doc.rect(M, st.y, R - M, 34, "F");
      doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
      doc.rect(M, st.y, R - M, 34, "S");
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.setTextColor(C.grey[0], C.grey[1], C.grey[2]);
      txt(fitText(text, R - M - 16), W / 2, st.y + 21, { align: "center" });
      doc.setTextColor(0, 0, 0);
      st.y += 44;
    }
    function addFooter() {
      var pages = doc.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
        doc.line(M, 815, R, 815);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        doc.setTextColor(130, 130, 130);
        txt("Easy Khata — Developed by Asad", M, 822);
        txt("Page " + i + " / " + pages, R, 822, { align: "right" });
        doc.setTextColor(0, 0, 0);
      }
    }
    function fileName(name) {
      var s = String(name || "dost").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return s || "dost";
    }
    return { doc: doc, st: st, W: W, M: M, R: R, C: C, trunc: trunc, hline: hline, needPage: needPage, section: section, headerBand: headerBand, metaLine: metaLine, summaryCards: summaryCards, tableHead: tableHead, tableRow: tableRow, totalsRow: totalsRow, emptyBox: emptyBox, addFooter: addFooter, fileName: fileName };
  }
  async function exportPdf() {
    var PdfCtor = await ensureReportLib("jspdf");
    if (!PdfCtor) { setAcctBackupMsg("PDF library load nahi hui — internet check kar ke dobara try karein.", false); return; }
    try {
      var base = pdfBase(new PdfCtor({ unit: "pt", format: "a4" }));
      var doc = base.doc, M = base.M, R = base.R, C = base.C;
      var d = fullReportData();
      var list = d.list, given = d.given, taken = d.taken, net = d.net, people = d.people;
      var netSigned = netSignedTxt(net);
      base.headerBand("Hisaab Report", fmtDateLong(todayLocal()));
      base.metaLine("Naam: " + myName() + "  ·  Records: " + list.length);
      base.summaryCards([
        { label: "Diye", value: fmtRs(given), color: C.red },
        { label: "Liye", value: fmtRs(taken), color: C.green },
        { label: "Net", value: netSigned, color: C.blue }
      ]);
      // Per-person balances
      base.section("Doston ka hisaab");
      base.metaLine("(+ ka matlab dost ko aap ko dene hain, − ka matlab aap ko dost ko dene hain)");
      function peopleHead() {
        base.tableHead([
          { t: "Dost", x: M, maxW: 200 },
          { t: "Diye", x: 310, align: "right", maxW: 64 },
          { t: "Liye", x: 400, align: "right", maxW: 64 },
          { t: "Balance", x: R, align: "right", maxW: 140 }
        ]);
      }
      peopleHead();
      if (!people.length) { base.emptyBox("Abhi koi dost ya record nahi."); }
      people.forEach(function (p, i) {
        if (base.needPage(14)) peopleHead();
        var b = p.net;
        base.tableRow([
          { t: p.name || "Unknown", x: M, maxW: 200 },
          { t: fmtRs(p.given), x: 310, align: "right", maxW: 64 },
          { t: fmtRs(p.taken), x: 400, align: "right", maxW: 64 },
          { t: (b >= 0 ? "+ " : "− ") + fmtRs(Math.abs(b)), x: R, align: "right", maxW: 140 }
        ], i % 2 === 1);
      });
      if (people.length) {
        base.totalsRow([
          { t: "Total", x: M, maxW: 200 },
          { t: fmtRs(given), x: 310, align: "right", maxW: 64 },
          { t: fmtRs(taken), x: 400, align: "right", maxW: 64 },
          { t: netSigned, x: R, align: "right", maxW: 140 }
        ]);
      }
      // History
      base.section("Record history (" + list.length + " records)");
      function histHeader() {
        base.tableHead([
          { t: "Date", x: M, maxW: 58 },
          { t: "Dene wala", x: 104, maxW: 92 },
          { t: "Lene wala", x: 202, maxW: 92 },
          { t: "Amount", x: 380, align: "right", maxW: 80 },
          { t: "Note", x: 388, maxW: 167 }
        ]);
      }
      histHeader();
      if (!list.length) { base.emptyBox("Abhi koi record nahi."); }
      var histTotalMinor = 0;
      list.forEach(function (t, i) {
        if (base.needPage(14)) histHeader();
        histTotalMinor += moneyToMinor(t.amount);
        base.tableRow([
          { t: fmtDate(t.txn_date), x: M, maxW: 58 },
          { t: profileName(t.payer_id), x: 104, maxW: 92 },
          { t: profileName(t.receiver_id), x: 202, maxW: 92 },
          { t: fmtRs(t.amount), x: 380, align: "right", maxW: 80 },
          { t: t.note || "Food", x: 388, maxW: 167 }
        ], i % 2 === 1);
      });
      if (list.length) {
        base.totalsRow([
          { t: "Total", x: M, maxW: 58 },
          { t: "", x: 104 },
          { t: "", x: 202 },
          { t: fmtRs(moneyFromMinor(histTotalMinor)), x: 380, align: "right", maxW: 80 },
          { t: "", x: 388 }
        ]);
      }
      base.addFooter();
      var blob = doc.output("blob");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "easy-khata-report-" + todayLocal() + ".pdf";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      setAcctBackupMsg("PDF Report download ho gaya (" + list.length + " records).", true);
    } catch (e) {
      setAcctBackupMsg("PDF nahi ban saka — dobara try karein.", false);
    }
  }
  function setDetailPdfMsg(text, ok) {
    var el = $("detailPdfMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  // v24.7: Per-person PDF Report — detail view se (kisi bhi dost ka: profile
  // user ya manual contact). Sirf US dost ke records — baaki doston ka kuch
  // nahi. v24.9: professional redesign (pdfBase layout). Sirf in-memory data
  // (guest mode mein bhi chalta hai, ZERO network calls). Locked (Settled)
  // records bhi list mein aate hain — read-only report hai, edit/delete nahi.
  async function exportPersonPdf(personId) {
    var PdfCtor = await ensureReportLib("jspdf");
    if (!PdfCtor) { setDetailPdfMsg("PDF library load nahi hui — internet check kar ke dobara try karein.", false); return; }
    var p = findPerson(personId);
    if (!p) { setDetailPdfMsg("PDF nahi ban saka — dobara try karein.", false); return; }
    try {
      var base = pdfBase(new PdfCtor({ unit: "pt", format: "a4" }));
      var doc = base.doc, M = base.M, R = base.R, C = base.C;
      var me = myId();
      var s = personStats(personId);
      var rd = personReportData(personId);
      var sorted = rd.sorted, balById = rd.balById;
      var netSigned = netSignedTxt(s.net);
      base.headerBand((p.name || p.email) + " — Hisaab Report", fmtDateLong(todayLocal()));
      base.metaLine("Dost: " + (p.name || p.email) + "  ·  Records: " + sorted.length);
      base.summaryCards([
        { label: "Diye", value: fmtRs(s.given), color: C.red },
        { label: "Liye", value: fmtRs(s.taken), color: C.green },
        { label: "Net", value: netSigned, color: C.blue }
      ]);
      // History — sirf is dost ke records
      base.section("Len-den history (" + sorted.length + " records)");
      function histHeader() {
        base.tableHead([
          { t: "Date", x: M, maxW: 58 },
          { t: "Note", x: 106, maxW: 140 },
          { t: "Diye", x: 320, align: "right", maxW: 64 },
          { t: "Liye", x: 405, align: "right", maxW: 64 },
          { t: "Balance", x: R, align: "right", maxW: 140 }
        ]);
      }
      histHeader();
      if (!sorted.length) { base.emptyBox("Abhi koi record nahi."); }
      sorted.forEach(function (t, i) {
        if (base.needPage(14)) histHeader();
        var a = Number(t.amount) || 0;
        var iGave = t.payer_id === me;
        var bal = balById[t.id];
        var balTxt = bal > 0 ? "+ " + fmtRs(bal) : bal < 0 ? "− " + fmtRs(-bal) : "Rs 0";
        base.tableRow([
          { t: fmtDate(t.txn_date), x: M, maxW: 58 },
          { t: t.note || "Food", x: 106, maxW: 140 },
          { t: iGave ? fmtRs(a) : "", x: 320, align: "right", maxW: 64 },
          { t: !iGave ? fmtRs(a) : "", x: 405, align: "right", maxW: 64 },
          { t: balTxt, x: R, align: "right", maxW: 140 }
        ], i % 2 === 1);
      });
      if (sorted.length) {
        base.totalsRow([
          { t: "Total", x: M, maxW: 58 },
          { t: "", x: 106 },
          { t: fmtRs(s.given), x: 320, align: "right", maxW: 64 },
          { t: fmtRs(s.taken), x: 405, align: "right", maxW: 64 },
          { t: netSigned, x: R, align: "right", maxW: 140 }
        ]);
      }
      base.addFooter();
      var blob = doc.output("blob");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "Easy-Khata-" + base.fileName(p.name || p.email) + "-Report.pdf";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      setDetailPdfMsg("PDF Report download ho gaya (" + sorted.length + " records).", true);
    } catch (e) {
      setDetailPdfMsg("PDF nahi ban saka — dobara try karein.", false);
    }
  }
  // v24.9: Excel (.xlsx) export — SheetJS (xlsx) UMD via CDN. PDF jaisa hi
  // data, lekin asal .xlsx file (amounts NUMBERS hain, Excel mein sum ho
  // sakte hain). Lib load na ho to saaf error, crash nahi. Sirf in-memory
  // data — guest mode mein bhi chalta hai (ZERO network calls; lib SW se
  // runtime-cache hoti hai, pehli online load ke baad offline bhi).
  function safeFileName(name) {
    var s = String(name || "dost").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "dost";
  }
  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  // v24.10: Excel styling — VERIFIED AGAINST THE REAL LIBRARY (probe, not
  // docs): SheetJS Community Edition 0.18.5 cell styles (`s`) LIKHTA HI NAHI
  // — styles.xml mein sirf default font/fills aate hain, bold/fill/border
  // sab drop ho jate hain; sirf `z` (numFmt) aur merges/cols survive karte
  // hain. Is liye library badli: xlsx-js-style 1.2.0 (SheetJS 0.18.5 ka
  // drop-in fork, wahi API + `window.XLSX` global) — probe se verify kiya:
  // fonts/fills/borders/numFmt sab styles.xml mein likhe jate hain, chahe
  // `cellStyles: true` ho ya na ho. Freeze panes, gridlines-hide aur
  // fit-to-page is writer mein supported NAHI hain (probe: <pane>/<pageSetup>
  // kabhi nahi likhe jate) — is liye woh fake NAHI kiye; margins (!margins)
  // supported hain. (xlsx-js-style browser mein <script> se load hota hai —
  // cpexcel.js sirf Node mein chahiye hota hai, browser path mein require
  // guard hai.)
  var XS = {
    navy: "FF0A1A2F", white: "FFFFFFFF", zebra: "FFF1F5F9",
    red: "FFDC2626", grey: "FF64748B", line: "FFDCE3EA", dark: "FF0F172A"
  };
  var X_TITLE = { font: { bold: true, sz: 16, color: { rgb: XS.navy } } };
  var X_META = { font: { sz: 10, color: { rgb: XS.grey } } };
  var X_LABEL = { font: { bold: true, sz: 11 } };
  var X_VALUE = { font: { bold: true, sz: 11 } };
  var X_VALUE_NEG = { font: { bold: true, sz: 11, color: { rgb: XS.red } } };
  var X_LEGEND = { font: { sz: 9, color: { rgb: XS.grey } }, alignment: { wrapText: true, vertical: "center" } };
  var X_SECTION = { font: { bold: true, sz: 12, color: { rgb: XS.navy } } };
  function xCell(ws, addr, style, numFmt) {
    var c = ws[addr] || {};
    if (style) c.s = style;
    if (numFmt) c.z = numFmt;
    ws[addr] = c;
  }
  function xBorder(top) {
    var thin = { style: "thin", color: { rgb: XS.line } };
    return { left: thin, right: thin, bottom: thin, top: top || thin };
  }
  function xHeadStyle(center) {
    return { font: { bold: true, sz: 11, color: { rgb: XS.white } },
      fill: { patternType: "solid", fgColor: { rgb: XS.navy } },
      alignment: { horizontal: center ? "center" : "left", vertical: "center" } };
  }
  function xDataStyle(zebra, right, neg, wrap) {
    var f = { sz: 11 };
    if (neg) f.color = { rgb: XS.red };
    var al = { horizontal: right ? "right" : "left", vertical: "center" };
    if (wrap) al.wrapText = true;
    var s = { font: f, alignment: al, border: xBorder() };
    if (zebra) s.fill = { patternType: "solid", fgColor: { rgb: XS.zebra } };
    return s;
  }
  function xTotalStyle(right, neg) {
    var f = { bold: true, sz: 11 };
    if (neg) f.color = { rgb: XS.red };
    return { font: f, alignment: { horizontal: right ? "right" : "left", vertical: "center" },
      border: { left: { style: "thin", color: { rgb: XS.line } }, right: { style: "thin", color: { rgb: XS.line } }, bottom: { style: "thin", color: { rgb: XS.line } }, top: { style: "medium", color: { rgb: XS.dark } } } };
  }
  async function exportPersonXlsx(personId) {
    var X = await ensureReportLib("xlsx");
    if (!X) { setDetailPdfMsg("Excel library load nahi hui — internet check kar ke dobara try karein.", false); return; }
    var p = findPerson(personId);
    if (!p) { setDetailPdfMsg("Excel nahi ban saka — dobara try karein.", false); return; }
    try {
      var me = myId();
      var s = personStats(personId);
      var rd = personReportData(personId);
      var sorted = rd.sorted, balById = rd.balById;
      var aoa = [];
      aoa.push([(p.name || p.email) + " — Hisaab Report"]); // r0 title
      aoa.push(["Dost: " + (p.name || p.email) + "  ·  Date: " + fmtDateLong(todayLocal()) + "  ·  Records: " + sorted.length]); // r1 meta
      aoa.push([]); // r2
      aoa.push(["Diye", s.given]); // r3
      aoa.push(["Liye", s.taken]); // r4
      aoa.push(["Net", s.net]); // r5 (label chhota rakha — matlab legend row mein)
      aoa.push(["Net − : mujhe dene hain   |   Net + : mujhe milne hain"]); // r6 legend (merged, wrap)
      aoa.push([]); // r7
      aoa.push(["Date", "Note", "Diye", "Liye", "Balance"]); // r8 header
      sorted.forEach(function (t) {
        var a = Number(t.amount) || 0;
        var iGave = t.payer_id === me;
        aoa.push([fmtDate(t.txn_date), t.note || "Food", iGave ? a : "", !iGave ? a : "", balById[t.id]]);
      });
      aoa.push(["", "Total", s.given, s.taken, s.net]);
      var wb = X.utils.book_new();
      var ws = X.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 12 }, { wch: 42 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } }, { s: { r: 6, c: 0 }, e: { r: 6, c: 4 } }];
      ws["!rows"] = [{ hpt: 24 }, null, null, null, null, null, { hpt: 28 }];
      ws["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
      xCell(ws, "A1", X_TITLE);
      xCell(ws, "A2", X_META);
      xCell(ws, "A4", X_LABEL); xCell(ws, "B4", X_VALUE, "#,##0");
      xCell(ws, "A5", X_LABEL); xCell(ws, "B5", X_VALUE, "#,##0");
      xCell(ws, "A6", X_LABEL); xCell(ws, "B6", s.net < 0 ? X_VALUE_NEG : X_VALUE, "#,##0");
      xCell(ws, "A7", X_LEGEND);
      ["A", "B", "C", "D", "E"].forEach(function (col, i) {
        xCell(ws, col + "9", xHeadStyle(i >= 2));
      });
      sorted.forEach(function (t, i) {
        var r = 10 + i, zebra = i % 2 === 1, bal = balById[t.id];
        xCell(ws, "A" + r, xDataStyle(zebra, false, false));
        xCell(ws, "B" + r, xDataStyle(zebra, false, false, true));
        xCell(ws, "C" + r, xDataStyle(zebra, true, false), "#,##0");
        xCell(ws, "D" + r, xDataStyle(zebra, true, false), "#,##0");
        xCell(ws, "E" + r, xDataStyle(zebra, true, bal < 0), "#,##0");
        // Lamba note (42 chars se zyada) wrap hota hai — row unchi kar do
        // taake poora note dikhe, cut na ho.
        if (String(t.note || "Food").length > 40) ws["!rows"][r - 1] = { hpt: 28 };
      });
      var trP = 10 + sorted.length;
      xCell(ws, "A" + trP, xTotalStyle(false, false));
      xCell(ws, "B" + trP, xTotalStyle(false, false));
      xCell(ws, "C" + trP, xTotalStyle(true, false), "#,##0");
      xCell(ws, "D" + trP, xTotalStyle(true, false), "#,##0");
      xCell(ws, "E" + trP, xTotalStyle(true, s.net < 0), "#,##0");
      X.utils.book_append_sheet(wb, ws, "Hisaab");
      var bytes = X.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
      downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Easy-Khata-" + safeFileName(p.name || p.email) + "-Report.xlsx");
      setDetailPdfMsg("Excel Report download ho gaya (" + sorted.length + " records).", true);
    } catch (e) {
      setDetailPdfMsg("Excel nahi ban saka — dobara try karein.", false);
    }
  }
  async function exportXlsx() {
    var X = await ensureReportLib("xlsx");
    if (!X) { setAcctBackupMsg("Excel library load nahi hui — internet check kar ke dobara try karein.", false); return; }
    try {
      var d = fullReportData();
      var list = d.list, given = d.given, taken = d.taken, net = d.net, people = d.people;
      var aoa = [];
      aoa.push(["Easy Khata — Hisaab Report"]); // r0 title
      aoa.push(["Naam: " + myName() + "  ·  Date: " + fmtDateLong(todayLocal()) + "  ·  Records: " + list.length]); // r1 meta
      aoa.push([]); // r2
      aoa.push(["Kull diye", given]); // r3
      aoa.push(["Kull liye", taken]); // r4
      aoa.push(["Net", net]); // r5 (label chhota — matlab legend row mein)
      aoa.push(["Net − : doston ko dene hain   |   Net + : doston se milne hain"]); // r6 legend (merged, wrap)
      aoa.push([]); // r7
      var secPeople = aoa.length;
      aoa.push(["Doston ka hisaab"]);
      var pHead = aoa.length;
      aoa.push(["Dost", "Diye", "Liye", "Balance"]);
      var pFirst = aoa.length;
      people.forEach(function (p) {
        aoa.push([p.name || "Unknown", p.given, p.taken, p.net]);
      });
      var pTotal = aoa.length;
      aoa.push(["Total", given, taken, net]);
      aoa.push([]);
      var secHist = aoa.length;
      aoa.push(["Record history (" + list.length + " records)"]);
      var hHead = aoa.length;
      aoa.push(["Date", "Dene wala", "Lene wala", "Amount", "Note"]);
      var hFirst = aoa.length;
      var histTotalMinor = 0;
      list.forEach(function (t) {
        histTotalMinor += moneyToMinor(t.amount);
        aoa.push([fmtDate(t.txn_date), profileName(t.payer_id), profileName(t.receiver_id), Number(t.amount) || 0, t.note || "Food"]);
      });
      var hTotal = aoa.length;
      aoa.push(["Total", "", "", moneyFromMinor(histTotalMinor), ""]);
      var wb = X.utils.book_new();
      var ws = X.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 40 }];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        { s: { r: 6, c: 0 }, e: { r: 6, c: 4 } },
        { s: { r: secPeople, c: 0 }, e: { r: secPeople, c: 4 } },
        { s: { r: secHist, c: 0 }, e: { r: secHist, c: 4 } }
      ];
      ws["!rows"] = [{ hpt: 24 }, null, null, null, null, null, { hpt: 28 }];
      ws["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
      xCell(ws, "A1", X_TITLE);
      xCell(ws, "A2", X_META);
      xCell(ws, "A4", X_LABEL); xCell(ws, "B4", X_VALUE, "#,##0");
      xCell(ws, "A5", X_LABEL); xCell(ws, "B5", X_VALUE, "#,##0");
      xCell(ws, "A6", X_LABEL); xCell(ws, "B6", net < 0 ? X_VALUE_NEG : X_VALUE, "#,##0");
      xCell(ws, "A7", X_LEGEND);
      xCell(ws, "A" + (secPeople + 1), X_SECTION);
      ["A", "B", "C", "D"].forEach(function (col, i) {
        xCell(ws, col + (pHead + 1), xHeadStyle(i >= 1));
      });
      people.forEach(function (p, i) {
        var r = pFirst + 1 + i, zebra = i % 2 === 1, bal = p.net;
        xCell(ws, "A" + r, xDataStyle(zebra, false, false, true));
        xCell(ws, "B" + r, xDataStyle(zebra, true, false), "#,##0");
        xCell(ws, "C" + r, xDataStyle(zebra, true, false), "#,##0");
        xCell(ws, "D" + r, xDataStyle(zebra, true, bal < 0), "#,##0");
        if (String(p.name || "Unknown").length > 22) ws["!rows"][r - 1] = { hpt: 28 };
      });
      xCell(ws, "A" + (pTotal + 1), xTotalStyle(false, false));
      xCell(ws, "B" + (pTotal + 1), xTotalStyle(true, false), "#,##0");
      xCell(ws, "C" + (pTotal + 1), xTotalStyle(true, false), "#,##0");
      xCell(ws, "D" + (pTotal + 1), xTotalStyle(true, net < 0), "#,##0");
      xCell(ws, "A" + (secHist + 1), X_SECTION);
      ["A", "B", "C", "D", "E"].forEach(function (col, i) {
        xCell(ws, col + (hHead + 1), xHeadStyle(i === 3));
      });
      list.forEach(function (t, i) {
        var r = hFirst + 1 + i, zebra = i % 2 === 1;
        xCell(ws, "A" + r, xDataStyle(zebra, false, false));
        xCell(ws, "B" + r, xDataStyle(zebra, false, false, true));
        xCell(ws, "C" + r, xDataStyle(zebra, false, false, true));
        xCell(ws, "D" + r, xDataStyle(zebra, true, false), "#,##0");
        xCell(ws, "E" + r, xDataStyle(zebra, false, false, true));
        if (String(profileName(t.payer_id)).length > 22 || String(profileName(t.receiver_id)).length > 22 || String(t.note || "Food").length > 38) ws["!rows"][r - 1] = { hpt: 28 };
      });
      xCell(ws, "A" + (hTotal + 1), xTotalStyle(false, false));
      xCell(ws, "D" + (hTotal + 1), xTotalStyle(true, false), "#,##0");
      X.utils.book_append_sheet(wb, ws, "Full Report");
      var bytes = X.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
      downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Easy-Khata-Full-Report.xlsx");
      setAcctBackupMsg("Excel Report download ho gaya (" + list.length + " records).", true);
    } catch (e) {
      setAcctBackupMsg("Excel nahi ban saka — dobara try karein.", false);
    }
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
    if (!visibleTxns().length) {
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
      } else if (t.payer_id === me || t.receiver_id === me) {
        // v24.11: involved non-creator — sirf apne liye hide (Delete). Admin
        // normal view mein aam user hai — isAdmin() branch hata di gayi.
        btns = '<span class="t-btns"><button class="btn-danger" type="button" data-del="' + esc(t.id) + '">Delete</button></span>';
      }
      html += '<div class="txn"><div class="t-main">' + partyNameMarkup(t.payer_id) + ' → ' + partyNameMarkup(t.receiver_id) + '</div>' +
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
    clearRepeatBox(); // v87: agle record par repeat dobara tick karna parega
    $("txnRepeatRow").hidden = false;
    setTxnMsg("");
  }
  function startEditTxn(id) {
    var t = null;
    txns.forEach(function (x) { if (x.id === id) t = x; });
    if (!t || t.created_by !== myId()) return;
    if (isTxnLocked(t)) { setTxnMsg(LOCK_MSG, false); return; } // settled history — handler-level guard
    showView("khata");
    setSplitMode(false);
    clearRepeatBox(); // v87: edit par repeat nahi — rule form se nahi badalta
    $("txnRepeatRow").hidden = true;
    var me = myId();
    var other = t.payer_id === me ? t.receiver_id : t.payer_id;
    var dir = t.payer_id === me ? "given" : "taken";
    editingId = id;
    $("txnPerson").value = other;
    cdSync($("txnPerson")); // v73: edit karte waqt dropdown label bhi us dost par le jao
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
    // v87: split (kai dost) + repeat (aik dost) aik saath nahi — split on
    // ho to repeat hat jaye.
    if (on) { clearRepeatBox(); $("txnRepeatRow").hidden = true; }
    else { $("txnRepeatRow").hidden = false; }
    if (on) renderSplitList();
  }
  // v24: guest split — wahi barabar baant, sirf local store mein.
  function guestAddSplitTxns(amount, note, date, btn) {
    var ids = selectedSplitIds();
    if (!ids.length) { setTxnMsg("Baantne ke liye kam se kam aik dost chunein.", false); return; }
    var me = myId();
    var people = ids.length + 1; // friends + you — your share counts too
    var share = Math.floor(amount / people * 100) / 100;
    if (share <= 0) { setTxnMsg("Raqam baantne ke liye bohat choti hai.", false); return; }
    ids.forEach(function (id, idx) {
      var amt = (idx === ids.length - 1) ? Math.round((amount - share * ids.length) * 100) / 100 : share;
      txns.unshift({
        id: newUuid(), payer_id: me, receiver_id: id, amount: amt,
        note: note, txn_date: date,
        created_by: me, created_at: new Date().toISOString()
      });
    });
    saveGuestStore();
    renderAll();
    resetTxnForm();
    setTxnMsg(ids.length + " records save ho gaye (barabar baant diye)!", true);
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
        // v68: loadAll() pehle — woh shuru mein txnMsg saaf karta hai,
        // is liye confirmation message us ke BAAD lagao, warna foran mit jata hai.
        loadAll();
        if (failed) setTxnMsg(done + " records save ho gaye, " + failed + " fail — dobara check karein.", false);
        else if (offlineSaved) { setTxnMsg(ids.length + " records phone mein save ho gaye. Internet aate hi update ho jayenge!", true); resetTxnForm(); }
        else { setTxnMsg(ids.length + " records save ho gaye (barabar baant diye)!", true); resetTxnForm(); }
        return;
      }
      var id = ids[i++];
      var amt = (i === ids.length) ? Math.round((amount - share * ids.length) * 100) / 100 : share;
      var recBody = {
        id: newUuid(), workspace_id: currentWorkspaceId,
        payer_id: me, receiver_id: id, amount: amt,
        note: note, txn_date: date, created_by: me
      };
      sb("khata_transactions", { method: "POST", prefer: "return=representation", body: recBody }).then(function (res) {
        if (res.ok) { done++; var created = res.body && res.body[0]; if (created) { sendNotif(id, "record", created); triggerPush(id, myName() + " ne record add kiya", notifBodyFor(created, id), created.id); } }
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

  // v87: repeat form — frequency badle to din ki options dobara banao.
  // Default din txn ki tareekh se (monthly: usi tareekh, weekly: usi din).
  function fillRepeatDayOptions() {
    var freq = $("txnRepeatFreq").value;
    var sel = $("txnRepeatDay");
    var prev = sel.value;
    sel.innerHTML = "";
    if (freq === "weekly") {
      for (var i = 1; i <= 7; i++) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = WEEKDAYS_UR[i - 1];
        sel.appendChild(o);
      }
    } else {
      for (var d = 1; d <= 28; d++) {
        var o2 = document.createElement("option");
        o2.value = String(d);
        o2.textContent = "Mahine ki " + d + " tareekh";
        sel.appendChild(o2);
      }
    }
    var dd = parseISODate($("txnDate").value || todayLocal());
    var defVal = freq === "weekly"
      ? String(dd ? (dd.getDay() === 0 ? 7 : dd.getDay()) : 1)
      : String(dd ? Math.min(28, dd.getDate()) : 1);
    // NOTE: options bharte hi select pehli option (1) auto-select kar leta
    // hai — is liye value hamesha set karo, sirf khaali hone par nahi.
    sel.value = prev || defVal;
    if (!sel.value) sel.value = defVal; // prev is frequency mein maujood nahi (misal: 28 weekly)
    cdSync(sel); // v73: options badle to button label/menu dobara banao
    updateRepeatHint();
  }
  function updateRepeatHint() {
    var el = $("repeatHint");
    if (!el) return;
    var date = $("txnDate").value || todayLocal();
    var freq = $("txnRepeatFreq").value;
    var day = parseInt($("txnRepeatDay").value || "1", 10);
    var next = nextRecurringDate(freq, day, date);
    el.textContent = "Pehla repeat: " + next + " — us ke baad " + (freq === "weekly" ? "har hafta usi din" : "har mahine ki " + day + " tareekh") + ".";
  }
  function clearRepeatBox() {
    var rep = $("txnRepeat");
    if (rep) rep.checked = false;
    var box = $("repeatBox");
    if (box) box.hidden = true;
  }
  // v87: form se rule banao — txn save hone ke BAAD hi (txn fail ho to rule nahi).
  function maybeCreateRecurringRule(body) {
    var rep = $("txnRepeat");
    if (!rep || !rep.checked || editingId) return;
    var freq = $("txnRepeatFreq").value || "monthly";
    var day = parseInt($("txnRepeatDay").value || "1", 10) || 1;
    var rule = {
      id: newUuid(), owner_id: myId(), workspace_id: currentWorkspaceId,
      payer_id: body.payer_id, receiver_id: body.receiver_id,
      amount: body.amount, note: body.note || "",
      frequency: freq, day_value: day,
      next_due: nextRecurringDate(freq, day, body.txn_date),
      is_active: true, created_at: new Date().toISOString()
    };
    recurringRules.push(rule);
    renderRecurringList();
    if (guestMode) { saveGuestStore(); return; }
    sb("khata_recurring", { method: "POST", prefer: "return=representation", body: rule })
      .then(function (res) {
        if (res.ok) { saveCache(); return; }
        if (isTransientResponse(res) || res.status === 409) {
          if (res.status !== 409) queueOp({ key: newUuid(), op: "insert", table: "khata_recurring", id: rule.id, body: rule, ts: Date.now() });
          saveCache();
          return;
        }
        setTxnMsg("Record save ho gaya, lekin recurring rule save nahi hua — dobara try karein.", false);
      }).catch(function () {
        queueOp({ key: newUuid(), op: "insert", table: "khata_recurring", id: rule.id, body: rule, ts: Date.now() });
        saveCache();
      });
  }
  function addTxn(e) {
    e.preventDefault();
    if (!dbReady) { setTxnMsg("App abhi tayyar nahi. Barah-e-karam support se rabta karein.", false); return; }
    var person = $("txnPerson").value;
    var dir = (document.querySelector('input[name="txnDir"]:checked') || {}).value || "given";
    var amount = parseFloat($("txnAmount").value);
    var note = $("txnNote").value.trim();
    var date = $("txnDate").value;
    if (!splitMode && !person) { setTxnMsg("Pehle dost chunein.", false); return; }
    if (!amount || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) { setTxnMsg("Raqam 0 se zyada aur maximum 2 decimal places mein likhein.", false); return; }
    if (amount > 10000000) { setTxnMsg("Raqam zyada se zyada Rs 10,000,000 ho sakti hai.", false); return; }
    if (note.length > 500) { setTxnMsg("Note zyada se zyada 500 harf ka ho sakta hai.", false); return; }
    amount = moneyFromMinor(moneyToMinor(amount));
    if (!date) { setTxnMsg("Tareekh likhein.", false); return; }
    if (splitMode && !editingId) {
      if (guestMode) { guestAddSplitTxns(amount, note, date, e.target.querySelector('button[type="submit"]')); return; }
      addSplitTxns(amount, note, date, e.target.querySelector('button[type="submit"]'));
      return;
    }
    var me = myId();
    var body = {
      payer_id: dir === "given" ? me : person,
      receiver_id: dir === "given" ? person : me,
      amount: amount,
      note: note,
      txn_date: date,
      created_by: me,
      workspace_id: currentWorkspaceId
    };
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    var recId = newUuid(); // client UUID pehle se — lost response par retry duplicate nahi banayega
    if (guestMode) {
      // v24: guest record — sirf local store, koi server call, koi
      // notification, koi push nahi. Settled history yahan bhi locked hai.
      if (editingId) {
        var editId = editingId;
        var gt = null;
        txns.forEach(function (x) { if (x.id === editId) gt = x; });
        if (gt && isTxnLocked(gt)) { btn.disabled = false; setTxnMsg(LOCK_MSG, false); return; }
        if (gt) {
          gt.payer_id = body.payer_id; gt.receiver_id = body.receiver_id;
          gt.amount = body.amount; gt.note = body.note; gt.txn_date = body.txn_date;
        }
        saveGuestStore();
        renderAll();
        resetTxnForm();
        setTxnMsg("Record update ho gaya!", true);
        btn.disabled = false;
        return;
      }
      txns.unshift(Object.assign({ id: recId, created_at: new Date().toISOString() }, body));
      saveGuestStore();
      renderAll();
      maybeCreateRecurringRule(body); // v87: repeat tick ho to rule bane
      clearRepeatBox();
      $("txnAmount").value = "";
      $("txnNote").value = "";
      setTxnMsg("Record save ho gaya!", true);
      btn.disabled = false;
      return;
    }
    if (editingId) {
      var editId = editingId;
      sb("khata_transactions?id=eq." + encodeURIComponent(editId), { method: "PATCH", prefer: "return=minimal", body: body })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) {
            if(isTransientResponse(res)){markConnectionIssue();offlineTxnUpdate(editId,body);resetTxnForm();setTxnMsg("Server se rabta nahi ho saka" + saveErrDetail(res) + ". Tabdeeli phone mein save ho gayi; thodi der mein khud update ho jayegi.",true);btn.disabled=false;return;}
            setTxnMsg("Tabdeeli save nahi hui" + saveErrDetail(res) + " — dobara try karein.", false); return;
          }
          resetTxnForm();
          loadAll(); // v68: pehle — yeh txnMsg saaf karta hai
          setTxnMsg("Record update ho gaya!", true);
        }).catch(function () {
          btn.disabled = false;
          offlineTxnUpdate(editId, body);
          resetTxnForm();
          setTxnMsg("Tabdeeli save ho gayi. Internet aate hi update ho jayegi.", true);
        });
      return;
    }
    sb("khata_transactions", { method: "POST", prefer: "return=representation", body: Object.assign({ id: recId }, body) })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          if(isTransientResponse(res)){markConnectionIssue();offlineTxnInsert(Object.assign({id:recId},body));maybeCreateRecurringRule(body);clearRepeatBox();$("txnAmount").value="";$("txnNote").value="";setTxnMsg("Server se rabta nahi ho saka" + saveErrDetail(res) + ". Record phone mein save ho gaya; thodi der mein khud update ho jayega.",true);btn.disabled=false;return;}
          setTxnMsg("Record save nahi hua" + saveErrDetail(res) + " — dobara try karein.", false); return;
        }
        var created = res.body && res.body[0];
        if (created) { sendNotif(person, "record", created); triggerPush(person, myName() + " ne record add kiya", notifBodyFor(created, person), created.id); }
        $("txnAmount").value = "";
        $("txnNote").value = "";
        maybeCreateRecurringRule(body); // v87: repeat tick ho to rule bane
        clearRepeatBox();
        loadAll(); // v68: pehle — yeh txnMsg saaf karta hai
        setTxnMsg("Record save ho gaya!", true);
      }).catch(function () {
        btn.disabled = false;
        offlineTxnInsert(Object.assign({ id: recId }, body));
        maybeCreateRecurringRule(body); // v87: offline bhi rule queue ho
        clearRepeatBox();
        $("txnAmount").value = "";
        $("txnNote").value = "";
        setTxnMsg("Record save ho gaya. Internet aate hi update ho jayega.", true);
      });
  }

  // v24.11: Delete = SIRF apne liye hide (khata_txn_hidden). App kabhi real
  // DELETE nahi bhejta — na normal view se, na admin apne normal account
  // se (admin CRUD sirf Admin Panel ke andar hota hai). Doosre dost ki
  // history, totals aur balances bilkul nahi badalte.
  function hideTxnOnline(id) {
    return sb("khata_txn_hidden", { method: "POST", prefer: "return=minimal", body: { txn_id: id, user_id: myId() } })
      .then(function (res) {
        if (!res.ok && res.status !== 409) {
          if(isTransientResponse(res)){markConnectionIssue();offlineTxnHide(id);setTxnMsg("Server se rabta nahi ho saka" + saveErrDetail(res) + ". Record hide kar diya gaya; thodi der mein khud update ho jayega.",true);return true;}
          setTxnMsg("Record hataya nahi gaya" + saveErrDetail(res) + " — dobara try karein.", false); return false;
        }
        hiddenTxnIds[id] = true;
        saveCache();
        renderAll();
        setTxnMsg("Record history se hide ho gaya — total aur friend balance same hain.", true);
        return true;
      }).catch(function () {
        offlineTxnHide(id);
        setTxnMsg("Record history se hide ho gaya. Balance par koi asar nahi padega.", true);
        return true;
      });
  }
  function deleteTxn(id) {
    var t = null;
    txns.forEach(function (x) { if (x.id === id) t = x; });
    if (!t) return;
    if (isTxnLocked(t)) { setTxnMsg(LOCK_MSG, false); return; } // settled history — handler-level guard
    if (t.payer_id !== myId() && t.receiver_id !== myId()) return; // sirf involved user apne liye hide kar sakta hai (admin bhi normal view mein aam user hai)
    askConfirm("Record history se hatayein?", "Ye record sirf history se hide hoga. Aapka total balance aur dost ki list ka balance bilkul change nahi hoga. Doosre dost ko bhi koi fark nahi parega.", "History se hatayein", function () {
    if (guestMode) {
      // Guest history hide only: preserve the underlying transaction for balances.
      hiddenTxnIds[id] = true;
      saveGuestStore();
      renderAll();
      setTxnMsg("Record delete ho gaya.", true);
      return;
    }
    hideTxnOnline(id);
    });
  }

  /* ---------- wire up ---------- */
  $("tabLogin").addEventListener("click", function () { authMode = "login"; renderAuthMode(); });
  $("tabSignup").addEventListener("click", function () { authMode = "signup"; renderAuthMode(); });
  $("signupJoinCommunityBtn").addEventListener("click",function(){
    var opening=$("signupJoinCommunityPanel").hidden;
    $("signupJoinCommunityPanel").hidden=!opening;
    $("signupCommunityCreateHint").hidden=true;
    $("signupJoinCommunityBtn").setAttribute("aria-expanded",String(opening));
    $("signupCreateCommunityBtn").setAttribute("aria-expanded","false");
    if(opening){
      saveSignupCommunityIntent("join","");
      loadSignupCommunityDirectory($("signupCommunitySearch").value||"");
      $("signupCommunitySearch").focus();
    }else{saveSignupCommunityIntent("join","");}
  });
  $("signupCreateCommunityBtn").addEventListener("click",function(){
    var opening=$("signupCommunityCreateHint").hidden;
    $("signupJoinCommunityPanel").hidden=true;
    $("signupCommunityCreateHint").hidden=!opening;
    $("signupJoinCommunityBtn").setAttribute("aria-expanded","false");
    $("signupCreateCommunityBtn").setAttribute("aria-expanded",String(opening));
    saveSignupCommunityIntent("create","");
  });
  $("signupCommunitySearch").addEventListener("input",function(){
    var value=this.value;clearTimeout(window._signupCommunitySearchTimer);
    window._signupCommunitySearchTimer=setTimeout(function(){loadSignupCommunityDirectory(value);},250);
  });
  $("authSubmitBtn").addEventListener("click", doAuth);
  // v24: guest mode — aik tap, koi email/password nahi.
  $("guestBtn").addEventListener("click", enterGuestMode);
  function setGuestNameMsg(text, ok) {
    var el = $("guestNameMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : text ? " err" : "");
  }
  $("guestSaveNameBtn").addEventListener("click", function () {
    if (!guestMode) return;
    var nm = $("guestNameInput").value.trim();
    if (!nm) { setGuestNameMsg("Apna naam likhein.", false); return; }
    if (nm.length > 80) { setGuestNameMsg("Naam 80 harf se zyada nahi ho sakta.", false); return; }
    guestMeName = nm;
    if (profiles.length) profiles[0].name = nm;
    saveGuestStore();
    renderAll();
    setGuestNameMsg("Naam save ho gaya! ✓", true);
  });
  // v24: guest mode se account banayein — login screen signup mode mein
  // khulti hai; guest store mehfooz rehta hai, signup ke baad migration
  // ki offer aati hai.
  $("guestCreateAccountBtn").addEventListener("click", function () {
    authMode = "signup";
    showAuth();
  });
  // v24: guest mode se bahar — login screen; guest store mehfooz rehta hai.
  $("guestExitBtn").addEventListener("click", function () { showAuth(); });
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
  $("logoutBtn").addEventListener("click", function () { if (!guestMode) saveSession(null); showAuth(); });
  $("navKhata").addEventListener("click", function () { showView("khata"); });
  $("navAccount").addEventListener("click", function () { showView("account"); });
  $("navAdminBtn").addEventListener("click", showAdminView);
  $("adminBackBtn").addEventListener("click", function () { showView("account"); });
  $("peopleSearch").addEventListener("input", function (e) { peopleSearchText = e.target.value; renderPeople(); });
  $("detailBackBtn").addEventListener("click", function () { showView("khata"); });
  $("detailShareBtn").addEventListener("click", function () { if (detailPersonId) sharePerson(detailPersonId); });
  $("detailWaBtn").addEventListener("click", function () { if (detailPersonId) remindPerson(detailPersonId); });
  $("detailSettleBtn").addEventListener("click", function () { if (detailPersonId) settlePerson(detailPersonId); });
  $("detailPdfBtn").addEventListener("click", function () { if (detailPersonId) exportPersonPdf(detailPersonId); }); // v24.7: per-person PDF Report
  $("detailXlsxBtn").addEventListener("click", function () { if (detailPersonId) exportPersonXlsx(detailPersonId); }); // v24.9: per-person Excel Report
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
  $("acctJsonBackupBtn").addEventListener("click", exportJsonBackup); // v77: JSON backup
  $("acctJsonRestoreBtn").addEventListener("click", function () { $("acctJsonRestoreInput").click(); });
  $("acctJsonRestoreInput").addEventListener("change", onJsonRestoreFile);
  $("acctPinLockBtn").addEventListener("click", managePinLock); // v78: PIN set/change/band
  $("acctLockNowBtn").addEventListener("click", showPinLock); // v78: abhi lock karein
  $("pinLockUnlockBtn").addEventListener("click", tryPinUnlock);
  $("pinLockForgotBtn").addEventListener("click", pinForgot);
  $("pinLockInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryPinUnlock(); } });
  $("pinLockInput").addEventListener("input", function () { if (($("pinLockInput").value || "").length >= 4) tryPinUnlock(); }); // v86: 4 digits = auto unlock
  $("acctPdfBtn").addEventListener("click", exportPdf); // v24.5: PDF Report
  $("acctXlsxBtn").addEventListener("click", exportXlsx); // v24.9: Excel Report
  $("acctPushBtn").addEventListener("click", enablePushFromButton);
  $("acctPrivacyBtn").addEventListener("click", function () { var b = $("privacyBox"); b.hidden = !b.hidden; });
  $("acctRateBtn").addEventListener("click", openRateDialog);
  document.querySelectorAll("#rateStars .rate-star").forEach(function (b) {
    b.addEventListener("click", function () { ratePicked = Number(b.getAttribute("data-stars")); paintRateStars(); });
  });
  $("rateCancelBtn").addEventListener("click", closeRateDialog);
  $("rateSubmitBtn").addEventListener("click", submitRating);
  $("rateOverlay").addEventListener("click", function (e) { if (e.target === $("rateOverlay")) closeRateDialog(); });
  $("acctWaBtn").addEventListener("click", function () {
    // WhatsApp helpline — Asad ka apna number (03098851445). v24.5 mein
    // verify kiya: live code mein number pehle se yahi tha, is liye number
    // nahi badla — sirf prefilled message proper/professional/modern kiya.
    openWaLink("https://wa.me/923098851445?text=" + encodeURIComponent("Assalam o Alaikum! Easy Khata app ke baare mein madad chahiye — barah-e-karam rehnumai farmayein. Shukriya!"));
  });
  $("changePassBtn").addEventListener("click", function () { var b = $("changePassBox"); b.hidden = !b.hidden; });
  $("savePassBtn").addEventListener("click", doChangePass);
  $("txnForm").addEventListener("submit", addTxn);
  // v87: repeat form — tick karte hi din ki options + hint banein.
  $("txnRepeat").addEventListener("change", function () {
    var on = $("txnRepeat").checked;
    $("repeatBox").hidden = !on;
    if (on) fillRepeatDayOptions();
  });
  $("txnRepeatFreq").addEventListener("change", fillRepeatDayOptions);
  $("txnRepeatDay").addEventListener("change", updateRepeatHint);
  $("txnDate").addEventListener("change", function () { if (!$("repeatBox").hidden) updateRepeatHint(); });
  $("cancelEditBtn").addEventListener("click", resetTxnForm);
  $("refreshBtn").addEventListener("click", loadAll);
  $("shareAllBtn").addEventListener("click", openShareSheet); // v69: sheet khole, seedha link na bheje
  document.querySelectorAll("#shareSheetOverlay .share-sheet-opt").forEach(function (btn) {
    btn.addEventListener("click", function () { shareSheetKind = btn.getAttribute("data-share-kind"); renderShareSheet(); });
  });
  $("shareSheetCancelBtn").addEventListener("click", closeShareSheet);
  $("shareSheetSendBtn").addEventListener("click", function () { closeShareSheet(); shareText(shareSheetText(shareSheetKind)); });
  $("shareSheetOverlay").addEventListener("click", function (e) { if (e.target === $("shareSheetOverlay")) closeShareSheet(); });
  $("balanceEyeBtn").addEventListener("click", toggleBalanceEye); // v66: balance chhupayein/dikhayein
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
    cdSync($("txnFilterPerson")); // v73: filter saaf karte waqt dropdown label bhi "Sab" par le jao
    renderTxns();
  });
  $("exportCsvBtn").addEventListener("click", exportFilteredLedgerPdf);
  $("txnSplit").addEventListener("change", function (e) { setSplitMode(e.target.checked); });
  $("txnAmount").addEventListener("input", function () { if (splitMode) updateSplitHint(); });
  $("splitList").addEventListener("change", function () { updateSplitHint(); });
  $("peopleList").addEventListener("click", function (e) {
    var row = e.target.closest ? e.target.closest("[data-person]") : null;
    if (row) openPersonDetail(row.getAttribute("data-person"));
  });
  $("txnList").addEventListener("click", function (e) {
    var missing = e.target.closest ? e.target.closest("[data-missing-name]") : null;
    if (missing) { saveMissingPartyName(missing.getAttribute("data-missing-name")); return; }
    var ed = e.target.closest ? e.target.closest("[data-edit]") : null;
    if (ed) { startEditTxn(ed.getAttribute("data-edit")); return; }
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });
  $("hiddenTxnList").addEventListener("click", function (e) { var b = e.target.closest ? e.target.closest("[data-restore-hidden]") : null; if (b) restoreHiddenTxn(b.getAttribute("data-restore-hidden")); });
  $("detailTxns").addEventListener("click", function (e) {
    var ed = e.target.closest ? e.target.closest("[data-edit]") : null;
    if (ed) { startEditTxn(ed.getAttribute("data-edit")); return; }
    var b = e.target.closest ? e.target.closest("[data-del]") : null;
    if (b) deleteTxn(b.getAttribute("data-del"));
  });
  $("adminUserTxns").addEventListener("click", function (e) {
    var edit = e.target.closest ? e.target.closest("[data-admin-txn-edit]") : null;
    if (edit) { adminEditTxn(edit.getAttribute("data-admin-txn-edit")); return; }
    var del = e.target.closest ? e.target.closest("[data-admin-txn-del]") : null;
    if (del) adminDeleteTxn(del.getAttribute("data-admin-txn-del"));
  });
  $("adminUserSearch").addEventListener("input",function(e){adminUserSearchText=e.target.value||"";adminUserShown=20;renderAdminUserList();});
  $("adminUserStatus").addEventListener("change",function(e){adminUserStatusFilter=e.target.value||"all";adminUserShown=20;renderAdminUserList();});
  $("adminUserSort").addEventListener("change",function(e){adminUserSortMode=e.target.value||"recent";adminUserShown=20;renderAdminUserList();});
  $("adminRefreshBtn").addEventListener("click",function(){loadAll();renderAdmin();});
  $("adminExportUsersBtn").addEventListener("click",exportAdminUsers);
  $("adminCreateCommunityBtn").addEventListener("click",function(){openCommunityModal("create");});
  $("adminCommunitySearch").addEventListener("input",function(){adminCommunityShown=20;renderAdminCommunities();});
  $("adminCommunityStatus").addEventListener("change",function(){adminCommunityShown=20;renderAdminCommunities();});
  $("adminMemberSearch").addEventListener("input",function(){adminCommunityMemberShown=20;renderAdminCommunityMembers();});
  $("adminMemberCommunityFilter").addEventListener("change",function(){adminCommunityMemberShown=20;renderAdminCommunityMembers();});
  $("workspaceMemberSearch").addEventListener("input",function(){memberSearchQ=this.value;renderWorkspaceMemberCards(lastMemberRows);});
  $("adminCommunityList").addEventListener("click",function(e){
    var edit=e.target.closest("[data-admin-community-edit]");if(edit){editAdminCommunity(edit.getAttribute("data-admin-community-edit"));return;}
    var status=e.target.closest("[data-admin-community-status]");if(status){setAdminCommunityStatus(status.getAttribute("data-admin-community-status"),status.getAttribute("data-next-status"));return;}
    var del=e.target.closest("[data-admin-community-delete]");if(del){deleteAdminCommunity(del.getAttribute("data-admin-community-delete"));return;}
    var add=e.target.closest("[data-admin-add-member]");if(add){adminAddCommunityMember(add.getAttribute("data-admin-add-member"));}
  });
  $("adminCommunityMemberList").addEventListener("click",function(e){
    var save=e.target.closest("[data-admin-member-save]");if(save){adminSaveCommunityMember(save.getAttribute("data-admin-member-save"));return;}
    var owner=e.target.closest("[data-admin-member-owner]");if(owner){adminMakeCommunityOwner(owner.getAttribute("data-admin-member-owner"));}
  });
  $("adminCommunityEditClose").addEventListener("click",function(){$("adminCommunityEditOverlay").hidden=true;adminEditingWorkspace=null;});
  $("adminCommunityEditOverlay").addEventListener("click",function(e){if(e.target===$("adminCommunityEditOverlay")){$("adminCommunityEditOverlay").hidden=true;adminEditingWorkspace=null;}});
  $("adminCommunityEditSave").addEventListener("click",saveAdminCommunity);

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
  $("saveContactBtn").addEventListener("click", addContact);
  $("workspaceSelect").addEventListener("change", function(e){switchWorkspace(e.target.value);});
  $("workspaceMenuBtn").addEventListener("click", function(e){e.stopPropagation();cdCloseAll();toggleWorkspaceMenu();});
  $("workspaceMenu").addEventListener("click", function(){closeWorkspaceMenu();});
  // v73: sab static selects ko custom dropdown banao; bahar click / Escape se band karo.
  cdAttachStatic();
  document.addEventListener("click", function(e){ if(!e.target.closest || !e.target.closest(".cd-wrap")) cdCloseAll(); });
  document.addEventListener("scroll", function(e){ if(e.target && e.target.closest && e.target.closest(".cd-menu")) return; cdCloseAll(); }, true); // v86: fixed menu scroll par band (menu ke andar scroll nahi)
  window.addEventListener("resize", function(){ cdCloseAll(); }); // v86
  document.addEventListener("keydown", function(e){ if(e.key==="Escape"){ cdCloseAll(); closeWorkspaceMenu(); } });
  document.addEventListener("click", function(e){var bar=$("workspaceBar");if(bar&&!bar.contains(e.target))closeWorkspaceMenu();});
  document.addEventListener("keydown", function(e){if(e.key==="Escape")closeWorkspaceMenu();});
  $("workspaceCreateBtn").addEventListener("click", createBusinessWorkspace);
  $("workspaceExploreBtn").addEventListener("click", function(){openCommunityModal("join");});
  $("workspaceSetupBtn").addEventListener("click", function(){openCommunityModal("setup");});
  $("communityModalClose").addEventListener("click",closeCommunityModal);
  $("communityOverlay").addEventListener("click",function(e){if(e.target===$("communityOverlay"))closeCommunityModal();});
  $("communityTabCreate").addEventListener("click",function(){openCommunityModal("create");});
  $("communityTabJoin").addEventListener("click",function(){openCommunityModal("join");});
  $("communityCreateSubmit").addEventListener("click",submitCommunityCreate);
  $("communityJoinSubmit").addEventListener("click",submitCommunityJoin);
  $("communitySetupSubmit").addEventListener("click",submitCommunityPassword);
  $("communitySearch").addEventListener("input",function(){var value=this.value;clearTimeout(window._communitySearchTimer);window._communitySearchTimer=setTimeout(function(){loadCommunityDirectory(value);},250);});
  $("membersModalClose").addEventListener("click",function(){$("membersOverlay").hidden=true;});
  $("membersOverlay").addEventListener("click",function(e){if(e.target===$("membersOverlay"))$("membersOverlay").hidden=true;});
  $("workspaceInviteBtn").addEventListener("click", inviteWorkspaceMember);
  $("workspaceInviteSubmit").addEventListener("click",submitWorkspaceInvite);
  $("workspaceCopyCommunityLinkBtn").addEventListener("click",copyCommunityJoinLink);
  $("workspaceMembersBtn").addEventListener("click", manageWorkspaceMembers);
  $("pickContactBtn").addEventListener("click", pickContact);
  $("addContactToggleBtn").addEventListener("click", function () {
    var b = $("addContactBox");
    var trigger = $("addContactToggleBtn");
    b.hidden = !b.hidden;
    trigger.setAttribute("aria-expanded", String(!b.hidden));
    trigger.classList.toggle("is-open", !b.hidden);
    trigger.querySelector(".contact-add-copy strong").textContent = b.hidden ? "Dost add karein" : "Form band karein";
    trigger.querySelector(".contact-add-copy small").textContent = b.hidden ? "Jo abhi Easy Khata par nahi hain" : "Naya dost add karna cancel karein";
    trigger.querySelector(".contact-add-icon").textContent = b.hidden ? "＋" : "×";
    if (!b.hidden) {
      $("newContactName").focus();
      b.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
  if (navigator.contacts && navigator.contacts.select) $("pickContactBtn").hidden = false;
  $("notifBtn").addEventListener("click", showNotifView);
  $("acctHiddenBtn").addEventListener("click", function () { showView("hidden"); renderHiddenTxns(); });
  // v74: Settings se guest hisaab transfer — wohi dohri confirmation.
  $("acctGuestTransferBtn").addEventListener("click", function () {
    if (!guestHasData()) { $("acctGuestTransferMsg").textContent = "Is device par koi guest hisaab nahi hai."; return; }
    $("acctGuestTransferMsg").textContent = "";
    offerGuestMigration();
  });
  $("hiddenBackBtn").addEventListener("click", function () { showView("account"); });
  $("acctBackupMenuBtn").addEventListener("click", function () { showView("backup"); });
  // v87: recurring page — list + wapas + pause/delete (delegation, aik listener).
  $("acctRecurringBtn").addEventListener("click", function () { renderRecurringList(); showView("recurring"); });
  $("recurringBackBtn").addEventListener("click", function () { showView("account"); });
  $("recurringList").addEventListener("click", function (e) {
    var t = e.target.closest("[data-rec-toggle]");
    if (t) { toggleRecurringRule(t.getAttribute("data-rec-toggle")); return; }
    var d = e.target.closest("[data-rec-del]");
    if (d) deleteRecurringRule(d.getAttribute("data-rec-del"));
  });
  $("backupBackBtn").addEventListener("click", function () { showView("account"); });
  $("notifBackBtn").addEventListener("click", showAppView);
  $("markAllReadBtn").addEventListener("click", markAllNotifRead);
  $("notifList").addEventListener("click", function (e) {
    // Link par tap — link khule, na read ho na expand.
    if (e.target.closest && e.target.closest("a")) return;
    var row = e.target.closest ? e.target.closest("[data-notif]") : null;
    if (!row) return;
    var id = row.getAttribute("data-notif");
    expandedNotifIds[id] = !expandedNotifIds[id]; // tap = poora text kholo/band karo
    if (row.classList.contains("unread")) markNotifRead(id); // reload par expand state rehti hai
    else renderNotifList();
  });
  // v79: filter chips — Sab / Naye / Parhe hue.
  document.querySelectorAll("[data-notif-filter]").forEach(function (b) {
    b.addEventListener("click", function () {
      notifFilter = b.getAttribute("data-notif-filter");
      renderNotifList();
    });
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
  // v68: badge sirf ASAL offline par dikhta hai. Pehle offlineMode aik
  // sticky latch tha — aik dafa load timeout ya server 5xx par lag jata
  // tha aur phir khud kabhi nahi hat-ta tha (slow connection par bhi),
  // jab ke internet maujood tha. Ab: (1) server ka jawab (5xx bhi) =
  // internet maujood, offlineMode nahi lagta; (2) load fail par halka
  // probe har 15s mein dobara check karta hai aur theek hote hi badge
  // hata deta hai; (3) har kamyab jawab par bhi badge foran update hota hai.
  var offlineRecheckTimer = null;
  function probeReachability() {
    // Chhota sa Supabase probe: koi bhi HTTP jawab (200 ho ya 401) =
    // internet maujood hai; sirf network error/timeout = asal offline.
    return fetchWithTimeout(API + "/rest/v1/khata_profiles?select=id&limit=1", {
      method: "GET",
      headers: { "apikey": ANON, "Authorization": "Bearer " + authToken() }
    }, 8000).then(function () { return true; }).catch(function () { return false; });
  }
  function stopOfflineRecheck() {
    if (offlineRecheckTimer) { clearInterval(offlineRecheckTimer); offlineRecheckTimer = null; }
  }
  function startOfflineRecheck() {
    if (offlineRecheckTimer) return;
    offlineRecheckTimer = setInterval(function () {
      if (!offlineMode) { stopOfflineRecheck(); return; }
      if (guestMode) return;
      if (!navigator.onLine) { renderOffline(); return; }
      probeReachability().then(function (ok) {
        if (ok) { offlineMode = false; stopOfflineRecheck(); renderOffline(); flushOutbox(); }
        else renderOffline();
      });
    }, 15000);
  }
  function renderOffline() {
    var b = $("offlineBadge");
    if (!b) return;
    if (guestMode) {
      // v24: guest mode mein koi "Sync pending" nahi hota — sirf asli
      // offline honay par badge dikhe (sab kuch local hai).
      b.hidden = navigator.onLine;
      b.textContent = "Offline";
      return;
    }
    var pending = loadOutbox().length;
    var recentlyReachable = lastNetworkResponseAt && (Date.now()-lastNetworkResponseAt)<20000;
    var actuallyOffline = offlineMode || (!navigator.onLine && !recentlyReachable);
    if (actuallyOffline) {
      // offlineMode = load fail hua aur cache se dikhaya ja raha hai
      // (navigator.onLine kabhi kabhi ghalat "online" batata hai).
      // v24.8: offline honay par bhi pending count dikhao (sachhi haalat).
      b.hidden = false;
      b.textContent = pending > 0 ? "Offline · "+pending+" changes baqi" : "Offline";
    } else if (pending > 0) {
      b.hidden = false;
      b.textContent = pending+" changes baqi hain";
    } else {
      b.hidden = true;
    }
  }
  window.addEventListener("online", function () {
    // Browser kehta hai internet wapas aaya — probe se tasdeeq karo
    // (kabhi kabhi "online" event par bhi server nahi milta).
    probeReachability().then(function (ok) {
      if (ok && offlineMode) { offlineMode = false; stopOfflineRecheck(); }
      renderOffline(); flushOutbox();
    });
  });
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
  // v24.1: guest mode mein navbar login icon — tap par login/sign-up page khulta hai.
  var loginIconBtn = $("loginIconBtn");
  if (loginIconBtn) loginIconBtn.addEventListener("click", function () { showAuth(); });
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

