/* MealMate UI engine.
   This is the original MealMate app logic, kept intact (same screens, same
   calculations, same markup/classes) and mounted inside Next.js. What changed:
     - storage: DB is no longer read/written from localStorage. The React host
       (components/AppHost) loads the group's data from Supabase into DB and
       every saveDB() call is handed to CTX.persist(), which diff-syncs the
       changed rows back to Supabase (see lib/engine/sync.js).
     - auth: login/signup screens moved to real Next.js pages backed by
       Supabase Auth. SESSION now comes from the signed-in user's profile.
     - roles: every mutating action is gated by can(permission). The same
       rules are enforced again server-side by Postgres Row Level Security.
     - new "Team & Invites" page for invite codes/links, roles and removal. */
/* eslint-disable */
import { ICONS } from "./icons";

var LOGO_ICON_URL = "/logo-icon.png";
var CTX = null;          /* host context: persist, api, permissions, etc. */
var ALIVE = false;       /* listeners are no-ops while the engine is unmounted */
var MIDNIGHT_TIMER = null;
var STALE_TIMER = null;

function on(target, type, fn, opts) {
  target.addEventListener(type, function (e) { if (ALIVE) fn(e); }, opts);
}

/* ============================== PERMISSIONS ============================== */
function can(permission) {
  return !!(CTX && CTX.permissions && CTX.permissions.indexOf(permission) >= 0);
}
function currentRole() { return (CTX && CTX.role) || "MEMBER"; }

/* data-action -> permission. Anything not listed is read-only / navigation. */
var ACTION_PERMS = {
  "edit-member": "members.manage", "toggle-member-status": "members.manage", "set-meal-default": "members.manage",
  "approve-join": "members.manage", "reject-join": "members.manage",
  "set-meal": "meals.edit", "set-meal-all": "meals.edit",
  "add-deposit": "deposits.manage", "edit-deposit": "deposits.manage", "delete-deposit": "deposits.manage",
  "add-expense": "expenses.create", "edit-expense": "expenses.edit", "delete-expense": "expenses.delete",
  "open-close-month": "month.close", "confirm-close-month": "month.close",
  "open-close-store-month": "month.close", "confirm-close-store-month": "month.close",
  "open-edit-stock-row": "stock.edit", "confirm-edit-stock": "stock.edit",
  "shopping-select-category": "shopping.manage", "shopping-add-others": "shopping.manage", "shopping-remove-item": "shopping.manage",
  "shopping-toggle-item": "shopping.manage", "shopping-toggle-checked": "shopping.manage", "shopping-quantity-input": "shopping.manage",
  "regenerate-invite": "invites.manage", "confirm-regenerate-invite": "invites.manage", "toggle-invite": "invites.manage", "toggle-auto-approve": "invites.manage",
  "copy-invite-code": "invites.manage", "copy-invite-link": "invites.manage", "share-invite": "invites.manage",
  "change-role": "roles.manage", "confirm-change-role": "roles.manage",
  "remove-account": "members.remove", "confirm-remove-account": "members.remove",
  "import-backup": "settings.manage", "import-local-data": "settings.manage",
};
/* Actions that write data (blocked until the first fresh server load lands). */
var WRITE_ACTIONS = {
  "toggle-member-status": 1, "set-meal-default": 1, "set-meal": 1, "set-meal-all": 1, "confirm-delete": 1,
  "confirm-close-month": 1, "confirm-close-store-month": 1, "confirm-edit-stock": 1,
  "shopping-add-others": 1, "shopping-remove-item": 1, "shopping-toggle-item": 1, "shopping-toggle-checked": 1, "shopping-quantity-input": 1,
};
/* Controls that must stay visible (they show state) but become read-only. */
var LOCK_ONLY = { "set-meal": 1, "shopping-toggle-checked": 1, "shopping-quantity-input": 1 };

function guardAction(action) {
  var perm = ACTION_PERMS[action];
  if (perm && !can(perm)) { toast("You don't have permission to do that.", "error"); return false; }
  if (WRITE_ACTIONS[action] && CTX && !CTX.isFresh()) { toast("Still syncing with the server — try again in a second.", "error"); return false; }
  return true;
}

/* Hides / locks controls the current role can't use, right after each render. */
function applyPermissionUI(root) {
  if (!root) return;
  root.querySelectorAll("[data-action]").forEach(function (el) {
    var perm = ACTION_PERMS[el.dataset.action];
    if (!perm || can(perm)) return;
    if (el.dataset.action === "set-meal-all") {
      var tr = el.closest("tr");
      if (tr) tr.remove();
      return;
    }
    if (LOCK_ONLY[el.dataset.action]) {
      el.disabled = true;
      if (el.tagName === "INPUT" && el.type === "text") el.readOnly = true;
      el.classList.add("mm-locked");
      return;
    }
    el.remove();
  });
  root.querySelectorAll("[data-perm]").forEach(function (el) {
    if (!can(el.dataset.perm)) el.remove();
  });
}

/* ============================== ICONS ============================== */
/* Every raw ICONS[name] SVG string already ships with its own baked-in size
   (e.g. class="... h-4.5 w-4.5 ..."), since that's how the icon looked the
   one place it was originally used. When a call site passes its own `cls`
   (almost always to set a DIFFERENT size for this particular usage), it
   must REPLACE that original h- and w- pair rather than merely being
   prepended alongside it — otherwise the SVG ends up with two conflicting
   height/width utility classes at once (e.g. both "h-4 w-4" and "h-4.5
   w-4.5"), and depending on which one the cascade applies, the icon can
   render at an unexpected/inconsistent size relative to the gap next to it,
   which is what caused icons to visually overlap their button labels. */
function icon(name, cls) {
  var svg = ICONS[name] || "";
  if (cls) {
    svg = svg.replace(/\bh-[\w.-]+\s+w-[\w.-]+\s+/, "");
    svg = svg.replace('class="', 'class="' + cls + " ");
  }
  return svg;
}

/* ============================== UTIL ============================== */
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function uid(prefix) {
  return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function formatCurrency(n) {
  var v = Math.round((n + Number.EPSILON) * 100) / 100;
  return "৳" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function formatNumber(n, decimals) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
}
function initials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(function (p) { return p[0] ? p[0].toUpperCase() : ""; })
    .join("");
}

/* ============================== CALCULATIONS (mirrors src/lib/calculations.ts) ============================== */
function calcMealRate(totalExpense, totalMeals) {
  return totalMeals > 0 ? totalExpense / totalMeals : 0;
}
function calcAvailableBalance(totalMoneyAdded, totalMealExpense) {
  return totalMoneyAdded - totalMealExpense;
}

/* ============================== DATE / MONTH HELPERS ============================== */
function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }
function inMonth(dateStr, monthKey) { return monthKeyOf(dateStr) === monthKey; }
function monthLabel(monthKey) {
  var parts = monthKey.split("-");
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function daysInMonth(monthKey) {
  var parts = monthKey.split("-");
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0)).getUTCDate();
}
function eachDateInMonth(monthKey) {
  var n = daysInMonth(monthKey);
  var out = [];
  for (var i = 1; i <= n; i++) out.push(monthKey + "-" + String(i).padStart(2, "0"));
  return out;
}
function shiftDate(dateKey, delta) {
  var d = new Date(dateKey + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function dateLabelShort(dateKey) {
  return new Date(dateKey + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function dateLabelLong(dateKey) {
  return new Date(dateKey + "T00:00:00.000Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function dateLabelMed(dateKey) {
  return new Date(dateKey + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/* Always the real current calendar date (local time), not the latest date
   found in recorded data — so the app rolls over to a new day automatically
   at local midnight instead of freezing on whatever day was last recorded. */
function latestDateAcross() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, "0");
  var d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}
function latestMonthKey() { return monthKeyOf(latestDateAcross()); }

/* ============================== DATA LAYER ==============================
   DB has exactly the same shape as the old localStorage "mealmate_db_v2"
   object, but it is owned by the sync layer (lib/engine/sync.js): it is
   filled from Supabase on login, refreshed when another device changes
   something, and every saveDB() call below schedules a diff-based upload of
   only the rows that actually changed. */
var DB, SESSION, TOASTS = [];

function saveDB() { if (CTX) CTX.persist(); }

function activeMembers() { return DB.members.filter(function (m) { return m.status === "ACTIVE"; }); }
function memberById(id) { return DB.members.filter(function (m) { return m.id === id; })[0] || null; }

/* ============================== TOASTS ============================== */
function toast(message, tone) {
  var id = uid("toast");
  TOASTS.push({ id: id, message: message, tone: tone || "default" });
  renderToasts();
  setTimeout(function () {
    TOASTS = TOASTS.filter(function (t) { return t.id !== id; });
    renderToasts();
  }, 3200);
}
function renderToasts() {
  var host = document.getElementById("toast-host");
  if (!host) return;
  host.innerHTML = TOASTS.map(function (t) {
    var toneClass = t.tone === "error" ? "bg-danger-600 text-white" : t.tone === "success" ? "bg-navy-900 text-white" : "bg-navy-950 text-white";
    return '<div class="' + toneClass + ' rounded-xl px-4 py-3 text-sm font-medium shadow-[var(--shadow-popover)] animate-slide-up">' + esc(t.message) + "</div>";
  }).join("");
}

/* ============================== ROUTER ============================== */
function parseHash() {
  var raw = location.hash.replace(/^#\/?/, "");
  var qIndex = raw.indexOf("?");
  var path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  var query = {};
  if (qIndex >= 0) {
    raw.slice(qIndex + 1).split("&").forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split("=");
      query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
  }
  return { path: path || "dashboard", query: query };
}
function navigate(path, query) {
  var qs = query ? Object.keys(query).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(query[k]); }).join("&") : "";
  location.hash = "#/" + path + (qs ? "?" + qs : "");
}
function currentQueryWith(overrides) {
  var q = parseHash().query;
  var out = {};
  Object.keys(q).forEach(function (k) { out[k] = q[k]; });
  Object.keys(overrides).forEach(function (k) { out[k] = overrides[k]; });
  return out;
}

on(window, "hashchange", render);

/* Re-renders the app right at the next local midnight so "today" (see
   latestDateAcross()) advances on its own — no manual refresh/navigation
   needed. Re-schedules itself after each firing so this keeps working every
   day the tab stays open. */
function scheduleMidnightRefresh() {
  clearTimeout(MIDNIGHT_TIMER);
  var now = new Date();
  var nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  var delay = nextMidnight.getTime() - now.getTime();
  MIDNIGHT_TIMER = setTimeout(function () {
    render();
    scheduleMidnightRefresh();
  }, delay);
}

function render() {
  if (!ALIVE || !DB || !SESSION) return;
  var r = parseHash();
  var path = r.path, query = r.query;

  var app = document.getElementById("app");
  if (!app) return;
  var mobileDrawerWasOpen = app.dataset.drawerOpen === "1";
  var previousPath = app.dataset.path || "";
  var scrollY = window.scrollY;

  if (path === "dashboard") {
    app.innerHTML = renderShell(renderDashboard(query.month || ""), "dashboard", mobileDrawerWasOpen);
  } else if (path === "members") {
    app.innerHTML = renderShell(renderMembers(), "members", mobileDrawerWasOpen);
  } else if (path === "shopping-list") {
    app.innerHTML = renderShell(renderShoppingList(query.category || "", query.q || ""), "shopping-list", mobileDrawerWasOpen);
  } else if (path === "meals") {
    var dk = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : latestDateAcross();
    app.innerHTML = renderShell(renderMeals(dk), "meals", mobileDrawerWasOpen);
  } else if (path === "money") {
    app.innerHTML = renderShell(renderMoney(query.q || "", query.month || ""), "money", mobileDrawerWasOpen);
  } else if (path === "expenses") {
    app.innerHTML = renderShell(renderExpenses(query.q || "", query.month || "", query.from || "", query.to || ""), "expenses", mobileDrawerWasOpen);
  } else if (path === "store") {
    app.innerHTML = renderShell(renderStore(query.month || ""), "store", mobileDrawerWasOpen);
  } else if (path === "hisab") {
    app.innerHTML = renderShell(renderHisab(query.month || ""), "hisab", mobileDrawerWasOpen);
  } else if (path === "summary") {
    app.innerHTML = renderShell(renderSummary(query.month || ""), "summary", mobileDrawerWasOpen);
  } else if (path === "balance") {
    app.innerHTML = renderShell(renderBalance(), "", mobileDrawerWasOpen);
  } else if (path === "team" && can("members.view")) {
    app.innerHTML = renderShell(renderTeam(), "team", mobileDrawerWasOpen);
    /* show what we have instantly, then refresh it in the background */
    if ((!TEAM.loaded || previousPath !== "team") && !TEAM.loading) loadTeam();
  } else if (path === "settings/password") {
    app.innerHTML = renderShell(renderSettingsPage(), "", mobileDrawerWasOpen);
  } else {
    navigate("dashboard");
    return;
  }
  app.dataset.path = path;
  applyPermissionUI(app);
  /* Same page re-rendering (a data refresh, a toggle) keeps its scroll
     position and skips the entrance animation; a real navigation starts
     at the top with a soft fade-in. */
  if (previousPath === path) {
    app.classList.add("mm-no-anim");
    window.scrollTo(0, scrollY);
  } else {
    app.classList.remove("mm-no-anim");
    if (previousPath) window.scrollTo(0, 0);
  }
  renderToasts();
  renderSyncBadge();
}

/* A render triggered by someone ELSE's change (realtime refresh). Never
   yanks an open modal or a half-typed input away from the user: if they are
   in the middle of something, wait until they're done. */
function isUserBusy() {
  var app = document.getElementById("app");
  if (!app) return false;
  if (app.querySelector('[id$="-modal"]:not([hidden])')) return true;
  var ae = document.activeElement;
  if (ae && app.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true;
  return false;
}
function softRender() {
  clearTimeout(STALE_TIMER);
  if (isUserBusy()) {
    STALE_TIMER = setTimeout(softRender, 1500);
    return;
  }
  render();
}

/* ============================== SYNC STATUS BADGE ============================== */
function renderSyncBadge() {
  var el = document.getElementById("mm-sync-badge");
  if (!el || !CTX) return;
  var st = CTX.syncState ? CTX.syncState() : "idle";
  el.dataset.state = st;
  el.title = st === "saving" ? "Saving changes…" : st === "error" ? "Some changes could not be saved" : st === "offline" ? "You're offline — changes will sync when you're back" : "All changes saved";
  var label = el.querySelector("[data-sync-label]");
  if (label) label.textContent = st === "saving" ? "Saving" : st === "error" ? "Not saved" : st === "offline" ? "Offline" : "Synced";
}

/* ============================== MOUNT API ============================== */
/* ctx: {
     db, profile:{name,email,avatarUrl}, groupId, groupName, role, permissions[],
     persist(), isFresh(), syncState(), inviteBaseUrl,
     api: { signOut, updateProfile, changePassword, listAccounts, getInvite,
            regenerateInvite, setInviteEnabled, setInviteAutoApprove, changeRole, removeAccount,
            renameGroup, importBackup },
     friendlyError(err)
   } */
export function mountEngine(ctx) {
  CTX = ctx;
  DB = ctx.db;
  SESSION = ctx.profile;
  ALIVE = true;
  TEAM = { loaded: false, loading: false, accounts: [], invite: null, requests: [], error: "" };
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", location.pathname + location.search + "#/dashboard");
  }
  render();
  scheduleMidnightRefresh();
  return {
    refresh: softRender,
    renderNow: render,
    updateContext: function (patch) {
      Object.keys(patch).forEach(function (k) { CTX[k] = patch[k]; });
      if (patch.profile) SESSION = patch.profile;
      if (patch.role || patch.permissions) { TEAM.loaded = false; }
      softRender();
    },
    teamChanged: function () { TEAM.loaded = false; if (parseHash().path === "team") loadTeam(); },
    syncChanged: renderSyncBadge,
    toast: toast,
    unmount: function () {
      ALIVE = false;
      clearTimeout(MIDNIGHT_TIMER);
      clearTimeout(STALE_TIMER);
      var app = document.getElementById("app");
      if (app) app.innerHTML = "";
    },
  };
}

/* ============================== SHARED UI HELPERS ============================== */
var TONE_CLASSES = {
  navy: "bg-navy-900 text-white",
  success: "bg-success-100 text-success-700",
  danger: "bg-danger-100 text-danger-700",
  warning: "bg-warning-100 text-warning-700",
  gray: "bg-gray-100 text-gray-500",
};
var BADGE_TONE_CLASSES = {
  navy: "bg-navy-100 text-navy-900",
  success: "bg-success-100 text-success-700",
  danger: "bg-danger-100 text-danger-700",
  warning: "bg-warning-100 text-warning-700",
  gray: "bg-gray-100 text-gray-500",
};
function badge(text, tone) {
  return '<span class="status-pill ' + (BADGE_TONE_CLASSES[tone] || BADGE_TONE_CLASSES.gray) + '"><span class="status-pill-dot"></span>' + esc(text) + "</span>";
}
function statCard(opts) {
  var value = opts.decimals ? formatNumber(opts.value, opts.decimals) : formatNumber(Math.round(opts.value * 100) / 100);
  var isInteractive = opts.href || opts.interactive;
  var compact = opts.compact;
  var body =
    '<div class="card-premium stat-card-bg group relative flex flex-col ' + (compact ? "gap-2 rounded-xl p-3.5" : "gap-3 rounded-2xl p-5") + ' shadow-[var(--shadow-card)] animate-slide-up ' +
    (isInteractive ? "card-premium--interactive" : "") + '">' +
      '<div class="flex items-start justify-between">' +
        '<span class="stat-card-icon flex items-center justify-center rounded-xl ' + (compact ? "h-8 w-8" : "h-10 w-10") + " " + (TONE_CLASSES[opts.tone] || TONE_CLASSES.navy) + '">' + icon(opts.icon, compact ? "h-4 w-4" : "h-5 w-5") + "</span>" +
      "</div>" +
      "<div>" +
        '<p class="' + (compact ? "text-lg" : "text-2xl") + ' font-semibold tracking-tight text-white tabular-nums">' + (opts.prefix || "") + value + (opts.suffix || "") + "</p>" +
        '<p class="' + (compact ? "mt-0.5 text-xs" : "mt-1 text-sm") + ' font-medium text-white/70">' + esc(opts.label) + "</p>" +
      "</div>" +
      (opts.helperText ? '<p class="text-xs text-white/50">' + esc(opts.helperText) + "</p>" : "") +
    "</div>";
  return opts.href ? '<a href="' + opts.href + '" class="block">' + body + "</a>" : body;
}
function emptyState(iconName, title, description) {
  return (
    '<div class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-gray-100/40 px-6 py-12 text-center animate-fade-in">' +
      '<span class="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-900">' + icon(iconName, "h-6 w-6") + "</span>" +
      '<div class="space-y-1">' +
        '<p class="text-sm font-semibold text-foreground">' + esc(title) + "</p>" +
        (description ? '<p class="text-sm text-muted">' + esc(description) + "</p>" : "") +
      "</div>" +
    "</div>"
  );
}
function dateSwitcherHtml(dateKey) {
  var today = latestDateAcross();
  var isToday = dateKey === today;
  return (
    '<div class="flex items-center gap-2">' +
      '<div class="flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-card)]">' +
        '<button data-action="date-nav" data-date="' + shiftDate(dateKey, -1) + '" class="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("chevron-left", "h-4 w-4") + "</button>" +
        '<span class="min-w-[11rem] text-center text-sm font-semibold text-foreground">' + dateLabelLong(dateKey) + "</span>" +
        '<button data-action="date-nav" data-date="' + shiftDate(dateKey, 1) + '" class="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("chevron-right", "h-4 w-4") + "</button>" +
      "</div>" +
      (isToday ? "" : '<button data-action="date-nav" data-date="' + today + '" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-navy-900 shadow-[var(--shadow-card)] transition-colors hover:bg-navy-50">Today</button>') +
    "</div>"
  );
}
function searchBoxHtml(placeholder, value) {
  return (
    '<div class="relative">' +
      '<span class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">' + icon("search", "h-4 w-4") + "</span>" +
      '<input data-action="search-input" value="' + esc(value || "") + '" placeholder="' + esc(placeholder) + '" class="w-full rounded-xl border border-border bg-surface py-2.5 pl-12 pr-3.5 text-sm text-foreground placeholder:text-muted transition-all focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20 sm:w-56" />' +
    "</div>"
  );
}
function modalWrapper(id, title, bodyHtml) {
  return (
    '<div id="' + id + '" hidden class="fixed inset-0 z-50 flex items-center justify-center p-4">' +
      '<div class="absolute inset-0 bg-navy-950/40 backdrop-blur-[2px]" data-action="close-modal" data-modal="' + id + '"></div>' +
      '<div class="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-[var(--shadow-popover)] animate-scale-in">' +
        '<div class="mb-4 flex items-center justify-between">' +
          '<h2 class="text-lg font-semibold text-foreground">' + esc(title) + "</h2>" +
          '<button data-action="close-modal" data-modal="' + id + '" class="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("x", "h-4.5 w-4.5") + "</button>" +
        "</div>" +
        bodyHtml +
      "</div>" +
    "</div>"
  );
}
function fieldLabel(text) { return '<label class="mb-1.5 block text-sm font-medium text-foreground">' + esc(text) + "</label>"; }
var FIELD_CLASS = "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted transition-all focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20";

/* ============================== DASHBOARD ============================== */
/* This Month / Current Meal Rate are scoped to a month. Everything else on the
   dashboard (Total Money Added, Meal Expense, Available Balance) is all-time. */
function computeMonthSummary(monthKey) {
  var today = latestDateAcross();
  var dates = eachDateInMonth(monthKey).filter(function (d) { return d <= today; });
  var members = activeMembers();
  var totalMeals = 0;
  dates.forEach(function (d) {
    members.forEach(function (m) {
      var meal = mealFor(m.id, d);
      totalMeals += (meal.breakfast ? 1 : 0) + (meal.lunch ? 1 : 0) + (meal.dinner ? 1 : 0);
    });
  });
  var expenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); });
  var mealExpense = expenses.reduce(function (s, e) { return s + e.amount; }, 0);
  var mealRate = calcMealRate(mealExpense, totalMeals);
  var deposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); });
  var moneyAdded = deposits.reduce(function (s, d) { return s + d.amount; }, 0);
  var availableBalance = calcAvailableBalance(moneyAdded, mealExpense);
  return { totalMeals: totalMeals, mealExpense: mealExpense, mealRate: mealRate, moneyAdded: moneyAdded, availableBalance: availableBalance };
}
function computeAllTimeSummary() {
  var totalMoneyAdded = DB.deposits.reduce(function (s, d) { return s + d.amount; }, 0);
  var totalMealExpense = DB.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
  var availableBalance = calcAvailableBalance(totalMoneyAdded, totalMealExpense);
  return { totalMoneyAdded: totalMoneyAdded, totalMealExpense: totalMealExpense, availableBalance: availableBalance };
}

/* Time-of-day greeting for the dashboard header, based on the viewer's own
   local clock (not any date recorded in the data) so it always matches
   when they're actually looking at the page. */
function greetingForCurrentTime() {
  var hour = new Date().getHours();
  if (hour < 5) return "Good Night";
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  if (hour < 21) return "Good Evening";
  return "Good Night";
}

function renderDashboard(monthKeyParam) {
  var monthKey = monthKeyParam && /^\d{4}-\d{2}$/.test(monthKeyParam) ? monthKeyParam : latestMonthKey();
  var s = computeMonthSummary(monthKey);

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        "<div>" +
          '<h1 class="text-2xl font-semibold tracking-tight text-foreground">' + esc(greetingForCurrentTime()) + ", " + esc((SESSION.name || "").split(" ")[0] || "there") + ' 👋</h1>' +
          '<p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">Here\'s ' + esc(CTX.groupName) + "'s overview for " + monthLabel(monthKey) + "." + roleBadgeHtml(currentRole()) + "</p>" +
        "</div>" +
        monthSwitcherHtml(monthKey, "dashboard-month-nav") +
      "</div>" +

      '<div class="flex flex-wrap gap-3">' +
        quickActionLink("utensils-crossed", can("meals.edit") ? "Add Meal" : "View Meals", "meals") +
        quickActionLink("wallet", can("deposits.manage") ? "Add Money" : "View Money", "money") +
        quickActionLink("shopping-cart", can("expenses.create") ? "Add Expense" : "View Expenses", "expenses") +
        (can("members.manage") ? quickActionLink("user-plus", "Join Requests", "team") : "") +
        (can("invites.manage") ? quickActionLink("shield-check", "Invite Members", "team") : "") +
      "</div>" +

      '<div class="grid grid-cols-2 gap-3 lg:grid-cols-3">' +
        statCard({ label: "Money Added", value: s.moneyAdded, prefix: "৳", icon: "trending-up", tone: "success", href: "#/money", compact: true }) +
        statCard({ label: "Available Balance", value: s.availableBalance, prefix: "৳", icon: "banknote", tone: "navy", href: "#/balance", helperText: "Click for a breakdown", compact: true }) +
        statCard({ label: "Meal Expense", value: s.mealExpense, prefix: "৳", icon: "trending-down", tone: "danger", href: "#/expenses", compact: true }) +
        statCard({ label: "Total Meals", value: s.totalMeals, icon: "utensils-crossed", tone: "gray", href: "#/meals", compact: true }) +
        statCard({ label: "Meal Rate", value: s.mealRate, decimals: 2, prefix: "৳", suffix: " / meal", icon: "gauge", tone: "warning", href: "#/meals", compact: true }) +
        statCard({ label: "Active Members", value: activeMembers().length, icon: "users", tone: "gray", href: "#/members", compact: true }) +
      "</div>" +
    "</div>"
  );
}

function quickActionLink(iconName, label, path) {
  return '<a href="#/' + path + '" data-action="quick-action-hover-fill" class="quick-action-pill card-premium card-premium--interactive inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-card)]">' + icon(iconName, "h-4 w-4") + esc(label) + "</a>";
}

function cashRow(label, value, tone, sign, bold) {
  var s = sign !== undefined && sign !== null ? sign : (value < 0 ? "−" : "");
  return (
    '<div class="flex items-center justify-between rounded-xl ' + (bold ? "bg-navy-50" : "border border-border") + ' px-4 py-3">' +
      '<span class="text-sm ' + (bold ? "font-semibold text-navy-900" : "text-muted") + '">' + esc(label) + "</span>" +
      '<span class="' + (bold ? "text-lg font-bold" : "font-semibold") + " tabular-nums " + (tone === "success" ? "text-success-700" : tone === "danger" ? "text-danger-600" : "text-navy-900") + '">' + s + formatCurrency(Math.abs(value)) + "</span>" +
    "</div>"
  );
}

/* Soft, on-brand palette for donut slices / legend dots — reuses the app's
   existing --navy-N / --success-N / --warning-N / --danger-N tokens plus a
   couple of muted grays, cycled through when there are more slices than
   colors. */
var DONUT_PALETTE = ["var(--navy-700)", "var(--success-600)", "var(--warning-600)", "var(--danger-600)", "var(--navy-400, #3a5a9c)", "var(--gray-500)"];

/* Renders a clean SVG donut ring (stroke-dasharray arcs, rounded caps) with a
   center label, plus a legend of colored dots + rounded progress bars. Takes
   {title, centerLabel, centerValue, slices:[{label, value, color}]}. Purely
   presentational over already-computed numbers — no new data/calculations. */
function donutChartHtml(opts) {
  var slices = (opts.slices || []).filter(function (s) { return s.value > 0; });
  var total = slices.reduce(function (a, s) { return a + s.value; }, 0);
  var size = 160, stroke = 18, r = (size - stroke) / 2, c = size / 2, circumference = 2 * Math.PI * r;

  var arcs = "";
  var offsetAcc = 0;
  if (total > 0) {
    slices.forEach(function (s, i) {
      var frac = s.value / total;
      var dash = Math.max(frac * circumference - 2, 0); /* small gap between slices */
      var gap = circumference - dash;
      var rotation = (offsetAcc / total) * 360 - 90;
      var color = s.color || DONUT_PALETTE[i % DONUT_PALETTE.length];
      arcs += '<circle class="donut-ring-fill" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + dash + " " + gap + '" stroke-dashoffset="0" transform="rotate(' + rotation + " " + c + " " + c + ')"></circle>';
      offsetAcc += s.value;
    });
  }

  var ring = total > 0 ?
    ('<svg class="donut-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--gray-100)" stroke-width="' + stroke + '"></circle>' +
      arcs +
    "</svg>") :
    ('<svg class="donut-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--gray-100)" stroke-width="' + stroke + '"></circle>' +
    "</svg>");

  var legend = slices.map(function (s, i) {
    var pct = total > 0 ? Math.round((s.value / total) * 1000) / 10 : 0;
    var color = s.color || DONUT_PALETTE[i % DONUT_PALETTE.length];
    return (
      '<div class="space-y-1.5">' +
        '<div class="flex items-center justify-between gap-2 text-sm">' +
          '<span class="flex min-w-0 items-center gap-2 font-medium text-foreground"><span class="shrink-0 rounded-full" style="width:10px;height:10px;background:' + color + '"></span><span class="truncate">' + esc(s.label) + "</span></span>" +
          '<span class="shrink-0 tabular-nums text-muted">' + pct + "%</span>" +
        "</div>" +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + "%;background:" + color + '"></div></div>' +
      "</div>"
    );
  }).join("");

  return (
    '<div class="flex flex-col items-center gap-6 sm:flex-row sm:items-center">' +
      '<div class="relative shrink-0" style="width:' + size + "px;height:" + size + 'px">' +
        ring +
        '<div class="donut-center">' +
          '<span class="text-xl font-bold tabular-nums text-foreground">' + esc(opts.centerValue || "") + "</span>" +
          '<span class="text-xs text-muted">' + esc(opts.centerLabel || "") + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="w-full min-w-0 flex-1 space-y-3">' + (legend || '<p class="text-sm text-muted">' + esc(opts.emptyText || "No data yet") + "</p>") + "</div>" +
    "</div>"
  );
}

/* ============================== MEMBERS ============================== */
var AVATAR_COLORS = ["#0B1F4B", "#1A3570", "#16A34A", "#B45309", "#7C3AED", "#DC2626"];

/* ============================== EXPENSE CATEGORIES ============================== */
var EXPENSE_CATEGORIES = [
  { name: "Fish & Meat", items: ["Chicken", "Beef", "Fish", "Egg"] },
  { name: "Vegetables", items: ["Potato", "Onion", "Garlic", "Ginger", "Tomato", "Green Chili", "Brinjal", "Cabbage", "Cauliflower", "Other Vegetables"] },
  { name: "Grocery", items: ["Rice", "Dal", "Flour / Atta", "Salt", "Sugar", "Cooking Oil", "Soy Sauce", "Noodles", "Pasta", "Biscuit", "Bread"] },
  { name: "Spices", items: ["Turmeric", "Chili Powder", "Cumin", "Coriander", "Garam Masala", "Black Pepper", "Other Spices"] },
  { name: "Fruits", items: ["Banana", "Apple", "Orange", "Guava", "Papaya", "Lemon", "Other Fruits"] },
  { name: "Household", items: ["Drinking Water", "Tissue", "Dishwashing Liquid", "Detergent", "Garbage Bag", "Soap", "Shampoo", "Toothpaste", "Other Household"] },
];
function itemsForCategory(categoryName) {
  var cat = EXPENSE_CATEGORIES.filter(function (c) { return c.name === categoryName; })[0];
  return cat ? cat.items : [];
}

/* Renders either the member's/user's uploaded picture (data-URL) as a circular
   <img>, or a colored initials circle as a fallback — reused for members,
   the topbar and the profile settings page. sizeClass e.g. "h-9 w-9". */
function avatarHtml(pictureUrl, name, sizeClass, bgColor, textSizeClass) {
  if (pictureUrl) {
    return '<img src="' + esc(pictureUrl) + '" alt="' + esc(name) + '" class="' + sizeClass + ' shrink-0 rounded-full object-cover" />';
  }
  return '<span class="flex ' + sizeClass + ' shrink-0 items-center justify-center rounded-full font-semibold text-white ' + (textSizeClass || "text-xs") + '" style="background:' + (bgColor || "#888") + '">' + esc(initials(name)) + "</span>";
}

function renderMembers() {
  var rows = DB.members.slice().sort(function (a, b) {
    if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  }).map(function (m) {
    var contactBits = [];
    if (m.phone) contactBits.push(esc(m.phone));
    if (m.email) contactBits.push(esc(m.email));
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' +
          avatarHtml(m.pictureUrl, m.name, "h-9 w-9", m.avatarColor) +
          "<div>" +
            '<span class="block font-medium text-foreground">' + esc(m.name) + "</span>" +
            (contactBits.length ? '<span class="block text-xs text-muted">' + contactBits.join(" · ") + "</span>" : "") +
          "</div>" +
        "</div></td>" +
        '<td class="px-5 py-3">' + badge(m.status === "ACTIVE" ? "Active" : "Inactive", m.status === "ACTIVE" ? "success" : "gray") + "</td>" +
        '<td class="px-5 py-3"><div class="flex items-center justify-end gap-1">' +
          '<button data-action="edit-member" data-id="' + m.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("pencil", "h-4 w-4") + "</button>" +
          '<button data-action="toggle-member-status" data-id="' + m.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon(m.status === "ACTIVE" ? "ban" : "rotate-ccw", "h-4 w-4") + "</button>" +
        "</div></td>" +
      "</tr>"
    );
  }).join("");

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Members</h1><p class="mt-1 text-sm text-muted">Only active members are available when recording meals or expenses. A member is created automatically once they sign up and an Admin/Moderator approves their join request' + (can("members.view") ? ' in <a href="#/team" class="font-semibold text-navy-900 hover:underline">Team &amp; Invites</a>' : "") + ".</p></div>" +
      "</div>" +
      '<div class="grid grid-cols-2 gap-4 sm:max-w-xs">' +
        statCard({ label: "Active Members", value: activeMembers().length, icon: "users", tone: "success" }) +
        statCard({ label: "Total Members", value: DB.members.length, icon: "users", tone: "gray" }) +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        (rows === "" ? '<div class="p-6">' + emptyState("users", "No members yet", "Add your first member to get started.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Name</th><th class="px-5 py-3">Status</th><th class="px-5 py-3 text-right">Actions</th>' +
          "</tr></thead><tbody>" + rows + "</tbody></table></div>") +
      "</div>" +
    "</div>" +
    memberFormModal("__EDIT__")
  );
}

function pictureUploadFieldHtml(inputName, previewId, previewPictureUrl, previewName, previewColor) {
  return (
    '<div>' + fieldLabel("Picture (optional)") +
      '<div class="flex items-center gap-3">' +
        '<span id="' + previewId + '">' + avatarHtml(previewPictureUrl, previewName || "?", "h-14 w-14", previewColor, "text-base") + "</span>" +
        '<label class="btn-secondary cursor-pointer">' +
          icon("camera", "h-4 w-4") + "Upload Photo" +
          '<input type="file" accept="image/*" data-action="picture-input" data-preview="' + previewId + '" data-target="' + inputName + '" class="hidden" />' +
        "</label>" +
        '<button type="button" data-action="remove-picture" data-preview="' + previewId + '" data-target="' + inputName + '" class="text-sm font-medium text-muted underline decoration-dotted hover:text-foreground">Remove</button>' +
        '<input type="hidden" name="' + inputName + '" />' +
      "</div>" +
    "</div>"
  );
}

/* One Yes/No pill pair for one meal type in the Default Meals field --
   mirrors the same toggle style renderMeals() uses for the daily grid, so
   a member's default reads the same way its daily override does. Each
   button just flips a hidden input's value; nothing here touches DB.meals
   -- this only sets what mealFor() falls back to when no daily override
   exists yet for that member+date (see memberDefaultMeals()). */
function defaultMealToggleHtml(type, label, value) {
  return (
    '<div>' +
      '<p class="mb-1.5 text-xs font-medium text-muted">' + esc(label) + "</p>" +
      '<input type="hidden" name="defaultMeal_' + type + '" value="' + (value ? "true" : "false") + '" />' +
      '<div class="flex w-fit items-center gap-1 rounded-lg bg-gray-100 p-1">' +
        '<button type="button" data-action="set-default-meal-toggle" data-type="' + type + '" data-value="false" class="h-7 w-12 rounded-md text-xs font-semibold transition-colors ' + (!value ? "bg-danger-600 text-white" : "text-muted hover:bg-white hover:text-foreground") + '">No</button>' +
        '<button type="button" data-action="set-default-meal-toggle" data-type="' + type + '" data-value="true" class="h-7 w-12 rounded-md text-xs font-semibold transition-colors ' + (value ? "bg-success-600 text-white" : "text-muted hover:bg-white hover:text-foreground") + '">Yes</button>' +
      "</div>" +
    "</div>"
  );
}
function defaultMealsFieldHtml(defaults) {
  var d = defaults || DEFAULT_MEAL_DEFAULTS;
  return (
    '<div>' +
      fieldLabel("Default Meals") +
      '<p class="-mt-1 mb-2 text-xs text-muted">Whether each meal is assumed Yes or No for this member every day, until changed manually on the Meals page.</p>' +
      '<div class="grid grid-cols-3 gap-3 rounded-xl border border-border p-3">' +
        defaultMealToggleHtml("breakfast", "Breakfast", d.breakfast) +
        defaultMealToggleHtml("lunch", "Lunch", d.lunch) +
        defaultMealToggleHtml("dinner", "Dinner", d.dinner) +
      "</div>" +
    "</div>"
  );
}

function memberFormModal(mode) {
  var isEdit = mode === "__EDIT__";
  var id = isEdit ? "member-edit-modal" : "member-add-modal";
  var title = isEdit ? "Edit Member" : "Add Member";
  var previewId = isEdit ? "member-edit-picture-preview" : "member-add-picture-preview";
  var body = (
    '<form data-form="member" data-mode="' + (isEdit ? "edit" : "add") + '" class="space-y-4">' +
      (isEdit ? '<input type="hidden" name="id" />' : "") +
      "<div>" + fieldLabel("Name") + '<input name="name" required placeholder="Full name" class="' + FIELD_CLASS + '" /></div>' +
      '<div class="grid grid-cols-2 gap-4">' +
        "<div>" + fieldLabel("Phone (optional)") + '<input name="phone" type="tel" placeholder="e.g. 01xxxxxxxxx" class="' + FIELD_CLASS + '" /></div>' +
        "<div>" + fieldLabel("Email (optional)") + '<input name="email" type="email" placeholder="name@example.com" class="' + FIELD_CLASS + '" /></div>' +
      "</div>" +
      pictureUploadFieldHtml("pictureUrl", previewId, null, "?", "#888") +
      defaultMealsFieldHtml(DEFAULT_MEAL_DEFAULTS) +
      (isEdit ? (
        "<div>" + fieldLabel("Status") +
          '<select name="status" class="' + FIELD_CLASS + ' cursor-pointer"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>' +
        "</div>"
      ) : "") +
      '<div class="flex justify-end gap-2 pt-2">' +
        '<button type="button" data-action="close-modal" data-modal="' + id + '" class="btn-secondary">Cancel</button>' +
        '<button type="submit" class="btn-primary">' + (isEdit ? "Save Changes" : "Add Member") + "</button>" +
      "</div>" +
    "</form>"
  );
  return modalWrapper(id, title, body);
}

/* ============================== SHOPPING LIST ============================== */
/* Reuses EXPENSE_CATEGORIES/itemsForCategory as-is (per the brief: "Do not
   create a separate new category/item system"). DB.shoppingList is a flat
   array of {id, category, item, quantity, checked} rows — grouping by
   `category` at render time is what makes "never create a duplicate
   category" and "never duplicate an item" automatic: there is nowhere for
   a second copy to live, so re-selecting a category just adds more rows
   that render.js naturally buckets under the one heading for that name. */
function shoppingListEntry(category, item) {
  return DB.shoppingList.filter(function (row) { return row.category === category && row.item === item; })[0] || null;
}
function addToShoppingList(category, item) {
  if (shoppingListEntry(category, item)) return; /* already on the list — never duplicate */
  DB.shoppingList.push({ id: uid("shop"), category: category, item: item, quantity: "", checked: false });
  saveDB();
}
function removeFromShoppingList(id) {
  DB.shoppingList = DB.shoppingList.filter(function (row) { return row.id !== id; });
  saveDB();
}
/* Category display order: existing categories in their EXPENSE_CATEGORIES
   order — a custom item added via "Others" is filed under whichever real
   category was selected when it was added, so no separate "Others" bucket
   ever appears in the Shopping List panel. */
function shoppingListGroupOrder() {
  return EXPENSE_CATEGORIES.map(function (c) { return c.name; });
}
function groupShoppingListByCategory() {
  var order = shoppingListGroupOrder();
  var groups = {};
  DB.shoppingList.forEach(function (row) {
    if (!groups[row.category]) groups[row.category] = [];
    groups[row.category].push(row);
  });
  /* Any category not in the known order (shouldn't normally happen, but
     keeps this robust) is appended at the end rather than silently dropped. */
  var extra = Object.keys(groups).filter(function (name) { return order.indexOf(name) < 0; });
  return order.concat(extra).filter(function (name) { return groups[name] && groups[name].length; }).map(function (name) { return { category: name, rows: groups[name] }; });
}

function shoppingListCategoryChipsHtml(activeCategory) {
  return EXPENSE_CATEGORIES.map(function (c) {
    var isActive = c.name === activeCategory;
    return (
      '<button type="button" data-action="shopping-select-category" data-category="' + esc(c.name) + '" class="' +
      (isActive ? "bg-navy-900 text-white" : "border border-border bg-surface text-foreground hover:bg-gray-100") +
      ' rounded-xl px-3.5 py-2 text-sm font-medium transition-colors">' + esc(c.name) + "</button>"
    );
  }).join("");
}

/* "Others" is not a category of its own — it is a way to add a custom item
   INTO whichever real category is currently selected, so the input row
   lives inside that category's checklist rather than behind a separate
   chip. The custom item is filed under `categoryName` like any other row. */
function shoppingListItemChecklistHtml(categoryName, categorySearch) {
  if (!categoryName) return "";
  var q = (categorySearch || "").trim().toLowerCase();
  var items = itemsForCategory(categoryName).filter(function (it) { return !q || it.toLowerCase().indexOf(q) >= 0; });
  var itemsHtml = items.length ?
    '<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">' +
      items.map(function (it) {
        var checked = !!shoppingListEntry(categoryName, it);
        return (
          '<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-50">' +
            '<input type="checkbox" data-action="shopping-toggle-item" data-category="' + esc(categoryName) + '" data-item="' + esc(it) + '"' + (checked ? " checked" : "") + ' class="h-4 w-4 shrink-0 cursor-pointer accent-navy-900" />' +
            '<span class="min-w-0 flex-1 truncate" title="' + esc(it) + '">' + esc(it) + "</span>" +
          "</label>"
        );
      }).join("") +
    "</div>" :
    '<p class="px-1 py-2 text-sm text-muted">No matching items in ' + esc(categoryName) + ".</p>";
  return (
    '<div class="relative mb-3">' +
      '<span class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">' + icon("search", "h-4 w-4") + "</span>" +
      '<input type="text" data-action="shopping-category-search" value="' + esc(categorySearch || "") + '" placeholder="Search in ' + esc(categoryName) + '" class="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted transition-all focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
    "</div>" +
    itemsHtml +
    '<div class="mt-3 flex items-center gap-2 border-t border-border pt-3">' +
      '<input type="text" data-action="shopping-others-input" placeholder="Others — type an item name" class="' + FIELD_CLASS + '" />' +
      '<button type="button" data-action="shopping-add-others" data-category="' + esc(categoryName) + '" class="btn-primary btn-sm shrink-0">' + icon("plus", "h-4 w-4") + "Add</button>" +
    "</div>"
  );
}

function shoppingListPanelHtml() {
  var groups = groupShoppingListByCategory();
  var totalItems = DB.shoppingList.length;
  if (groups.length === 0) {
    return emptyState("clipboard-list", "Your shopping list is empty", "Pick a category on the left and select items to add them here.");
  }
  return (
    '<div class="space-y-5">' +
      groups.map(function (g) {
        return (
          '<div>' +
            '<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">' + esc(g.category) + "</h3>" +
            '<div class="space-y-1.5">' +
              g.rows.map(function (row) {
                return (
                  '<div class="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">' +
                    '<input type="checkbox" data-action="shopping-toggle-checked" data-id="' + row.id + '"' + (row.checked ? " checked" : "") + ' class="h-4 w-4 shrink-0 cursor-pointer accent-navy-900" />' +
                    '<span class="min-w-0 flex-1 truncate text-sm font-medium ' + (row.checked ? "text-muted line-through" : "text-foreground") + '">' + esc(row.item) + "</span>" +
                    '<input type="text" data-action="shopping-quantity-input" data-id="' + row.id + '" value="' + esc(row.quantity || "") + '" placeholder="Qty" class="w-20 shrink-0 rounded-lg border border-border bg-surface px-2 py-1 text-right text-xs text-foreground placeholder:text-muted focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
                    '<button type="button" data-action="shopping-remove-item" data-id="' + row.id + '" class="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600">' + icon("x", "h-3.5 w-3.5") + "</button>" +
                  "</div>"
                );
              }).join("") +
            "</div>" +
          "</div>"
        );
      }).join("") +
      '<p class="text-center text-xs text-muted">' + totalItems + " item" + (totalItems === 1 ? "" : "s") + " on the list</p>" +
    "</div>"
  );
}

function shoppingListDateTimeLabel() {
  var now = new Date();
  return now.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) +
    " | " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function renderShoppingList(activeCategory, categorySearch) {
  var groups = groupShoppingListByCategory();
  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Shopping List</h1><p id="shopping-datetime" class="mt-1 text-sm text-muted">' + shoppingListDateTimeLabel() + "</p></div>" +
        (groups.length ? '<button data-action="download-shopping-list" class="btn-primary">' + icon("clipboard-list", "h-4 w-4") + "Download PDF</button>" : "") +
      "</div>" +
      '<div class="' + (can("shopping.manage") ? "shopping-list-grid " : "mx-auto w-full max-w-2xl ") + 'grid grid-cols-1 gap-6">' +
        (!can("shopping.manage") ? "" :
        '<div class="space-y-4">' +
          '<div class="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">' +
            '<h2 class="mb-3 text-sm font-semibold text-foreground">Select a Category</h2>' +
            '<div id="shopping-category-chips" class="flex flex-wrap gap-2">' + shoppingListCategoryChipsHtml(activeCategory) + "</div>" +
            '<div id="shopping-item-checklist" class="mt-4">' + shoppingListItemChecklistHtml(activeCategory, categorySearch) + "</div>" +
          "</div>" +
        "</div>") +
        '<div>' +
          '<div class="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] lg:sticky lg:top-20">' +
            '<h2 class="mb-4 text-xs font-semibold uppercase tracking-wide text-muted">Today\'s Shopping List</h2>' +
            '<div id="shopping-list-panel">' + shoppingListPanelHtml() + "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

function refreshShoppingListPanel() {
  var host = document.getElementById("shopping-list-panel");
  if (host) host.innerHTML = shoppingListPanelHtml();
  var downloadHost = document.querySelector('[data-action="download-shopping-list"]');
  if (!downloadHost && DB.shoppingList.length) {
    /* the download button only renders once the list is non-empty, so a
       first-ever add needs a full re-render to make it appear */
    navigate("shopping-list", currentQueryWith({}));
  }
}

function refreshShoppingListLeftPane() {
  var chipsHost = document.getElementById("shopping-category-chips");
  var activeChip = chipsHost ? chipsHost.querySelector(".bg-navy-900") : null;
  var activeCategory = activeChip ? activeChip.dataset.category : "";
  var searchInput = document.querySelector('[data-action="shopping-category-search"]');
  var categorySearch = searchInput ? searchInput.value : "";
  var checklistHost = document.getElementById("shopping-item-checklist");
  if (checklistHost) checklistHost.innerHTML = shoppingListItemChecklistHtml(activeCategory, categorySearch);
}

function downloadShoppingListFile() {
  var groups = groupShoppingListByCategory();
  if (!groups.length) { toast("Your shopping list is empty.", "error"); return; }

  try {
    var now = new Date();
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    var pageWidth = pdf.internal.pageSize.getWidth();
    var pageHeight = pdf.internal.pageSize.getHeight();
    var margin = 48;
    var y = margin;

    function ensureSpace(needed) {
      if (y + needed > pageHeight - margin) { pdf.addPage(); y = margin; }
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    pdf.text("SHOPPING LIST", margin, y);
    y += 26;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.setTextColor(90, 90, 90);
    pdf.text("Date: " + now.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }), margin, y);
    y += 16;
    pdf.text("Time: " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }), margin, y);
    y += 20;

    pdf.setDrawColor(210, 210, 210);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 22;

    groups.forEach(function (g) {
      ensureSpace(24);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.setTextColor(20, 20, 20);
      pdf.text(g.category, margin, y);
      y += 18;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(50, 50, 50);
      g.rows.forEach(function (row) {
        ensureSpace(16);
        var line = "-  " + row.item + (row.quantity ? "  —  " + row.quantity : "");
        pdf.text(line, margin + 12, y);
        y += 16;
      });
      y += 12;
    });

    var fileDate = latestDateAcross();
    pdf.save("shopping-list-" + fileDate + ".pdf");
    toast("PDF downloaded.", "success");
  } catch (err) {
    toast("Couldn't generate the PDF. Please try again.", "error");
  }
}

/* ============================== APP SHELL (sidebar + topbar) ============================== */
var NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { key: "money", label: "Money", icon: "wallet" },
  { key: "meals", label: "Meals", icon: "utensils-crossed" },
  { key: "expenses", label: "Expenses", icon: "shopping-cart" },
  { key: "members", label: "Members", icon: "users" },
  { key: "shopping-list", label: "Shopping List", icon: "clipboard-list" },
  { key: "store", label: "Store", icon: "shopping-basket" },
  { key: "hisab", label: "Settlement", icon: "scale" },
  { key: "summary", label: "Summary", icon: "receipt" },
  { key: "team", label: "Team & Invites", icon: "shield-check", perm: "members.view" },
];

function sidebarHtml(activeKey, mobile) {
  var items = NAV_ITEMS.filter(function (item) { return !item.perm || can(item.perm); }).map(function (item) {
    var isActive = item.key === activeKey;
    return (
      '<a href="#/' + item.key + '" class="' +
      (isActive ? "bg-white text-navy-900 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white") +
      ' flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors">' +
      icon(item.icon, "h-4.5 w-4.5") + item.label + "</a>"
    );
  }).join("");
  return (
    '<div class="flex h-full flex-col bg-navy-950 p-4">' +
      '<div class="mb-6 flex items-center gap-2.5 px-2">' +
        '<img src="' + LOGO_ICON_URL + '" alt="MealMate" class="h-8 w-8 rounded-lg object-cover" />' +
        '<span class="min-w-0"><span class="block text-base font-bold leading-tight text-white">MealMate</span>' +
        '<span class="mm-sidebar-group block truncate text-xs text-white/50" title="' + esc(CTX.groupName) + '">' + esc(CTX.groupName) + "</span></span>" +
      "</div>" +
      '<nav class="mm-nav flex-1 space-y-1 overflow-y-auto">' + items + "</nav>" +
      '<div class="mm-sidebar-foot border-t border-white/10 pt-3">' +
        '<div class="flex items-center gap-2.5 px-1">' +
          avatarHtml(SESSION.avatarUrl, SESSION.name || "?", "h-8 w-8", "var(--navy-700)") +
          '<div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-white">' + esc(SESSION.name || "") + '</p>' +
          '<p class="text-xs text-white/50">' + esc(roleLabel(currentRole())) + "</p></div>" +
          '<button data-action="logout" title="Sign out" class="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white">' + icon("log-out", "h-4 w-4") + "</button>" +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

function topbarHtml() {
  var name = SESSION.name || "User";
  return (
    '<header class="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">' +
      '<button data-action="toggle-drawer" class="rounded-lg p-2 text-muted hover:bg-gray-100 lg:hidden">' + icon("menu", "h-5 w-5") + "</button>" +
      '<div class="hidden lg:block"></div>' +
      '<div class="flex items-center gap-2">' +
        '<span id="mm-sync-badge" class="mm-sync-badge" data-state="idle"><span class="mm-sync-dot"></span><span data-sync-label>Synced</span></span>' +
        '<div class="relative">' +
          '<button data-action="toggle-usermenu" class="flex items-center gap-2 rounded-xl p-1.5 pr-2.5 transition-colors hover:bg-gray-100">' +
            avatarHtml(SESSION.avatarUrl, name, "h-8 w-8", "var(--navy-900)") +
            '<span class="hidden text-left sm:block">' +
              '<span class="block text-sm font-medium leading-tight text-foreground">' + esc(name) + "</span>" +
              '<span class="block text-[11px] leading-tight text-muted">' + esc(roleLabel(currentRole())) + "</span>" +
            "</span>" +
            icon("chevron-down", "h-3.5 w-3.5 text-muted") +
          "</button>" +
          '<div id="user-menu" hidden class="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-popover)]">' +
            '<div class="px-3 pb-2 pt-1.5"><p class="truncate text-sm font-semibold text-foreground">' + esc(name) + '</p><p class="truncate text-xs text-muted">' + esc(SESSION.email || "") + "</p></div>" +
            '<a href="#/settings/password" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-gray-100">' + icon("lock", "h-4 w-4") + " Profile &amp; Settings</a>" +
            (can("members.view") ? '<a href="#/team" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-gray-100">' + icon("shield-check", "h-4 w-4") + " Team &amp; Invites</a>" : "") +
            '<button data-action="logout" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-100">' + icon("log-out", "h-4 w-4") + " Sign Out</button>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</header>"
  );
}

/* (The animated "MEALMATE" pixel-word background layer was removed on request;
   the drifting grid + soft glow flow below are kept.) */

/* Preset per-spot timing for the "running grid" flow (see .app-grid-flow-spot
   in the CSS): each spot drifts along the same wander path but at its own
   speed/phase/starting-corner offset, so the glow patches never move in
   lockstep and small clusters of the grid light up and fade independently
   across different areas — the "organic, not all boxes moving together"
   requirement. Kept as a short, fixed list (not random) so the effect is
   stable and reviewable rather than reshuffling on every render. */
var APP_GRID_FLOW_SPOTS = [
  { duration: 46, delay: 0, pulseDuration: 9, pulseDelay: 0, originX: -18, originY: -12 },
  { duration: 58, delay: -21, pulseDuration: 11, pulseDelay: -3, originX: 22, originY: 14 },
  { duration: 39, delay: -9, pulseDuration: 8, pulseDelay: -5, originX: -8, originY: 20 },
];

function appGridFlowLayerHtml() {
  var spots = APP_GRID_FLOW_SPOTS.map(function (spot) {
    var style =
      "animation-duration:" + spot.duration + "s," + spot.pulseDuration + "s;" +
      "animation-delay:" + spot.delay + "s," + spot.pulseDelay + "s;" +
      "margin-left:calc(-23vmax + " + spot.originX + "vw);" +
      "margin-top:calc(-23vmax + " + spot.originY + "vh);";
    return '<span class="app-grid-flow-spot" aria-hidden="true" style="' + style + '"></span>';
  }).join("");
  return '<div class="app-grid-flow-layer" aria-hidden="true">' + spots + "</div>";
}

function renderShell(contentHtml, activeKey, drawerOpen) {
  return (
    '<div class="flex min-h-screen">' +
      '<aside class="hidden w-64 shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:block">' + sidebarHtml(activeKey) + "</aside>" +
      '<div id="mobile-drawer-backdrop" class="' + (drawerOpen ? "" : "hidden") + ' fixed inset-0 z-30 bg-navy-950/40 lg:hidden" data-action="toggle-drawer"></div>' +
      '<aside class="' + (drawerOpen ? "" : "mm-drawer-closed") + ' fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200 lg:hidden">' + sidebarHtml(activeKey, true) + "</aside>" +
      '<div class="flex min-w-0 flex-1 flex-col lg:ml-64">' +
        topbarHtml() +
        '<main class="app-grid-bg flex-1 p-4 sm:p-6">' + appGridFlowLayerHtml() + '<div class="mm-page">' + contentHtml + "</div>" + "</main>" +
      "</div>" +
    "</div>"
  );
}

/* ============================== DAILY MEALS ============================== */
/* Each member has their own per-meal default (member.defaultMeals -- see
   memberDefaultMeals()/loadDB's migration), so which meals default to Yes
   vs No is configurable per person (e.g. one member's breakfast defaults
   off while another's lunch defaults off), not a single global rule. The
   app-wide fallback used when a member has no defaultMeals set yet is
   breakfast=No, lunch=Yes, dinner=Yes -- matching the original behavior.
   A DB.meals row only exists once someone has actually toggled a meal
   away from that member's own default for that day. */
var DEFAULT_MEAL_DEFAULTS = { breakfast: false, lunch: true, dinner: true };
function memberDefaultMeals(member) {
  var d = (member && member.defaultMeals) || {};
  return {
    breakfast: d.breakfast !== undefined ? !!d.breakfast : DEFAULT_MEAL_DEFAULTS.breakfast,
    lunch: d.lunch !== undefined ? !!d.lunch : DEFAULT_MEAL_DEFAULTS.lunch,
    dinner: d.dinner !== undefined ? !!d.dinner : DEFAULT_MEAL_DEFAULTS.dinner,
  };
}
var NO_MEALS = { breakfast: false, lunch: false, dinner: false };
function mealFor(memberId, dateKey) {
  var row = DB.meals.filter(function (m) { return m.memberId === memberId && m.date === dateKey; })[0];
  if (row) return row;
  var member = memberById(memberId);
  /* A member never has meals before the day they actually joined (or
     re-joined) the mess -- otherwise everyone defaults to "meal on" for
     every day back to month start, so someone approved on the 25th would
     wrongly show meals counted from the 1st. */
  if (member && member.joinedAt && dateKey < member.joinedAt) return NO_MEALS;
  return memberDefaultMeals(member);
}

function renderMeals(dateKey) {
  var rows = activeMembers().map(function (m) { return { member: m, meal: mealFor(m.id, dateKey) }; });
  var totals = rows.reduce(function (acc, r) { acc.b += r.meal.breakfast ? 1 : 0; acc.l += r.meal.lunch ? 1 : 0; acc.d += r.meal.dinner ? 1 : 0; return acc; }, { b: 0, l: 0, d: 0 });

  function yesNoToggle(memberId, type, value) {
    var member = memberById(memberId);
    var isDefault = memberDefaultMeals(member)[type] === value;
    return (
      '<div class="mx-auto flex w-fit items-center gap-1 rounded-lg bg-gray-100 p-1">' +
        '<button type="button" data-action="set-meal" data-member="' + memberId + '" data-type="' + type + '" data-value="false" data-date="' + dateKey + '" class="h-7 w-12 rounded-md text-xs font-semibold transition-colors ' + (!value ? "bg-danger-600 text-white" : "text-muted hover:bg-white hover:text-foreground") + '">No</button>' +
        '<button type="button" data-action="set-meal" data-member="' + memberId + '" data-type="' + type + '" data-value="true" data-date="' + dateKey + '" class="h-7 w-12 rounded-md text-xs font-semibold transition-colors ' + (value ? "bg-success-600 text-white" : "text-muted hover:bg-white hover:text-foreground") + '">Yes</button>' +
        '<button type="button" data-action="set-meal-default" data-member="' + memberId + '" data-type="' + type + '" data-value="' + (value ? "true" : "false") + '" title="' + (isDefault ? "This is already " + esc(member.name) + "'s default for " + type : "Make " + (value ? "Yes" : "No") + " " + esc(member.name) + "'s default for " + type + " every day") + '" class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ' + (isDefault ? "text-warning-600" : "text-muted hover:bg-white hover:text-warning-600") + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="' + (isDefault ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"></path></svg>' +
        "</button>" +
      "</div>"
    );
  }
  function setAllToggle(type) {
    return (
      '<div class="mx-auto flex w-fit items-center gap-1 rounded-lg bg-gray-100 p-1">' +
        '<button type="button" data-action="set-meal-all" data-type="' + type + '" data-value="false" data-date="' + dateKey + '" class="h-7 w-12 rounded-md text-xs font-semibold text-muted transition-colors hover:bg-white hover:text-foreground">No</button>' +
        '<button type="button" data-action="set-meal-all" data-type="' + type + '" data-value="true" data-date="' + dateKey + '" class="h-7 w-12 rounded-md text-xs font-semibold text-muted transition-colors hover:bg-white hover:text-foreground">Yes</button>' +
      "</div>"
    );
  }

  var tableRows = rows.map(function (r) {
    var total = (r.meal.breakfast ? 1 : 0) + (r.meal.lunch ? 1 : 0) + (r.meal.dinner ? 1 : 0);
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' + avatarHtml(r.member.pictureUrl, r.member.name, "h-8 w-8", r.member.avatarColor) + '<span class="font-medium text-foreground">' + esc(r.member.name) + "</span></div></td>" +
        '<td class="px-3 py-3">' + yesNoToggle(r.member.id, "breakfast", r.meal.breakfast) + "</td>" +
        '<td class="px-3 py-3">' + yesNoToggle(r.member.id, "lunch", r.meal.lunch) + "</td>" +
        '<td class="px-3 py-3">' + yesNoToggle(r.member.id, "dinner", r.meal.dinner) + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums">' + total + "</td>" +
      "</tr>"
    );
  }).join("");

  var totalAll = totals.b + totals.l + totals.d;

  var monthKey = monthKeyOf(dateKey);
  var members = activeMembers();
  var today = latestDateAcross();
  var monthDates = eachDateInMonth(monthKey).filter(function (d) { return d <= today; });
  var memberMonthTotals = members.map(function (m) {
    var total = monthDates.reduce(function (sum, d) {
      var meal = mealFor(m.id, d);
      return sum + (meal.breakfast ? 1 : 0) + (meal.lunch ? 1 : 0) + (meal.dinner ? 1 : 0);
    }, 0);
    return { member: m, total: total };
  });
  var monthGrandTotal = memberMonthTotals.reduce(function (sum, r) { return sum + r.total; }, 0);
  var monthRows = monthDates.map(function (d) {
    var dayTotal = 0;
    var cells = members.map(function (m) {
      var meal = mealFor(m.id, d);
      var t = (meal.breakfast ? 1 : 0) + (meal.lunch ? 1 : 0) + (meal.dinner ? 1 : 0);
      dayTotal += t;
      return '<td class="px-3 py-2.5 text-right tabular-nums">' + t + "</td>";
    }).join("");
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50' + (d === dateKey ? " bg-navy-50/50" : "") + '">' +
        '<td class="px-5 py-2.5 text-muted">' + dateLabelMed(d) + "</td>" +
        cells +
        '<td class="px-5 py-2.5 text-right font-semibold tabular-nums">' + dayTotal + "</td>" +
        '<td class="px-5 py-2.5 text-right"><button data-action="date-nav" data-date="' + d + '" class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:bg-navy-50">' + icon("pencil", "h-3.5 w-3.5") + "Edit</button></td>" +
      "</tr>"
    );
  }).join("");

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Meals</h1><p class="mt-1 text-sm text-muted">Each member has their own default for Breakfast, Lunch and Dinner (set from Members) — this just overrides today\'s value manually.</p></div>' +
        dateSwitcherHtml(dateKey) +
      "</div>" +
      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">' +
        statCard({ label: "Breakfast", value: totals.b, icon: "coffee", tone: "warning" }) +
        statCard({ label: "Lunch", value: totals.l, icon: "sun", tone: "success" }) +
        statCard({ label: "Dinner", value: totals.d, icon: "moon", tone: "navy" }) +
        statCard({ label: "Total Meals", value: totalAll, icon: "utensils-crossed", tone: "gray" }) +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        (rows.length === 0 ? '<div class="p-6">' + emptyState("users", "No active members", "Add members from the Members page to start recording meals.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full min-w-[720px] text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-5 py-3">Member</th><th class="px-3 py-3 text-center">Breakfast</th><th class="px-3 py-3 text-center">Lunch</th><th class="px-3 py-3 text-center">Dinner</th><th class="px-5 py-3 text-right">Total</th></tr></thead><tbody>' +
          '<tr class="border-b border-border bg-navy-50/50"><td class="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-navy-900">Set all</td><td class="px-3 py-3">' + setAllToggle("breakfast") + '</td><td class="px-3 py-3">' + setAllToggle("lunch") + '</td><td class="px-3 py-3">' + setAllToggle("dinner") + '</td><td></td></tr>' +
          tableRows + "</tbody></table></div>") +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Monthly Meal Summary — ' + monthLabel(monthKey) + "</h2></div>" +
        (members.length === 0 ? "" :
        '<div class="grid grid-cols-2 gap-4 border-b border-border p-5 sm:grid-cols-3 lg:grid-cols-4">' +
          memberMonthTotals.map(function (r) {
            return (
              '<div class="flex items-center gap-3 rounded-xl border border-border bg-gray-50/60 px-4 py-3">' +
                avatarHtml(r.member.pictureUrl, r.member.name, "h-9 w-9", r.member.avatarColor) +
                '<div class="min-w-0"><p class="truncate text-sm font-medium text-foreground">' + esc(r.member.name) + "</p><p class=\"text-xs text-muted\">" + r.total + " meal" + (r.total === 1 ? "" : "s") + "</p></div>" +
              "</div>"
            );
          }).join("") +
          '<div class="flex items-center gap-3 rounded-xl border border-navy-900 bg-navy-50/60 px-4 py-3">' +
            '<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-white">' + icon("utensils-crossed", "h-4.5 w-4.5") + "</div>" +
            '<div class="min-w-0"><p class="truncate text-sm font-semibold text-navy-900">Total</p><p class="text-xs text-navy-900/70">' + monthGrandTotal + " meal" + (monthGrandTotal === 1 ? "" : "s") + "</p></div>" +
          "</div>" +
        "</div>") +
        (members.length === 0 ? '<div class="p-6">' + emptyState("utensils-crossed", "No active members") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-5 py-2">Date</th>' +
          members.map(function (m) { return '<th class="px-3 py-2 text-right">' + esc(m.name) + "</th>"; }).join("") +
          '<th class="px-5 py-2 text-right">Total</th><th class="px-5 py-2 text-right">Actions</th></tr></thead><tbody>' + monthRows + "</tbody></table></div>") +
      "</div>" +
    "</div>"
  );
}

/* ============================== MONEY ADDED ============================== */
/* Month-wise "who deposited how much, and what's their balance" breakdown
   for the Money page. Reuses computeHisabSummary(monthKey) for the
   Paid / Meal Cost / Balance numbers -- no separate calculation exists
   here, so this can never drift from the Settlement page's own numbers. */
function findMoneyClosedMonth(monthKey) {
  return DB.moneyClosedMonths.filter(function (c) { return c.monthKey === monthKey; })[0] || null;
}

/* Finalizes a month's money using the Paid-vs-Carry-Forward choice the user
   made per member in the Close Month modal: decisionsByMember maps
   memberId -> "paid" | "carry". Only members with a positive balance
   (they overpaid this month) need a decision; members who broke even or
   owe money have nothing to carry forward here (an amount owed is settled
   through the separate Settlement/Hisab transfers, not auto-added as a
   deposit).
     - "paid": the leftover balance is considered settled/spent -- nothing
       is added anywhere, it simply won't show as a balance next month.
     - "carry": a real DB.deposits row is created, dated the 1st of next
       month, noted "Carried forward from <Month>" -- so every other page
       (Dashboard, Available Balance, Expenses, Settlement) sees it exactly
       like any other deposit with no extra plumbing.
   Snapshots the decisions for history in DB.moneyClosedMonths. Re-closing
   an already-closed month first removes any deposit rows this function
   itself created for that month (identified by their carriedFromMonthKey
   marker) before re-applying the new decisions, so re-running it never
   duplicates carried-forward money. */
function closeMoneyMonth(monthKey, decisionsByMember) {
  var s = computeHisabSummary(monthKey);
  var nextMonthKey = shiftMonthKey(monthKey, 1);
  var nextMonthFirstDay = nextMonthKey + "-01";

  DB.deposits = DB.deposits.filter(function (d) { return d.carriedFromMonthKey !== monthKey; });

  var decisions = [];
  s.members.forEach(function (r) {
    if (r.balance > 0.01) {
      var choice = (decisionsByMember && decisionsByMember[r.memberId] === "carry") ? "carry" : "paid";
      decisions.push({ memberId: r.memberId, name: r.name, balance: r.balance, choice: choice });
      if (choice === "carry") {
        DB.deposits.push({
          id: uid("dep"),
          memberId: r.memberId,
          date: nextMonthFirstDay,
          amount: r.balance,
          note: "Carried forward from " + monthLabel(monthKey),
          carriedFromMonthKey: monthKey,
        });
      }
    }
  });

  var snapshot = { monthKey: monthKey, closedAt: new Date().toISOString(), decisions: decisions };
  var existingIndex = -1;
  DB.moneyClosedMonths.forEach(function (row, i) { if (row.monthKey === monthKey) existingIndex = i; });
  if (existingIndex >= 0) DB.moneyClosedMonths[existingIndex] = snapshot;
  else DB.moneyClosedMonths.push(snapshot);

  saveDB();
  return snapshot;
}

function renderMoney(search, monthKeyParam) {
  var monthKey = monthKeyParam && /^\d{4}-\d{2}$/.test(monthKeyParam) ? monthKeyParam : latestMonthKey();

  var deposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  if (search) {
    var q = search.toLowerCase();
    deposits = deposits.filter(function (d) { var m = memberById(d.memberId); return m && m.name.toLowerCase().indexOf(q) >= 0; });
  }
  var total = deposits.reduce(function (a, d) { return a + d.amount; }, 0);
  var uniqueDepositors = {};
  deposits.forEach(function (d) { uniqueDepositors[d.memberId] = true; });

  var rows = deposits.map(function (d) {
    var m = memberById(d.memberId);
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3 text-muted">' + dateLabelMed(d.date) + "</td>" +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' + avatarHtml(m ? m.pictureUrl : null, m ? m.name : "?", "h-8 w-8", m ? m.avatarColor : "#888") + '<span class="font-medium text-foreground">' + esc(m ? m.name : "Unknown") + "</span></div></td>" +
        '<td class="px-5 py-3 text-muted">' + esc(d.note || "-") + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums text-success-700">+' + formatCurrency(d.amount) + "</td>" +
        '<td class="px-5 py-3"><div class="flex items-center justify-end gap-1">' +
          '<button data-action="edit-deposit" data-id="' + d.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("pencil", "h-4 w-4") + "</button>" +
          '<button data-action="delete-deposit" data-id="' + d.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600">' + icon("trash", "h-4 w-4") + "</button>" +
        "</div></td>" +
      "</tr>"
    );
  }).join("");

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Money Added</h1><p class="mt-1 text-sm text-muted">Deposits recorded in ' + esc(monthLabel(monthKey)) + ".</p></div>" +
        '<div class="flex items-center gap-2">' +
          monthSwitcherHtml(monthKey, "money-month-nav") +
          '<button data-action="add-deposit" class="btn-primary">' + icon("wallet", "h-4 w-4") + "Add Deposit</button>" +
        "</div>" +
      "</div>" +
      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">' +
        statCard({ label: "Money Added", value: total, prefix: "৳", icon: "wallet", tone: "success" }) +
        statCard({ label: "Deposits", value: deposits.length, icon: "coins", tone: "navy" }) +
        statCard({ label: "Average Deposit", value: deposits.length ? total / deposits.length : 0, prefix: "৳", icon: "trending-up", tone: "gray" }) +
        '<button data-action="open-modal" data-modal="depositors-breakdown-modal" class="text-left">' + statCard({ label: "Depositors", value: Object.keys(uniqueDepositors).length, icon: "users", tone: "warning", helperText: "Click for who paid how much", interactive: true }) + "</button>" +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="flex items-center justify-between gap-3 border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Deposit History -- ' + esc(monthLabel(monthKey)) + "</h2>" + searchBoxHtml("Search by member...", search) + "</div>" +
        (deposits.length === 0 ? '<div class="p-6">' + emptyState("wallet", search ? "No matching deposits" : "No deposits this month", search ? "Try a different search term." : "Add a deposit or pick a different month.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-5 py-3">Date</th><th class="px-5 py-3">Member</th><th class="px-5 py-3">Note</th><th class="px-5 py-3 text-right">Amount</th><th class="px-5 py-3 text-right">Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div>") +
      "</div>" +
    "</div>" +
    depositFormModal(null) + depositFormModal("__EDIT__") +
    deleteConfirmModal("delete-deposit-modal", "Delete this deposit?", "This will remove the deposit and update the available balance.") +
    modalWrapper("depositors-breakdown-modal", "Who Deposited How Much", '<div id="depositors-breakdown-body">' + depositorsBreakdownBodyHtml(monthKey) + "</div>")
  );
}

/* Body of the "Who Deposited How Much" modal for one month -- a simple,
   read-only "who paid how much this month" list. Closing a month (deciding
   whether each leftover balance is Paid or Carried Forward) is a
   Settlement action, not a Money-page one -- see renderHisab's Final
   Settlement Summary / closeMonthConfirmModal instead. Factored out of
   renderMoney() so switching months (see money-month-nav) can patch just
   this modal's contents in place via refreshDepositorsBreakdownModal()
   instead of re-rendering (and thereby closing) the whole page/modal. */
function depositorsBreakdownBodyHtml(monthKey) {
  var hisab = computeHisabSummary(monthKey);
  var monthBreakdown = hisab.members.slice().sort(function (a, b) { return b.paid - a.paid; });
  return (
    '<div class="mb-4 flex items-center justify-end gap-3">' +
      monthSwitcherHtml(monthKey, "money-breakdown-month-nav") +
    "</div>" +
    (monthBreakdown.length === 0 ? emptyState("users", "No active members") :
    '<div class="max-h-96 space-y-2 overflow-y-auto">' + monthBreakdown.map(function (row) {
      var m = memberById(row.memberId);
      return (
        '<div class="flex items-center justify-between rounded-xl border border-border px-4 py-3">' +
          '<div class="flex min-w-0 items-center gap-3">' + avatarHtml(m ? m.pictureUrl : null, row.name, "h-8 w-8", m ? m.avatarColor : "#888") +
            '<div class="min-w-0"><p class="truncate text-sm font-medium text-foreground">' + esc(row.name) + '</p><p class="text-xs text-muted">' + formatNumber(row.meals) + " meal" + (row.meals === 1 ? "" : "s") + " this month</p></div>" +
          "</div>" +
          '<span class="shrink-0 text-sm font-semibold tabular-nums text-success-700">' + formatCurrency(row.paid) + "</span>" +
        "</div>"
      );
    }).join("") +
    '<div class="mt-1 flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3"><span class="text-sm font-semibold text-navy-900">Total Paid</span><span class="text-base font-bold tabular-nums text-navy-900">' + formatCurrency(hisab.totalPaid) + "</span></div>" +
    "</div>")
  );
}

/* Re-renders just the "Who Deposited How Much" modal's contents for a
   different month, without touching the rest of the page -- keeps the
   modal open across the month-switcher clicks the same way the Store
   History modal's month drill-down patches its own body in place. */
function refreshDepositorsBreakdownModal(monthKey) {
  var body = document.getElementById("depositors-breakdown-body");
  if (body) body.innerHTML = depositorsBreakdownBodyHtml(monthKey);
}

function depositFormModal(mode) {
  var isEdit = mode === "__EDIT__";
  var id = isEdit ? "deposit-edit-modal" : "deposit-add-modal";
  var memberOptions = activeMembers().map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + "</option>"; }).join("");
  var body = (
    '<form data-form="deposit" data-mode="' + (isEdit ? "edit" : "add") + '" class="space-y-4">' +
      (isEdit ? '<input type="hidden" name="id" />' : "") +
      "<div>" + fieldLabel("Member") + '<select name="memberId" required class="' + FIELD_CLASS + ' cursor-pointer"><option value="" disabled selected>Select a member</option>' + memberOptions + "</select></div>" +
      '<div class="grid grid-cols-2 gap-4"><div>' + fieldLabel("Date") + '<input name="date" type="date" required class="' + FIELD_CLASS + '" /></div><div>' + fieldLabel("Amount (৳)") + '<input name="amount" type="number" min="0" step="1" required placeholder="1000" class="' + FIELD_CLASS + '" /></div></div>' +
      "<div>" + fieldLabel("Note (optional)") + '<textarea name="note" rows="2" placeholder="e.g. Monthly deposit" class="' + FIELD_CLASS + '"></textarea></div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" data-action="close-modal" data-modal="' + id + '" class="btn-secondary">Cancel</button><button type="submit" class="btn-primary">' + (isEdit ? "Save Changes" : "Add Deposit") + "</button></div>" +
    "</form>"
  );
  return modalWrapper(id, isEdit ? "Edit Deposit" : "Add Deposit", body);
}

function deleteConfirmModal(id, title, description) {
  return modalWrapper(id, title,
    '<p class="text-sm text-muted">' + esc(description) + '</p>' +
    '<div class="mt-5 flex justify-end gap-2">' +
      '<button type="button" data-action="close-modal" data-modal="' + id + '" class="btn-secondary">Cancel</button>' +
      '<button type="button" data-action="confirm-delete" data-modal="' + id + '" class="btn-danger">Delete</button>' +
    "</div>");
}

/* ============================== EXPENSES ============================== */
/* An expense's items[] array (post-migration, always present — see loadDB)
   as a single comma-separated display string, e.g. "Rice (5 kg), Oil (2 L)",
   matching the "(qty unit)" suffix style the old single-item form used. */
function expenseItemsSummary(e) {
  return (e.items || []).map(function (it) {
    return it.item + (it.quantity ? " (" + formatNumber(it.quantity, it.quantity % 1 ? 1 : 0) + (it.unit ? " " + it.unit : "") + ")" : "");
  }).join(", ");
}
function renderExpenses(search, monthKey, rangeFrom, rangeTo) {
  /* Default to the current month, starting from its 1st day, unless the
     user picked an explicit range — matches "Expense History te all Month
     wise all data thakbe... by default 01 date thakbe every month er".
     The "to" end defaults to the end of that month (capped at today, so a
     future month never shows an empty range that reads as broken), not
     always "today" — otherwise switching to a past month via the month
     switcher would default to a "from 1st -> today" range that excludes
     the rest of that past month. */
  monthKey = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : latestMonthKey();
  var today = latestDateAcross();
  var monthEnd = monthKey + "-" + String(daysInMonth(monthKey)).padStart(2, "0");
  var defaultFrom = monthKey + "-01";
  var defaultTo = monthEnd < today ? monthEnd : today;
  var from = rangeFrom && /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) ? rangeFrom : defaultFrom;
  var to = rangeTo && /^\d{4}-\d{2}-\d{2}$/.test(rangeTo) ? rangeTo : defaultTo;

  /* Newest first; DB.expenses is itself in insertion order (new entries are
     always pushed to the end), so tie-break equal dates by ORIGINAL array
     index (descending) rather than leaving them in whatever order a stable
     sort happens to preserve — otherwise an expense added today with the
     same date as an earlier one would sort BELOW it instead of on top. */
  var expenses = DB.expenses
    .map(function (e, i) { return { e: e, i: i }; })
    .sort(function (a, b) { return a.e.date === b.e.date ? b.i - a.i : (a.e.date < b.e.date ? 1 : -1); })
    .map(function (x) { return x.e; })
    .filter(function (e) { return e.date >= from && e.date <= to; });
  if (search) {
    var q = search.toLowerCase();
    expenses = expenses.filter(function (e) {
      var buyerNames = (e.buyerIds || []).map(function (id) { var m = memberById(id); return m ? m.name.toLowerCase() : ""; }).join(" ");
      var itemNames = (e.items || []).map(function (it) { return it.item.toLowerCase(); }).join(" ");
      return itemNames.indexOf(q) >= 0 || buyerNames.indexOf(q) >= 0;
    });
  }
  var total = expenses.reduce(function (a, e) { return a + e.amount; }, 0);
  var uniqueBuyers = {};
  expenses.forEach(function (e) { (e.buyerIds || []).forEach(function (id) { uniqueBuyers[id] = true; }); });

  var itemTotals = {};
  DB.expenses.forEach(function (e) {
    (e.items || []).forEach(function (it) {
      if (!itemTotals[it.item]) itemTotals[it.item] = { item: it.item, count: 0, amount: 0 };
      itemTotals[it.item].count += 1;
      itemTotals[it.item].amount += it.amount;
    });
  });
  var itemBreakdown = Object.keys(itemTotals).map(function (k) { return itemTotals[k]; }).sort(function (a, b) { return b.amount - a.amount; });

  function buyerNamesHtml(e) {
    var names = (e.buyerIds || []).map(function (id) { var m = memberById(id); return m ? esc(m.name) : null; }).filter(Boolean);
    return names.length ? names.join(", ") : "Unknown";
  }

  var rows = expenses.map(function (e) {
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3 text-muted">' + dateLabelMed(e.date) + "</td>" +
        '<td class="px-5 py-3 font-medium text-foreground">' + esc(expenseItemsSummary(e)) + "</td>" +
        '<td class="px-5 py-3 text-foreground">' + buyerNamesHtml(e) + "</td>" +
        '<td class="px-5 py-3 text-muted">' + esc(e.note || "—") + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">−' + formatCurrency(e.amount) + "</td>" +
        '<td class="px-5 py-3"><div class="flex items-center justify-end gap-1">' +
          '<button data-action="edit-expense" data-id="' + e.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("pencil", "h-4 w-4") + "</button>" +
          '<button data-action="delete-expense" data-id="' + e.id + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600">' + icon("trash", "h-4 w-4") + "</button>" +
        "</div></td>" +
      "</tr>"
    );
  }).join("");

  var isCustomRange = from !== defaultFrom || to !== defaultTo;
  var rangeSubtitle = from === to ? dateLabelMed(from) : dateLabelMed(from) + " – " + dateLabelMed(to);

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Expenses</h1><p class="mt-1 text-sm text-muted">' + esc(rangeSubtitle) + "</p></div>" +
        '<button data-action="add-expense" class="btn-primary">' + icon("shopping-cart", "h-4 w-4") + "Add Expense</button>" +
      "</div>" +
      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">' +
        statCard({ label: "Meal Expense", value: total, prefix: "৳", icon: "shopping-cart", tone: "danger" }) +
        '<button data-action="open-modal" data-modal="purchases-breakdown-modal" class="text-left">' + statCard({ label: "Expenses", value: expenses.length, icon: "receipt", tone: "navy", helperText: "Click for what was bought", interactive: true }) + "</button>" +
        statCard({ label: "Average Expense", value: expenses.length ? total / expenses.length : 0, prefix: "৳", icon: "trending-down", tone: "gray" }) +
        statCard({ label: "People Involved", value: Object.keys(uniqueBuyers).length, icon: "users", tone: "warning" }) +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="flex flex-col gap-3 border-b border-border p-5">' +
          '<div class="flex flex-wrap items-center justify-between gap-3">' +
            '<h2 class="text-sm font-semibold text-foreground">Expense History</h2>' +
            searchBoxHtml("Search item or member...", search) +
          "</div>" +
          '<div class="flex flex-wrap items-center gap-2">' +
            monthSwitcherHtml(monthKey, "expenses-month-nav") +
            '<div class="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-1 shadow-[var(--shadow-card)]">' +
              '<input type="date" data-action="expenses-range-input" data-bound="from" value="' + esc(from) + '" class="rounded-lg border-0 bg-transparent px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
              '<span class="text-xs text-muted">to</span>' +
              '<input type="date" data-action="expenses-range-input" data-bound="to" value="' + esc(to) + '" class="rounded-lg border-0 bg-transparent px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
            "</div>" +
            (isCustomRange ? '<button data-action="expenses-range-reset" class="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-navy-900 shadow-[var(--shadow-card)] transition-colors hover:bg-navy-50">Reset to this month</button>' : "") +
          "</div>" +
        "</div>" +
        (expenses.length === 0 ? '<div class="p-6">' + emptyState("shopping-cart", search ? "No matching expenses" : "No expenses in this range", search ? "Try a different search term." : "Add an expense or pick a different date range.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-5 py-3">Date</th><th class="px-5 py-3">Item</th><th class="px-5 py-3">Done By</th><th class="px-5 py-3">Note</th><th class="px-5 py-3 text-right">Amount</th><th class="px-5 py-3 text-right">Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div>") +
      "</div>" +
    "</div>" +
    expenseFormModal(null) + expenseFormModal("__EDIT__") +
    deleteConfirmModal("delete-expense-modal", "Delete this expense?", "This will remove the expense and update the available balance.") +
    modalWrapper("purchases-breakdown-modal", "What Was Bought — All Time",
      itemBreakdown.length === 0 ? emptyState("shopping-cart", "No expenses yet") :
      '<div class="max-h-96 space-y-2 overflow-y-auto">' + itemBreakdown.map(function (row) {
        return (
          '<div class="flex items-center justify-between rounded-xl border border-border px-4 py-3">' +
            '<div><p class="text-sm font-medium text-foreground">' + esc(row.item) + '</p><p class="text-xs text-muted">bought ' + row.count + " time" + (row.count === 1 ? "" : "s") + "</p></div>" +
            '<span class="text-sm font-semibold tabular-nums text-danger-600">' + formatCurrency(row.amount) + "</span>" +
          "</div>"
        );
      }).join("") +
      '<div class="mt-1 flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3"><span class="text-sm font-semibold text-navy-900">Total</span><span class="text-base font-bold tabular-nums text-navy-900">' + formatCurrency(total) + "</span></div>" +
      "</div>")
  );
}

/* Standard unit list used by every Unit dropdown in the app (currently the
   expense item rows). Keeping this as the single source of truth means
   adding/renaming a unit here automatically updates every dropdown that
   reads UNIT_OPTIONS_HTML -- never hand-list units at the call site. */
var UNIT_OPTIONS = ["kg", "g", "L", "mL", "pcs", "dozen", "packet", "box"];
var UNIT_OPTIONS_HTML = UNIT_OPTIONS.map(function (u) { return '<option value="' + esc(u) + '">' + esc(u) + "</option>"; }).join("");
var CATEGORY_OPTIONS_HTML = EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.name) + "</option>"; }).join("");

/* Renders a single repeatable item row for the expense form's item list.
   rowId is a unique string (not necessarily numeric/sequential — rows can be
   added/removed freely) used only to scope this row's autocomplete dropdown
   and DOM lookups; it is never sent to the server/stored anywhere. */
function expenseItemRowHtml(rowId, data) {
  data = data || {};
  return (
    '<div class="space-y-3 rounded-xl border border-border p-3.5" data-item-row data-row-id="' + rowId + '">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="grid flex-1 grid-cols-2 gap-3"><div>' + fieldLabel("Category") +
          '<select data-field="category" class="' + FIELD_CLASS + ' cursor-pointer"><option value="">Select a category</option>' + CATEGORY_OPTIONS_HTML + "</select></div>" +
          '<div class="relative" data-item-field><label class="mb-1.5 block text-sm font-medium text-foreground">Item</label>' +
            '<input data-field="item" autocomplete="off" placeholder="e.g. Rice, Fish, Vegetables" data-action="item-input" class="' + FIELD_CLASS + '" />' +
            '<ul data-item-suggestions hidden class="absolute z-20 mt-1.5 max-h-48 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-popover)]"></ul>' +
          "</div>" +
        "</div>" +
        '<button type="button" data-action="remove-item-row" title="Remove item" class="mt-6 shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600">' + icon("trash", "h-4 w-4") + "</button>" +
      "</div>" +
      '<div class="grid grid-cols-3 gap-3">' +
        "<div>" + fieldLabel("Quantity (optional)") + '<input data-field="quantity" type="number" min="0" step="0.1" placeholder="e.g. 25" class="' + FIELD_CLASS + '" /></div>' +
        "<div>" + fieldLabel("Unit") + '<select data-field="unit" data-action="item-unit-input" class="' + FIELD_CLASS + ' cursor-pointer"><option value="">—</option>' + UNIT_OPTIONS_HTML + "</select></div>" +
        "<div>" + fieldLabel("Amount (৳)") + '<input data-field="amount" data-action="item-amount-input" type="number" min="0" step="1" placeholder="500" class="' + FIELD_CLASS + '" /></div>' +
      "</div>" +
      '<div data-stock-reconcile></div>' +
    "</div>"
  );
}

/* The "Previous stock finished?" reconciliation block for one item row --
   only rendered when the currently typed item+unit already has stock on
   hand this month (see findExistingStockFor). Defaults to "Yes" (old stock
   is used up, matching the app's existing assumption that a fresh purchase
   simply becomes the new Available figure). Switching to "No" reveals an
   input, pre-filled with the existing available quantity as a starting
   suggestion, where the user types how much of the OLD stock is actually
   left -- mirrors the Store Close Month modal's "type what's actually
   left" pattern instead of trying to auto-calculate usage. */
function stockReconcileBlockHtml(existingRow, rowId) {
  if (!existingRow) return "";
  var unitLabel = existingRow.unit ? " " + esc(existingRow.unit) : "";
  var available = formatNumber(existingRow.available, existingRow.available % 1 ? 1 : 0) + unitLabel;
  /* A shared radio `name`, scoped to this specific item row, is required
     for the browser to treat "Yes"/"No" as mutually exclusive -- without
     it (or when the two rows of two different item rows would otherwise
     collide on the same name), selecting one never unchecks the other. */
  var groupName = "stock-finished-" + rowId;
  return (
    '<div class="rounded-lg border border-warning-100 bg-warning-100/60 p-3">' +
      '<div class="flex flex-wrap items-center justify-between gap-2">' +
        '<p class="text-xs font-medium text-foreground">You already have ' + available + " of this in stock. Previous stock finished?</p>" +
        '<div class="flex shrink-0 gap-1.5">' +
          '<label class="flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-900 has-[:checked]:text-white">' +
            '<input type="radio" name="' + esc(groupName) + '" data-field="stock-finished" data-action="stock-finished-input" value="yes" checked class="hidden" />Yes</label>' +
          '<label class="flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-900 has-[:checked]:text-white">' +
            '<input type="radio" name="' + esc(groupName) + '" data-field="stock-finished" data-action="stock-finished-input" value="no" class="hidden" />No</label>' +
        "</div>" +
      "</div>" +
      '<div data-stock-remaining-field hidden class="mt-2.5 flex items-center gap-2">' +
        '<label class="text-xs font-medium text-muted">Remaining from before:</label>' +
        '<input type="number" min="0" step="0.1" data-field="stock-remaining" value="' + (existingRow.available % 1 ? existingRow.available : Math.round(existingRow.available)) + '" class="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
        (existingRow.unit ? '<span class="text-xs text-muted">' + esc(existingRow.unit) + "</span>" : "") +
      "</div>" +
    "</div>"
  );
}

/* Rebuilds one item row's stock-reconciliation block after the item name
   or unit changes -- looks up whether that (item, unit) already has stock
   this month and shows/hides the "Previous stock finished?" toggle
   accordingly. monthKey comes from the form's own Date field (falling back
   to the latest month while the date is still blank on a brand-new form)
   so the lookup always reflects the month the expense is actually being
   recorded in, not just "today". */
function refreshStockReconcileForRow(row, form) {
  var host = row.querySelector("[data-stock-reconcile]");
  if (!host) return;

  /* Preserve the user's existing "No -- X left" choice (if any) across a
     rebuild triggered by something unrelated to THIS row -- e.g. changing
     the expense Date re-checks every row's reconcile block (the month may
     have changed), which would otherwise silently reset an already-typed
     answer back to the "Yes, finished" default before the form is submitted. */
  var previousChoice = row.querySelector('[data-field="stock-finished"]:checked');
  var previousIsNo = previousChoice && previousChoice.value === "no";
  var previousRemaining = previousIsNo ? (row.querySelector('[data-field="stock-remaining"]') || {}).value : null;

  var itemName = (row.querySelector('[data-field="item"]') || {}).value || "";
  var unit = (row.querySelector('[data-field="unit"]') || {}).value || "";
  var dateInput = form ? form.querySelector('[name="date"]') : null;
  var monthKey = dateInput && dateInput.value ? monthKeyOf(dateInput.value) : latestMonthKey();
  var existingRow = findExistingStockFor(itemName, unit, monthKey);
  host.innerHTML = stockReconcileBlockHtml(existingRow, row.dataset.rowId);

  if (existingRow && previousIsNo) {
    var noRadio = host.querySelector('[data-field="stock-finished"][value="no"]');
    var yesRadio = host.querySelector('[data-field="stock-finished"][value="yes"]');
    var remainingField = host.querySelector("[data-stock-remaining-field]");
    var remainingInput = host.querySelector('[data-field="stock-remaining"]');
    if (noRadio && yesRadio && remainingField && remainingInput) {
      yesRadio.checked = false;
      noRadio.checked = true;
      remainingField.hidden = false;
      if (previousRemaining !== null && previousRemaining !== "") remainingInput.value = previousRemaining;
    }
  }
}

function expenseFormModal(mode) {
  var isEdit = mode === "__EDIT__";
  var id = isEdit ? "expense-edit-modal" : "expense-add-modal";
  var memberCheckboxes = activeMembers().map(function (m) {
    return (
      '<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-900 has-[:checked]:text-white">' +
        '<input type="checkbox" name="buyerIds" value="' + m.id + '" class="hidden" />' +
        avatarHtml(m.pictureUrl, m.name, "h-7 w-7", m.avatarColor, "text-[11px]") +
        esc(m.name) +
      "</label>"
    );
  }).join("");
  var body = (
    '<form data-form="expense" data-mode="' + (isEdit ? "edit" : "add") + '" class="space-y-4">' +
      (isEdit ? '<input type="hidden" name="id" />' : "") +
      "<div>" + fieldLabel("Items") +
        '<div class="space-y-3" data-item-rows>' + expenseItemRowHtml("0") + "</div>" +
        '<button type="button" data-action="add-item-row" class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-gray-100/40 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("plus", "h-4 w-4") + "Add Another Item</button>" +
      "</div>" +
      "<div>" + fieldLabel("Done By (select one or more)") + '<div class="grid grid-cols-2 gap-2" data-buyer-picker>' + memberCheckboxes + "</div></div>" +
      '<div class="grid grid-cols-2 gap-4"><div>' + fieldLabel("Date") + '<input name="date" type="date" required class="' + FIELD_CLASS + '" /></div><div></div></div>' +
      "<div>" + fieldLabel("Note (optional)") + '<textarea name="note" rows="2" placeholder="e.g. Price increased this week" class="' + FIELD_CLASS + '"></textarea></div>' +
      '<div class="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3"><span class="text-sm font-semibold text-navy-900">Total</span><span data-item-total class="text-base font-bold tabular-nums text-navy-900">৳0</span></div>' +
      '<div class="flex justify-end gap-2 pt-2"><button type="button" data-action="close-modal" data-modal="' + id + '" class="btn-secondary">Cancel</button><button type="submit" class="btn-primary">' + (isEdit ? "Save Changes" : "Add Expense") + "</button></div>" +
    "</form>"
  );
  return modalWrapper(id, isEdit ? "Edit Expense" : "Add Expense", body);
}

function itemSuggestionsHtml(categoryName, query) {
  var items = itemsForCategory(categoryName);
  var q = (query || "").trim().toLowerCase();
  var matches = q ? items.filter(function (it) { return it.toLowerCase().indexOf(q) >= 0; }) : items;
  if (!matches.length) return "";
  return matches.map(function (it) {
    return '<li data-action="select-item-suggestion" data-value="' + esc(it) + '" class="cursor-pointer px-3.5 py-2 text-sm text-foreground hover:bg-navy-50">' + esc(it) + "</li>";
  }).join("");
}
function refreshItemSuggestions(itemInput) {
  var field = itemInput.closest("[data-item-field]");
  if (!field) return;
  var list = field.querySelector("[data-item-suggestions]");
  if (!list) return;
  var row = itemInput.closest("[data-item-row]");
  var categorySelect = row ? row.querySelector('[data-field="category"]') : null;
  var categoryName = categorySelect ? categorySelect.value : "";
  var html = categoryName ? itemSuggestionsHtml(categoryName, itemInput.value) : "";
  list.innerHTML = html;
  list.hidden = !html;
}

/* Recomputes and displays the running Total (sum of every item row's Amount
   input) for the expense form that contains `withinEl`. */
function refreshExpenseItemTotal(withinEl) {
  var form = withinEl.closest ? withinEl.closest("form") : withinEl;
  if (!form) return;
  var totalEl = form.querySelector("[data-item-total]");
  if (!totalEl) return;
  var sum = 0;
  form.querySelectorAll('[data-item-row] [data-field="amount"]').forEach(function (input) {
    var v = parseFloat(input.value);
    if (v > 0) sum += v;
  });
  totalEl.textContent = formatCurrency(sum);
}

/* Adds a fresh empty item row to the given expense form's item-rows list. */
function addExpenseItemRow(form) {
  var rowsHost = form.querySelector("[data-item-rows]");
  if (!rowsHost) return;
  var rowId = "r" + Math.random().toString(36).slice(2, 9);
  var wrapper = document.createElement("div");
  wrapper.innerHTML = expenseItemRowHtml(rowId);
  rowsHost.appendChild(wrapper.firstChild);
  updateRemoveRowButtons(form);
}

/* Removes the given item row's remove-button disabled state so at least one
   row always remains removable-or-not depending on row count. */
function updateRemoveRowButtons(form) {
  var rows = form.querySelectorAll("[data-item-row]");
  var onlyOne = rows.length <= 1;
  rows.forEach(function (row) {
    var btn = row.querySelector('[data-action="remove-item-row"]');
    if (btn) {
      btn.disabled = onlyOne;
      btn.classList.toggle("opacity-30", onlyOne);
      btn.classList.toggle("cursor-not-allowed", onlyOne);
    }
  });
}

/* Rebuilds an expense form's item-rows list from an array of
   {category, item, quantity, unit, amount} objects (used when opening the
   Edit Expense modal) — always renders at least one (possibly empty) row. */
function setExpenseItemRows(form, items) {
  var rowsHost = form.querySelector("[data-item-rows]");
  if (!rowsHost) return;
  var list = (items && items.length) ? items : [{}];
  rowsHost.innerHTML = list.map(function (it, i) { return expenseItemRowHtml("r" + i + "_" + Math.random().toString(36).slice(2, 7)); }).join("");
  var rows = rowsHost.querySelectorAll("[data-item-row]");
  rows.forEach(function (row, i) {
    var it = list[i] || {};
    var catSel = row.querySelector('[data-field="category"]');
    var itemInput = row.querySelector('[data-field="item"]');
    if (catSel) catSel.value = it.category || "";
    if (itemInput) itemInput.value = it.item || "";
    row.querySelector('[data-field="quantity"]').value = it.quantity != null ? it.quantity : "";
    row.querySelector('[data-field="unit"]').value = it.unit || "";
    row.querySelector('[data-field="amount"]').value = it.amount != null ? it.amount : "";
    var suggestions = row.querySelector("[data-item-suggestions]");
    if (suggestions) suggestions.hidden = true;
  });
  updateRemoveRowButtons(form);
  refreshExpenseItemTotal(form);
  refreshAllStockReconcileBlocks(form);
}

/* Refreshes the stock-reconcile block for every item row currently in the
   given expense form -- called after the form's item rows have just been
   (re)built (add-item-row, setExpenseItemRows) so the "Previous stock
   finished?" toggle reflects whatever item/unit/date is already filled in. */
function refreshAllStockReconcileBlocks(form) {
  form.querySelectorAll("[data-item-row]").forEach(function (row) { refreshStockReconcileForRow(row, form); });
}

/* Reads the expense form's rendered item rows (which may have been added or
   removed dynamically since the form was first rendered) directly from the
   DOM and reconstructs an array of {category, item, quantity, unit, amount}
   objects. A row left completely empty (no item AND no amount) is silently
   dropped so users can add a row and change their mind. A row that is only
   half-filled (item without a positive amount, or vice versa) is treated as
   a validation error, mirroring the old single-item form's required-field
   behavior. Returns { items: [...] } on success or { error: "..." }. */
function parseExpenseItemRows(form, monthKey) {
  var items = [];
  var rows = form.querySelectorAll("[data-item-row]");
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var category = String((row.querySelector('[data-field="category"]') || {}).value || "").trim();
    var itemName = String((row.querySelector('[data-field="item"]') || {}).value || "").trim();
    var quantityRaw = (row.querySelector('[data-field="quantity"]') || {}).value || "";
    var unit = String((row.querySelector('[data-field="unit"]') || {}).value || "").trim();
    var amountRaw = (row.querySelector('[data-field="amount"]') || {}).value || "";
    var amount = amountRaw !== "" ? parseFloat(amountRaw) : NaN;

    if (!itemName && !amountRaw && !category) continue; /* fully empty row: silently skip */
    if (!category) {
      return { error: "Please select a category for \"" + (itemName || "item " + (i + 1)) + "\"." };
    }
    if (!itemName || !(amount > 0)) {
      return { error: "Each item needs a name and a valid amount." };
    }

    /* "Previous stock finished?" reconciliation, only present on rows where
       findExistingStockFor() found stock to reconcile (see
       stockReconcileBlockHtml). No block at all (no existing stock for this
       item+unit) means no correction is needed. "No" means the user typed
       how much of the OLD stock is actually left. "Yes" means the old stock
       is entirely used up, i.e. 0 remains. Either way this is carried as
       manualStockRemaining so the submit handler can record the right
       delta via recordManualStockCarryForward, which recomputes the "before
       this purchase" baseline itself at save time -- see that function for
       why a delta, not the raw typed number, is what actually gets stored.
       Without this "Yes" branch, the default "Yes" choice recorded no
       correction at all, so the old (supposedly finished) stock kept
       silently adding into Available alongside the new purchase. */
    var finishedChoice = row.querySelector('[data-field="stock-finished"]:checked');
    var manualStockRemaining = null;
    if (finishedChoice && findExistingStockFor(itemName, unit, monthKey)) {
      if (finishedChoice.value === "no") {
        var remainingRaw = (row.querySelector('[data-field="stock-remaining"]') || {}).value;
        var remainingVal = remainingRaw !== "" && remainingRaw != null ? parseFloat(remainingRaw) : NaN;
        manualStockRemaining = !isNaN(remainingVal) ? Math.max(0, remainingVal) : 0;
      } else {
        manualStockRemaining = 0;
      }
    }

    items.push({
      category: category || null,
      item: itemName,
      quantity: quantityRaw !== "" ? parseFloat(quantityRaw) : null,
      unit: unit || null,
      amount: amount,
      manualStockRemaining: manualStockRemaining,
    });
  }
  return { items: items };
}

/* ============================== STORE (monthly bazaar summary) ============================== */
function shiftMonthKey(monthKey, delta) {
  var parts = monthKey.split("-");
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + delta, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function monthSwitcherHtml(monthKey, navAction) {
  navAction = navAction || "store-month-nav";
  var latest = latestMonthKey();
  var isLatest = monthKey === latest;
  return (
    '<div class="flex items-center gap-2">' +
      '<div class="flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-card)]">' +
        '<button data-action="' + navAction + '" data-month="' + shiftMonthKey(monthKey, -1) + '" class="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("chevron-left", "h-4 w-4") + "</button>" +
        '<span class="min-w-[9rem] text-center text-sm font-semibold text-foreground">' + esc(monthLabel(monthKey)) + "</span>" +
        '<button data-action="' + navAction + '" data-month="' + shiftMonthKey(monthKey, 1) + '" class="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("chevron-right", "h-4 w-4") + "</button>" +
      "</div>" +
      (isLatest ? "" : '<button data-action="' + navAction + '" data-month="' + latest + '" class="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-navy-900 shadow-[var(--shadow-card)] transition-colors hover:bg-navy-50">Latest</button>') +
    "</div>"
  );
}
/* ============================== STORE STOCK (Close Month feature) ==============================
   Stock rows are keyed by (item, unit) — not item alone — so the same item
   name recorded under two different units (e.g. "Rice" in kg somewhere and
   "Rice" in gm elsewhere) is never summed together into a meaningless total.
   There is no separate usage log — Close Month simply lets the user type
   how much of each item is actually left, and that typed number is what
   carries forward (nothing is auto-subtracted). Nothing here ever deletes
   or rewrites an expense row; closing a month only READS DB.expenses for
   that month and WRITES one snapshot into DB.storeClosedMonths plus
   opening rows into DB.storeCarryForward for the following month. */
function storeStockKey(item, unit) { return item + "" + (unit || ""); }

/* Every expense item that has BOTH a positive quantity and a unit — items
   entered as amount-only (no quantity) can't have a "remaining" quantity,
   so they're excluded from stock tracking (they still show in the plain
   "what was bought" price list below). */
function storePurchaseRowsForMonth(monthKey) {
  var out = [];
  DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); }).forEach(function (e) {
    (e.items || []).forEach(function (it) {
      if (it.quantity > 0 && it.unit) out.push({ item: it.item, unit: it.unit, quantity: Number(it.quantity), amount: it.amount });
    });
  });
  return out;
}
/* Sums same-key rows rather than overwriting, since a given (item, unit,
   monthKey) can now have more than one carry-forward row: one written by
   closeStoreMonth() (fromMonthKey = the closed month) plus any number of
   manual "remaining from before" corrections entered on the Add Expense
   form (fromMonthKey = "manual" -- see recordManualStockCarryForward). */
function storeCarryForwardInto(monthKey) {
  var map = {};
  DB.storeCarryForward.filter(function (c) { return c.monthKey === monthKey; }).forEach(function (c) {
    var key = storeStockKey(c.item, c.unit);
    if (!map[key]) map[key] = { item: c.item, unit: c.unit, quantity: 0 };
    map[key].quantity += c.quantity;
  });
  return map;
}

/* Records (or updates) a manual "remaining from before" correction -- used
   by both the Add/Edit Expense form's "Previous stock finished?" answer
   (`remaining` is 0 for "Yes", or whatever was typed for "No") and the
   Store page's standalone "Edit Stock" control (see editStockModal),
   which lets the actual on-hand quantity be corrected at any time, not
   just when a new purchase is being recorded.

   The number is what the user says is ACTUALLY left of everything
   purchased so far this month (old purchases included) -- not an amount to
   add on top. So this cannot simply be added as another positive
   carry-forward row (computeStoreStockSummary() already counts every
   purchase recorded this month toward `purchased`); doing that would
   double count the old, already-used portion. Instead this stores the
   DIFFERENCE between what the user says is left (`remaining`) and what
   this item's Available would be with any EXISTING manual correction for
   it removed (purchased-so-far + any real Close-Month carry-in, but not
   a stale prior manual delta) -- normally negative, since it is correcting
   for stock that was used up.

   That "existing manual row removed" baseline is recomputed here from
   scratch on every call, rather than trusting a caller-supplied prior-
   Available snapshot: this function always REPLACES this item's one
   manual row (see the filter below), so if a caller's snapshot had been
   taken *after* an earlier manual correction was already applied (e.g.
   editing the same item's stock a second time), computing the new delta
   against that snapshot would double-count the row that's about to be
   replaced -- the same "remaining" typed twice would keep drifting further
   from what was actually typed. Recomputing the baseline here, with this
   item's own manual row temporarily excluded, keeps every call idempotent:
   calling this repeatedly with the same `remaining` always lands on the
   same Available.

   Because storeCarryForwardInto() SUMS every carry-forward row for a
   (item, unit, monthKey) rather than picking one, the resulting delta
   composes correctly on top of any real carry-forward Close Month already
   wrote in, and on top of the current month's own purchases: available
   ends up exactly `remaining` right after this call, and grows from there
   only with whatever is purchased next.

   Written as its own DB.storeCarryForward row (fromMonthKey: "manual")
   into the given month. Keyed by (item, unit, monthKey) so calling this
   again for the same item (whether from another expense save or another
   Edit Stock correction) replaces the prior manual delta instead of
   stacking duplicates; a delta of exactly 0 (typed remaining matches what
   was already available) removes any existing manual row instead of
   storing a useless no-op entry. */
function recordManualStockCarryForward(item, unit, monthKey, remaining) {
  DB.storeCarryForward = DB.storeCarryForward.filter(function (c) {
    return !(c.monthKey === monthKey && c.fromMonthKey === "manual" && c.item === item && c.unit === unit);
  });
  var baseline = findExistingStockFor(item, unit, monthKey);
  var priorAvailable = baseline ? baseline.available : 0;
  var delta = remaining - priorAvailable;
  if (delta !== 0) {
    DB.storeCarryForward.push({ item: item, unit: unit, monthKey: monthKey, fromMonthKey: "manual", quantity: delta });
  }
}

/* Builds the full Purchased / Used / Previous Carry Forward / Remaining
   table for a given month — the single source of truth both the on-screen
   Store page and the Close Month confirmation/history views read from, so
   the numbers can never drift apart between them. */
function computeStoreStockSummary(monthKey) {
  var rows = {}; // key -> {item, unit, purchased, purchaseAmount, previousCarryForward}
  function ensure(item, unit) {
    var key = storeStockKey(item, unit);
    if (!rows[key]) rows[key] = { item: item, unit: unit, purchased: 0, purchaseAmount: 0, previousCarryForward: 0 };
    return rows[key];
  }
  storePurchaseRowsForMonth(monthKey).forEach(function (p) {
    var row = ensure(p.item, p.unit);
    row.purchased += p.quantity;
    row.purchaseAmount += p.amount;
  });
  var carryIn = storeCarryForwardInto(monthKey);
  Object.keys(carryIn).forEach(function (key) {
    var c = carryIn[key];
    var row = ensure(c.item, c.unit);
    row.previousCarryForward = c.quantity;
  });

  var list = Object.keys(rows).map(function (key) {
    var r = rows[key];
    r.available = r.purchased + r.previousCarryForward;
    return r;
  }).sort(function (a, b) { return a.item < b.item ? -1 : a.item > b.item ? 1 : 0; });

  var totals = list.reduce(function (acc, r) {
    acc.purchased += r.purchased;
    acc.previousCarryForward += r.previousCarryForward;
    acc.available += r.available;
    return acc;
  }, { purchased: 0, previousCarryForward: 0, available: 0 });

  return { monthKey: monthKey, rows: list, totals: totals };
}

/* Looks up the stock already on hand for one (item, unit) in a given month
   -- purchased-so-far this month plus any carry-forward in -- before a new,
   not-yet-saved expense item row is added on top of it. Used by the Add
   Expense form's "Previous stock finished?" toggle to decide whether to
   show the toggle at all (only when there is existing stock to reconcile)
   and what quantity to suggest if the user says it is NOT finished. Case-
   insensitive item-name match so "rice" typed in the form still finds
   stock recorded as "Rice". Returns null when there is no existing stock
   for that item+unit this month. */
function findExistingStockFor(item, unit, monthKey) {
  if (!item || !unit || !/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  var summary = computeStoreStockSummary(monthKey);
  var needleItem = item.trim().toLowerCase();
  var needleUnit = unit.trim().toLowerCase();
  var row = summary.rows.filter(function (r) {
    return r.item.trim().toLowerCase() === needleItem && (r.unit || "").trim().toLowerCase() === needleUnit;
  })[0];
  return row && row.available > 0 ? row : null;
}

function findClosedStoreMonth(monthKey) {
  return DB.storeClosedMonths.filter(function (c) { return c.monthKey === monthKey; })[0] || null;
}

/* Finalizes a month using the remaining quantities the user typed into the
   Close Month modal: remainingByKey maps storeStockKey(item, unit) ->
   remaining quantity (number, may be 0). Falls back to "available"
   (Purchased + Previous Carry Forward) for any item not present in the map,
   so a missing/blank input never silently loses stock. Snapshots the
   numbers for history, then writes one DB.storeCarryForward row per item
   with a positive remaining quantity into the NEXT month (items typed as 0
   simply don't carry forward). Re-closing an already-closed month
   overwrites its own snapshot/carry-forward rows only — never any other
   month's — so it can be safely re-run if the typed amounts change. */
function closeStoreMonth(monthKey, remainingByKey) {
  var summary = computeStoreStockSummary(monthKey);
  var nextMonthKey = shiftMonthKey(monthKey, 1);

  var rows = summary.rows.map(function (r) {
    var key = storeStockKey(r.item, r.unit);
    var typed = remainingByKey ? remainingByKey[key] : undefined;
    var remaining = (typed !== undefined && typed !== null && !isNaN(typed)) ? Math.max(0, Number(typed)) : r.available;
    return { item: r.item, unit: r.unit, purchased: r.purchased, previousCarryForward: r.previousCarryForward, available: r.available, remaining: remaining };
  });

  var snapshot = {
    monthKey: monthKey,
    closedAt: new Date().toISOString(),
    rows: rows,
    totals: rows.reduce(function (acc, r) {
      acc.purchased += r.purchased;
      acc.previousCarryForward += r.previousCarryForward;
      acc.available += r.available;
      acc.remaining += r.remaining;
      return acc;
    }, { purchased: 0, previousCarryForward: 0, available: 0, remaining: 0 }),
  };
  var existingIndex = -1;
  DB.storeClosedMonths.forEach(function (row, i) { if (row.monthKey === monthKey) existingIndex = i; });
  if (existingIndex >= 0) DB.storeClosedMonths[existingIndex] = snapshot;
  else DB.storeClosedMonths.push(snapshot);

  /* Replace (not append to) this month's -> nextMonthKey carry-forward rows
     so re-closing never duplicates quantities carried forward earlier. */
  DB.storeCarryForward = DB.storeCarryForward.filter(function (c) { return c.monthKey !== nextMonthKey || c.fromMonthKey !== monthKey; });
  rows.forEach(function (r) {
    if (r.remaining > 0) {
      DB.storeCarryForward.push({ item: r.item, unit: r.unit, monthKey: nextMonthKey, fromMonthKey: monthKey, quantity: r.remaining });
    }
  });

  saveDB();
  return snapshot;
}

function storeStockRowHtml(r) {
  var unitLabel = r.unit ? " " + esc(r.unit) : "";
  /* Carry Forward can go negative -- see recordManualStockCarryForward --
     when a "Previous stock finished? No" correction on the Add Expense
     form (or a manual stock edit -- see editStockModal) says less is
     left than the month's purchases alone would imply. Shown in a distinct
     tone from a normal positive carry-in so it reads as "reduced for stock
     already used" rather than a data glitch. */
  var carryForwardHtml = !r.previousCarryForward ? "-" :
    (r.previousCarryForward < 0 ? '<span class="text-warning-700">' : "") +
    formatNumber(r.previousCarryForward, r.previousCarryForward % 1 ? 1 : 0) + unitLabel +
    (r.previousCarryForward < 0 ? "</span>" : "");
  var key = storeStockKey(r.item, r.unit);
  return (
    '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
      '<td class="px-5 py-3 font-medium text-foreground">' + esc(r.item) + "</td>" +
      '<td class="px-5 py-3 text-right tabular-nums text-muted">' + carryForwardHtml + "</td>" +
      '<td class="px-5 py-3 text-right tabular-nums text-success-700">' + (r.purchased ? formatNumber(r.purchased, r.purchased % 1 ? 1 : 0) + unitLabel : "-") + "</td>" +
      '<td class="px-5 py-3 text-right font-semibold tabular-nums text-navy-900">' + (r.available ? formatNumber(r.available, r.available % 1 ? 1 : 0) + unitLabel : "-") + "</td>" +
      '<td class="px-5 py-3 text-right"><button type="button" data-action="open-edit-stock-row" data-key="' + esc(key) + '" title="Edit available quantity" class="rounded-lg p-2 text-muted transition-colors hover:bg-gray-100 hover:text-foreground">' + icon("pencil", "h-4 w-4") + "</button></td>" +
    "</tr>"
  );
}

function renderStore(monthKey) {
  monthKey = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : latestMonthKey();
  var monthExpenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); });
  var storeTotals = {};
  monthExpenses.forEach(function (e) {
    (e.items || []).forEach(function (it) {
      if (!storeTotals[it.item]) storeTotals[it.item] = { item: it.item, amount: 0, qty: 0, unit: it.unit || "" };
      storeTotals[it.item].amount += it.amount;
      if (it.quantity && (!storeTotals[it.item].unit || storeTotals[it.item].unit === it.unit)) {
        storeTotals[it.item].qty += Number(it.quantity);
        storeTotals[it.item].unit = it.unit || storeTotals[it.item].unit;
      }
    });
  });
  var storeRows = Object.keys(storeTotals).map(function (k) { return storeTotals[k]; }).sort(function (a, b) { return b.amount - a.amount; });
  var storeMonthTotal = monthExpenses.reduce(function (s, e) { return s + e.amount; }, 0);

  var stock = computeStoreStockSummary(monthKey);
  var closed = findClosedStoreMonth(monthKey);

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">Store' + (closed ? " " + badge("Closed", "navy") : "") + '</h1><p class="mt-1 text-sm text-muted">What was bought and what is available this month.</p></div>' +
        monthSwitcherHtml(monthKey) +
      "</div>" +

      '<div class="flex flex-wrap gap-2">' +
        '<button data-action="open-close-store-month" data-month="' + monthKey + '" class="btn-secondary btn-sm">' + icon("shield-check", "h-4 w-4") + (closed ? "Re-close Month" : "Close Month") + "</button>" +
        '<button data-action="open-modal" data-modal="store-history-modal" class="btn-secondary btn-sm">' + icon("calendar-days", "h-4 w-4") + "Monthly History</button>" +
      "</div>" +

      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">' +
        statCard({ label: "Total Spent", value: storeMonthTotal, prefix: "৳", icon: "shopping-basket", tone: "danger" }) +
        statCard({ label: "Items Bought", value: storeRows.length, icon: "receipt", tone: "navy" }) +
        statCard({ label: "Purchases", value: monthExpenses.length, icon: "shopping-cart", tone: "gray" }) +
      "</div>" +

      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Current Stock -- ' + esc(monthLabel(monthKey)) + "</h2><p class=\"mt-0.5 text-xs text-muted\">Available = Carry Forward + Purchased. Use the edit icon to correct an item's quantity by hand if it doesn't match what's actually left. Only items recorded with a quantity and unit are tracked here.</p></div>" +
        (stock.rows.length === 0 ? '<div class="p-6">' + emptyState("shopping-basket", "No trackable stock this month", "Add an expense with a quantity + unit to start tracking stock.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full min-w-[480px] text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Item</th><th class="px-5 py-3 text-right">Carry Forward</th><th class="px-5 py-3 text-right">Purchased</th><th class="px-5 py-3 text-right">Available</th><th class="px-5 py-3 text-right">Actions</th>' +
        "</tr></thead><tbody>" + stock.rows.map(storeStockRowHtml).join("") + "</tbody></table></div>") +
      "</div>" +

      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">' + esc(monthLabel(monthKey)) + " -- What Was Bought</h2></div>" +
        (storeRows.length === 0 ? '<div class="p-6">' + emptyState("shopping-basket", "Nothing bought this month", "Add an expense to start tracking the store for this month.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Product Name</th><th class="px-5 py-3">Quantity</th><th class="px-5 py-3 text-right">Price</th>' +
        "</tr></thead><tbody>" +
        storeRows.map(function (row) {
          return (
            '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
              '<td class="px-5 py-3 font-medium text-foreground">' + esc(row.item) + "</td>" +
              '<td class="px-5 py-3 text-muted">' + (row.qty ? formatNumber(row.qty, row.qty % 1 ? 1 : 0) + (row.unit ? " " + esc(row.unit) : "") : "-") + "</td>" +
              '<td class="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">' + formatCurrency(row.amount) + "</td>" +
            "</tr>"
          );
        }).join("") +
        '<tr class="bg-navy-50"><td class="px-5 py-3 text-sm font-semibold text-navy-900">Total</td><td class="px-5 py-3"></td><td class="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">' + formatCurrency(storeMonthTotal) + "</td></tr>" +
        "</tbody></table></div>") +
      "</div>" +
    "</div>" +
    closeStoreMonthModal(monthKey) +
    storeHistoryModal() +
    editStockModal()
  );
}

/* Renders one editable row of the Close Month modal's item table: shows the
   calculated Available quantity (read-only reference) and an input,
   pre-filled with that same Available value as a starting suggestion,
   where the user types the quantity actually left. The input's name
   encodes the item+unit key so the submit handler can read every row back
   out of the DOM without needing separate JS state. */
function closeStoreMonthItemRowHtml(r) {
  var key = storeStockKey(r.item, r.unit);
  var unitLabel = r.unit ? " " + esc(r.unit) : "";
  return (
    '<div class="flex items-center gap-3 rounded-xl border border-border px-3.5 py-2.5">' +
      '<div class="min-w-0 flex-1">' +
        '<p class="truncate text-sm font-medium text-foreground">' + esc(r.item) + "</p>" +
        '<p class="text-xs text-muted">Available: ' + formatNumber(r.available, r.available % 1 ? 1 : 0) + unitLabel + "</p>" +
      "</div>" +
      '<input type="number" min="0" step="0.1" data-action="close-store-remaining-input" data-key="' + esc(key) + '" value="' + (r.available % 1 ? r.available : Math.round(r.available)) + '" class="w-28 shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-right text-sm text-foreground focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
      (r.unit ? '<span class="w-10 shrink-0 text-xs text-muted">' + esc(r.unit) + "</span>" : "") +
    "</div>"
  );
}

function closeStoreMonthSummaryBody(monthKey) {
  var stock = computeStoreStockSummary(monthKey);
  return (
    '<p class="text-sm text-muted">Type in how much of each item is actually left this month. That amount will carry forward into <span class="font-semibold text-foreground">' + esc(monthLabel(shiftMonthKey(monthKey, 1))) + "</span> as opening stock -- items left at 0 will not carry forward.</p>" +
    (stock.rows.length === 0 ?
      '<p class="mt-4 text-sm text-muted">No trackable items this month.</p>' :
      '<div class="mt-4 max-h-[22rem] space-y-2 overflow-y-auto">' + stock.rows.map(closeStoreMonthItemRowHtml).join("") + "</div>")
  );
}

function closeStoreMonthModal(monthKey) {
  var body = (
    '<div id="close-store-month-body">' + closeStoreMonthSummaryBody(monthKey) + "</div>" +
    '<div class="mt-5 flex justify-end gap-2">' +
      '<button type="button" data-action="close-modal" data-modal="close-store-month-modal" class="btn-secondary">Cancel</button>' +
      '<button type="button" data-action="confirm-close-store-month" data-month="' + monthKey + '" class="btn-primary">' + icon("shield-check", "h-4 w-4") + "Close Month</button>" +
    "</div>"
  );
  return modalWrapper("close-store-month-modal", "Close " + monthLabel(monthKey), body);
}

/* Single-item "Edit Stock" modal — lets the user directly correct one
   item's Available quantity mid-month (not tied to closing the month).
   Reuses recordManualStockCarryForward under the hood: same mechanism the
   Add Expense form's "Previous stock finished?" toggle already uses, just
   exposed here as its own standalone control on the Store page so a
   mismatch can be fixed on the spot without waiting for the next purchase
   or Close Month. */
function editStockModalBody(item, unit, available) {
  var unitLabel = unit ? " " + esc(unit) : "";
  return (
    '<p class="text-sm text-muted">Currently shows <span class="font-semibold text-foreground">' + formatNumber(available, available % 1 ? 1 : 0) + unitLabel + '</span> available for <span class="font-semibold text-foreground">' + esc(item) + '</span>. Type in the actual quantity you have on hand.</p>' +
    '<div class="mt-4 flex items-center gap-2">' +
      '<input type="number" min="0" step="0.1" id="edit-stock-quantity-input" value="' + (available % 1 ? available : Math.round(available)) + '" class="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-right text-sm text-foreground focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20" />' +
      (unit ? '<span class="text-sm text-muted">' + esc(unit) + "</span>" : "") +
    "</div>"
  );
}
function editStockModal() {
  var body = (
    '<div id="edit-stock-body"></div>' +
    '<div class="mt-5 flex justify-end gap-2">' +
      '<button type="button" data-action="close-modal" data-modal="edit-stock-modal" class="btn-secondary">Cancel</button>' +
      '<button type="button" data-action="confirm-edit-stock" class="btn-primary">' + icon("pencil", "h-4 w-4") + "Save</button>" +
    "</div>"
  );
  return modalWrapper("edit-stock-modal", "Edit Stock Quantity", body);
}

function storeHistoryListHtml() {
  var closedMonths = DB.storeClosedMonths.slice().sort(function (a, b) { return a.monthKey < b.monthKey ? 1 : -1; });
  if (closedMonths.length === 0) {
    return emptyState("calendar-days", "No closed months yet", "Close a month from the Store page to start building history.");
  }
  return '<div class="max-h-[28rem] space-y-2 overflow-y-auto">' + closedMonths.map(function (c) {
    return (
      '<button type="button" data-action="view-store-history-month" data-month="' + c.monthKey + '" class="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-gray-100">' +
        '<span class="font-medium text-foreground">' + esc(monthLabel(c.monthKey)) + "</span>" +
        badge("Closed", "navy") +
      "</button>"
    );
  }).join("") + "</div>";
}
function storeHistoryModal() {
  return modalWrapper("store-history-modal", "Store History", '<div id="store-history-body">' + storeHistoryListHtml() + "</div>");
}

function storeHistoryDetailHtml(monthKey) {
  var closed = findClosedStoreMonth(monthKey);
  if (!closed) return emptyState("calendar-days", "This month was not closed");
  var rows = closed.rows.slice().sort(function (a, b) { return a.item < b.item ? -1 : a.item > b.item ? 1 : 0; });
  return (
    '<button type="button" data-action="back-to-store-history-list" class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-900 hover:underline">' + icon("arrow-left", "h-4 w-4") + "Back to Store History</button>" +
    '<h3 class="mb-1 text-base font-semibold text-foreground">' + esc(monthLabel(monthKey)) + " Summary</h3>" +
    '<p class="mb-4 text-xs text-muted">Closed on ' + dateLabelMed(closed.closedAt.slice(0, 10)) + "</p>" +
    '<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">' +
      '<div class="rounded-xl border border-border px-3 py-2.5"><p class="text-xs text-muted">Items</p><p class="mt-0.5 text-base font-semibold tabular-nums text-foreground">' + rows.length + "</p></div>" +
      '<div class="rounded-xl border border-border px-3 py-2.5"><p class="text-xs text-muted">Purchased</p><p class="mt-0.5 text-base font-semibold tabular-nums text-success-700">' + formatNumber(closed.totals.purchased, closed.totals.purchased % 1 ? 1 : 0) + "</p></div>" +
      '<div class="rounded-xl border border-border px-3 py-2.5"><p class="text-xs text-muted">Carried Forward</p><p class="mt-0.5 text-base font-semibold tabular-nums text-navy-900">' + formatNumber(closed.totals.remaining, closed.totals.remaining % 1 ? 1 : 0) + "</p></div>" +
    "</div>" +
    (rows.length === 0 ? emptyState("shopping-basket", "No trackable items this month") :
    '<div class="overflow-x-auto rounded-xl border border-border"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
      '<th class="px-4 py-2">Item</th><th class="px-3 py-2 text-right">Carry Forward</th><th class="px-3 py-2 text-right">Purchased</th><th class="px-4 py-2 text-right">Carried to Next</th>' +
    "</tr></thead><tbody>" + rows.map(function (r) {
      var unitLabel = r.unit ? " " + esc(r.unit) : "";
      return (
        '<tr class="border-b border-border last:border-0">' +
          '<td class="px-4 py-2 font-medium text-foreground">' + esc(r.item) + "</td>" +
          '<td class="px-3 py-2 text-right tabular-nums text-muted">' + (r.previousCarryForward ? formatNumber(r.previousCarryForward, r.previousCarryForward % 1 ? 1 : 0) + unitLabel : "-") + "</td>" +
          '<td class="px-3 py-2 text-right tabular-nums text-success-700">' + (r.purchased ? formatNumber(r.purchased, r.purchased % 1 ? 1 : 0) + unitLabel : "-") + "</td>" +
          '<td class="px-4 py-2 text-right font-semibold tabular-nums ' + (r.remaining > 0 ? "text-navy-900" : "text-muted") + '">' + (r.remaining > 0 ? formatNumber(r.remaining, r.remaining % 1 ? 1 : 0) + unitLabel : "-") + "</td>" +
        "</tr>"
      );
    }).join("") + "</tbody></table></div>")
  );
}

/* ============================== HISAB (SETTLEMENT) ============================== */
/* Pure calculated view over existing DB.deposits / DB.expenses / DB.meals —
   no new money-entry data model. Mirrors the same date-iteration rule as
   computeMonthSummary() (eachDateInMonth × activeMembers via mealFor) so the
   numbers always agree with the rest of the app. */
function computeHisabSummary(monthKey) {
  var today = latestDateAcross();
  var dates = eachDateInMonth(monthKey).filter(function (d) { return d <= today; });
  var members = activeMembers();

  var monthExpenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); });
  var totalBazarCost = monthExpenses.reduce(function (s, e) { return s + e.amount; }, 0);

  var monthDeposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); });
  var totalPaid = monthDeposits.reduce(function (s, d) { return s + d.amount; }, 0);

  var memberRows = members.map(function (m) {
    var paid = monthDeposits.filter(function (d) { return d.memberId === m.id; }).reduce(function (s, d) { return s + d.amount; }, 0);
    var meals = 0;
    dates.forEach(function (d) {
      var meal = mealFor(m.id, d);
      meals += (meal.breakfast ? 1 : 0) + (meal.lunch ? 1 : 0) + (meal.dinner ? 1 : 0);
    });
    return { memberId: m.id, name: m.name, avatarColor: m.avatarColor, pictureUrl: m.pictureUrl, paid: paid, meals: meals };
  });

  var totalMeals = memberRows.reduce(function (s, r) { return s + r.meals; }, 0);
  var mealRate = calcMealRate(totalBazarCost, totalMeals);

  memberRows.forEach(function (r) {
    r.mealCost = r.meals * mealRate;
    r.balance = r.paid - r.mealCost;
  });

  return {
    monthKey: monthKey,
    totalBazarCost: totalBazarCost,
    totalPaid: totalPaid,
    totalMeals: totalMeals,
    mealRate: mealRate,
    memberCount: members.length,
    members: memberRows,
    transfers: computeSettlementTransfers(memberRows),
  };
}

/* Standard greedy minimal-transfer debt settlement: repeatedly match the
   largest debtor with the largest creditor for min(|debt|, credit). */
function computeSettlementTransfers(memberRows) {
  var EPS = 0.01;
  var debtors = memberRows.filter(function (r) { return r.balance < -EPS; })
    .map(function (r) { return { memberId: r.memberId, name: r.name, amount: -r.balance }; });
  var creditors = memberRows.filter(function (r) { return r.balance > EPS; })
    .map(function (r) { return { memberId: r.memberId, name: r.name, amount: r.balance }; });

  var transfers = [];
  var i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    debtors.sort(function (a, b) { return b.amount - a.amount; });
    creditors.sort(function (a, b) { return b.amount - a.amount; });
    var debtor = debtors[0], creditor = creditors[0];
    var amount = Math.min(debtor.amount, creditor.amount);
    if (amount > EPS) {
      transfers.push({ from: debtor.name, to: creditor.name, amount: amount });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= EPS) debtors.shift();
    if (creditor.amount <= EPS) creditors.shift();
  }
  return transfers;
}

function findSettlement(monthKey) {
  return DB.settlements.filter(function (s) { return s.monthKey === monthKey; })[0] || null;
}

function statusBadgeForBalance(balance) {
  if (balance > 0.01) return badge("Will Receive " + formatCurrency(balance), "success");
  if (balance < -0.01) return badge("Needs to Pay " + formatCurrency(Math.abs(balance)), "danger");
  return badge("Settled", "gray");
}

function renderHisab(monthKeyParam) {
  var monthKey = monthKeyParam && /^\d{4}-\d{2}$/.test(monthKeyParam) ? monthKeyParam : latestMonthKey();
  var s = computeHisabSummary(monthKey);
  var finalized = findSettlement(monthKey);

  var memberRowsHtml = s.members.map(function (r) {
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' +
          avatarHtml(r.pictureUrl, r.name, "h-8 w-8", r.avatarColor) +
          '<span class="font-medium text-foreground">' + esc(r.name) + "</span>" +
        "</div></td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-success-700">' + formatCurrency(r.paid) + "</td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-foreground">' + formatNumber(r.meals) + "</td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-muted">' + formatCurrency(s.mealRate) + "</td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-danger-600">' + formatCurrency(r.mealCost) + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums ' + (r.balance > 0.01 ? "text-success-700" : r.balance < -0.01 ? "text-danger-600" : "text-muted") + '">' + (r.balance > 0 ? "+" : r.balance < 0 ? "−" : "") + formatCurrency(Math.abs(r.balance)) + "</td>" +
        '<td class="px-5 py-3">' + statusBadgeForBalance(r.balance) + "</td>" +
      "</tr>"
    );
  }).join("");

  var transfersHtml;
  if (s.transfers.length === 0) {
    transfersHtml = emptyState("circle-check", "All settled up", "No transfers are needed for this month.");
  } else {
    transfersHtml = '<div class="space-y-2">' + s.transfers.map(function (t) {
      return (
        '<div class="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">' +
          '<div class="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">' +
            '<span class="truncate">' + esc(t.from) + "</span>" + icon("arrow-right", "h-4 w-4 shrink-0 text-muted") + '<span class="truncate">' + esc(t.to) + "</span>" +
          "</div>" +
          '<span class="shrink-0 font-semibold tabular-nums text-navy-900">' + formatCurrency(t.amount) + "</span>" +
        "</div>"
      );
    }).join("") + "</div>";
  }

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">Settlement' + (finalized ? " " + badge("Finalized", "navy") : "") + '</h1><p class="mt-1 text-sm text-muted">Who paid what, who ate how much, and who owes whom — for ' + esc(monthLabel(monthKey)) + ".</p></div>" +
        monthSwitcherHtml(monthKey, "hisab-month-nav") +
      "</div>" +

      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">' +
        statCard({ label: "Total Bazar Cost", value: s.totalBazarCost, prefix: "৳", icon: "shopping-basket", tone: "danger" }) +
        statCard({ label: "Total Paid", value: s.totalPaid, prefix: "৳", icon: "wallet", tone: "success" }) +
        statCard({ label: "Total Meals", value: s.totalMeals, icon: "utensils-crossed", tone: "gray" }) +
        statCard({ label: "Meal Rate", value: s.mealRate, decimals: 2, prefix: "৳", suffix: " / meal", icon: "gauge", tone: "warning" }) +
        statCard({ label: "Total Members", value: s.memberCount, icon: "users", tone: "navy" }) +
      "</div>" +

      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Member Settlement</h2></div>' +
        (s.members.length === 0 ? '<div class="p-6">' + emptyState("users", "No active members", "Add active members to calculate a settlement.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Member</th><th class="px-5 py-3 text-right">Total Paid</th><th class="px-5 py-3 text-right">Total Meals</th><th class="px-5 py-3 text-right">Meal Rate</th><th class="px-5 py-3 text-right">Meal Cost</th><th class="px-5 py-3 text-right">Balance</th><th class="px-5 py-3">Status</th>' +
        "</tr></thead><tbody>" + memberRowsHtml + "</tbody></table></div>") +
      "</div>" +

      (s.totalBazarCost > 0 ?
      '<div class="animate-slide-up rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">' +
        '<h2 class="mb-4 text-sm font-semibold text-foreground">Meal Cost Share by Member</h2>' +
        donutChartHtml({
          centerValue: formatCurrency(s.totalBazarCost),
          centerLabel: "Total Bazar Cost",
          emptyText: "No meal cost recorded yet.",
          slices: s.members.map(function (r) { return { label: r.name, value: r.mealCost }; }),
        }) +
      "</div>" : "") +

      '<div class="animate-slide-up rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">' +
        '<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">' +
          '<h2 class="text-sm font-semibold text-foreground">Final Settlement Summary</h2>' +
          '<div class="flex items-center gap-2">' +
            (finalized ? '<span class="text-xs text-muted">Finalized ' + dateLabelMed(finalized.finalizedAt.slice(0, 10)) + "</span>" : "") +
            '<button data-action="open-close-month" data-month="' + monthKey + '" class="btn-primary btn-sm">' + icon("shield-check", "h-3.5 w-3.5") + (finalized ? "Re-close Month" : "Close Month") + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="mb-5 grid grid-cols-3 gap-3">' +
          '<div class="rounded-xl border border-border px-4 py-3"><p class="text-xs text-muted">Total Bazar Cost</p><p class="mt-1 text-base font-semibold tabular-nums text-danger-600">' + formatCurrency(s.totalBazarCost) + "</p></div>" +
          '<div class="rounded-xl border border-border px-4 py-3"><p class="text-xs text-muted">Total Meals</p><p class="mt-1 text-base font-semibold tabular-nums text-foreground">' + formatNumber(s.totalMeals) + "</p></div>" +
          '<div class="rounded-xl border border-border px-4 py-3"><p class="text-xs text-muted">Meal Rate</p><p class="mt-1 text-base font-semibold tabular-nums text-warning-700">' + formatCurrency(s.mealRate) + " / meal</p></div>" +
        "</div>" +
        '<h3 class="mb-3 text-sm font-semibold text-foreground">Who Needs to Pay Whom?</h3>' +
        transfersHtml +
      "</div>" +
    "</div>" +
    closeMonthConfirmModal(monthKey, finalized)
  );
}

/* Renders one member's Paid / Carry Forward choice row in the Close Month
   modal -- a radio pair pre-selected to whatever was decided the last time
   this month was closed (defaulting to "Paid" for a fresh close), matching
   the Store Close Month modal's "type in what's actually left, submit
   reads the DOM" pattern instead of tracking separate JS state. Only shown
   for members with a positive balance this month (they paid more than
   their meal cost) -- someone who owes money is handled by the transfers
   list above, not by this carry-forward decision. */
function closeMonthMemberChoiceRowHtml(r, previousChoice) {
  var choice = previousChoice || "paid";
  function radioOption(value, label) {
    var inputId = "money-close-" + r.memberId + "-" + value;
    return (
      '<label for="' + inputId + '" class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors has-[:checked]:border-navy-900 has-[:checked]:bg-navy-900 has-[:checked]:text-white">' +
        '<input id="' + inputId + '" type="radio" name="money-close-choice-' + r.memberId + '" value="' + value + '" data-action="close-money-choice-input" data-member="' + r.memberId + '"' + (choice === value ? " checked" : "") + ' class="hidden" />' +
        esc(label) +
      "</label>"
    );
  }
  return (
    '<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">' +
      '<div class="min-w-0">' +
        '<p class="truncate text-sm font-medium text-foreground">' + esc(r.name) + "</p>" +
        '<p class="text-xs text-muted">Balance: +' + formatCurrency(r.balance) + "</p>" +
      "</div>" +
      '<div class="flex shrink-0 gap-1.5">' + radioOption("paid", "Paid") + radioOption("carry", "Carry Forward") + "</div>" +
    "</div>"
  );
}

function closeMonthConfirmModal(monthKey, finalized) {
  var moneyClosed = findMoneyClosedMonth(monthKey);
  var previousChoiceByMember = {};
  if (moneyClosed) moneyClosed.decisions.forEach(function (d) { previousChoiceByMember[d.memberId] = d.choice; });
  var s = computeHisabSummary(monthKey);
  var membersWithBalance = s.members.filter(function (r) { return r.balance > 0.01; });
  var nextMonthLabel = esc(monthLabel(shiftMonthKey(monthKey, 1)));

  var balanceChoiceHtml =
    '<h3 class="mb-2 mt-5 text-sm font-semibold text-foreground">Leftover Balances</h3>' +
    '<p class="mb-3 text-sm text-muted">These members paid more than their meal cost this month. Choose whether each leftover amount is <span class="font-semibold text-foreground">Paid</span> (settled, nothing carries) or <span class="font-semibold text-foreground">Carried Forward</span> (auto-added as a deposit in ' + nextMonthLabel + ").</p>" +
    (membersWithBalance.length === 0 ?
      '<p class="text-sm text-muted">No one has a leftover balance this month -- nothing to decide.</p>' :
      '<div class="max-h-[16rem] space-y-2 overflow-y-auto">' + membersWithBalance.map(function (r) { return closeMonthMemberChoiceRowHtml(r, previousChoiceByMember[r.memberId]); }).join("") + "</div>");

  var body = finalized ?
    ('<p class="text-sm text-muted">' + esc(monthLabel(monthKey)) + " was already finalized on " + dateLabelMed(finalized.finalizedAt.slice(0, 10)) + '. Finalizing again will overwrite the preserved snapshot with the current numbers.</p>' +
      balanceChoiceHtml +
      '<div class="mt-5 flex justify-end gap-2">' +
        '<button type="button" data-action="close-modal" data-modal="close-month-modal" class="btn-secondary">Cancel</button>' +
        '<button type="button" data-action="confirm-close-month" data-month="' + monthKey + '" class="btn-primary">Re-finalize</button>' +
      "</div>") :
    ('<p class="text-sm text-muted">This will snapshot the ' + esc(monthLabel(monthKey)) + " settlement — bazar cost, meals, meal rate, per-member balances and suggested transfers — so the numbers stay preserved even if data changes later.</p>" +
      balanceChoiceHtml +
      '<div class="mt-5 flex justify-end gap-2">' +
        '<button type="button" data-action="close-modal" data-modal="close-month-modal" class="btn-secondary">Cancel</button>' +
        '<button type="button" data-action="confirm-close-month" data-month="' + monthKey + '" class="btn-primary">Close Month</button>' +
      "</div>");
  return modalWrapper("close-month-modal", finalized ? "Re-finalize Settlement" : "Close Month / Finalize Settlement", body);
}

/* ============================== SUMMARY REPORT ============================== */
/* Scoped-to-month available balance, mirroring computeAllTimeSummary()'s
   deposits-minus-expenses pattern exactly but filtered to the month instead
   of all time. No new calculation logic — same calcAvailableBalance() helper. */
function computeMonthAvailableBalance(monthKey) {
  var monthDeposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); });
  var monthExpenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); });
  var totalMoneyAdded = monthDeposits.reduce(function (s, d) { return s + d.amount; }, 0);
  var totalMealExpense = monthExpenses.reduce(function (s, e) { return s + e.amount; }, 0);
  return calcAvailableBalance(totalMoneyAdded, totalMealExpense);
}

/* Per-member day-by-day meal breakdown for a month — same iteration rule
   (eachDateInMonth × mealFor, capped at latestDateAcross()) already used by
   computeMonthSummary()/computeHisabSummary()/renderMeals()'s monthly table. */
function computeMemberDailyMeals(memberId, monthKey) {
  var today = latestDateAcross();
  var dates = eachDateInMonth(monthKey).filter(function (d) { return d <= today; });
  return dates.map(function (d) {
    var meal = mealFor(memberId, d);
    var total = (meal.breakfast ? 1 : 0) + (meal.lunch ? 1 : 0) + (meal.dinner ? 1 : 0);
    return { date: d, breakfast: meal.breakfast, lunch: meal.lunch, dinner: meal.dinner, total: total };
  });
}

/* Left-accent stat card for the Summary report — small-caps label, big
   number, colored left border bar, and a "View Details" link that jumps to
   the matching section id on the same page (works on screen and in the
   exported PDF/print, since it's a plain in-page anchor, not JS-driven). */
function summaryAccentCard(opts) {
  var value = opts.decimals ? formatNumber(opts.value, opts.decimals) : formatNumber(Math.round(opts.value * 100) / 100);
  return (
    '<div class="summary-accent-card summary-accent-card--' + opts.tone + ' rounded-xl border border-border bg-surface p-4">' +
      '<p class="text-xs font-semibold uppercase tracking-wide text-muted">' + esc(opts.label) + "</p>" +
      '<p class="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">' + (opts.prefix || "") + value + (opts.suffix || "") + "</p>" +
      (opts.targetId ? '<a href="#' + opts.targetId + '" class="summary-jump-link mt-1 inline-block text-xs no-print">View Details &rsaquo;</a>' : "") +
    "</div>"
  );
}

/* ============================== NATIVE PDF EXPORT (SUMMARY REPORT) ============================== */
/* Builds the Summary report PDF natively with jsPDF's own vector primitives
   (pdf.text / pdf.rect / pdf.line / pdf.link) instead of rasterizing the
   on-screen HTML through html2canvas. This keeps text sharp at any zoom
   level and — the main reason for the rewrite — lets every "View Details" /
   "Details" / "< Back to Summary" link be a REAL clickable in-PDF link
   (pdf.link() targeting a page number), which is impossible on a screenshot
   image. Reuses the exact same computed data as the on-screen renderSummary()
   (computeHisabSummary / computeMonthAvailableBalance / computeMemberDailyMeals
   / expenseItemsSummary / statusBadgeForBalance's status logic) — no new
   calculation logic lives here, only layout + drawing.

   Two passes, because pdf.link() needs a target page NUMBER and page 1's
   cards are drawn before later sections exist:
     1) buildPdfLayoutPlan() — pure JS, no jsPDF calls. Walks the same data
        renderSummary() uses and, using fixed row heights + the page's usable
        height, figures out how many rows fit per page for the member table,
        each member's daily-meal table, the expense table and the deposit
        table — and therefore which physical page number every section (and
        every member's detail block) starts on.
     2) drawPdfFromLayoutPlan() — walks the plan and actually calls
        pdf.addPage()/text()/rect()/line()/link() to render every page, using
        the page numbers computed in pass 1 for every link target. */

var PDF_MARGIN = 40;
var PDF_ROW_H = 18;
var PDF_HEADER_H = 22;
/* First-data-row Y offsets (from PDF_MARGIN) for each page shape the
   drawing pass produces below — shared by the layout pass so the two never
   drift apart. Traced exactly from the drawing pass's own sequence of
   backLink() (+36) -> sectionHeading(+4 gap, +18 own height = +58 total)
   -> [+24 month-label line + gap, member-detail pages only] -> table header
   row (+PDF_HEADER_H). Continuation pages (mid-table, after pdf.addPage())
   skip the back-link/heading and start at PDF_MARGIN+40 before the repeated
   table header row. */
var PDF_SECTION_HEADING_BOTTOM = 36 + 4 + 18; // = 58: y right after backLink()+sectionHeading()
var PDF_FIRST_ROW_Y_STANDARD = PDF_SECTION_HEADING_BOTTOM + PDF_HEADER_H; // member table / expense / deposit first pages
var PDF_FIRST_ROW_Y_MEMBER_DETAIL = PDF_SECTION_HEADING_BOTTOM + 24 + PDF_HEADER_H; // member detail pages (extra month-label line)
var PDF_CONT_HEADER_TOP = 40; // continuation pages start right after pageHeader(), no section heading
var PDF_CONT_FIRST_ROW_Y = PDF_CONT_HEADER_TOP + PDF_HEADER_H;

/* jsPDF's built-in "helvetica" font only has WinAnsi/Latin-1 glyphs, so the
   on-screen ৳ (Bengali/Bangla U+09F3 Taka sign) formatCurrency() uses would
   render as a broken "missing glyph" box in the PDF (embedding a whole
   custom font just for one currency symbol would be a lot of complexity/
   file size for a "keep it simple" report). PDF text uses this plain-ASCII
   "Tk " prefix instead — same numeric formatting as formatCurrency(), just
   a renderable prefix — everywhere a currency amount is drawn into the PDF.
   The on-screen report is completely unaffected; only PDF drawing calls use
   this. */
function pdfCurrency(n) {
  return formatCurrency(n).replace("৳", "Tk ");
}
function pdfStatusLabel(balance) {
  if (balance > 0.01) return "Will Receive " + pdfCurrency(balance);
  if (balance < -0.01) return "Needs to Pay " + pdfCurrency(Math.abs(balance));
  return "Settled";
}

/* Pass 1: pure layout math, no PDF calls. Returns everything the drawing
   pass needs, including the page number each section/member-detail block
   starts on. Page numbers are 1-based and assume the drawing pass emits
   pages in exactly the same order this function walks sections. */
function buildPdfLayoutPlan(monthKey, pageHeight) {
  var usableBottom = pageHeight - PDF_MARGIN;
  var s = computeHisabSummary(monthKey);
  var availableBalance = computeMonthAvailableBalance(monthKey);
  var monthExpenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var monthDeposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  /* Running page counter — page 1 is the executive summary and is always
     emitted first by the drawing pass. */
  var page = 1;

  /* --- Member Breakdown table (starts on page 2) --- */
  page += 1;
  var memberSectionPage = page;
  var memberTableStartY = PDF_MARGIN + PDF_FIRST_ROW_Y_STANDARD;
  var rowsLeftOnPage = Math.floor((usableBottom - memberTableStartY) / PDF_ROW_H);
  if (rowsLeftOnPage < 1) rowsLeftOnPage = 1;
  var memberRowsRemaining = s.members.length;
  var pagesForMemberTable = memberRowsRemaining === 0 ? 1 : Math.max(1, Math.ceil(memberRowsRemaining / rowsLeftOnPage));
  /* Continuation pages (after the first) start right below the repeated
     header, no section heading above it. */
  var contRowsPerPage = Math.floor((usableBottom - (PDF_MARGIN + PDF_CONT_FIRST_ROW_Y)) / PDF_ROW_H);
  if (contRowsPerPage < 1) contRowsPerPage = 1;
  if (memberRowsRemaining > rowsLeftOnPage) {
    pagesForMemberTable = 1 + Math.ceil((memberRowsRemaining - rowsLeftOnPage) / contRowsPerPage);
  }
  page = memberSectionPage + pagesForMemberTable - 1;

  /* --- Per-member daily-meal detail blocks, one after another, each may
     span multiple pages of its own. Each block starts on a fresh page for
     simplicity/robustness (keeps the link-target math trivial and avoids a
     detail table awkwardly sharing a page with the tail of another). --- */
  var memberDetailPages = {}; // memberId -> first page number of its detail block
  var memberDetailRowInfo = {}; // memberId -> { rowsPerFirstPage, rowsPerContPage, totalRows }
  s.members.forEach(function (r) {
    page += 1;
    memberDetailPages[r.memberId] = page;
    var daily = computeMemberDailyMeals(r.memberId, monthKey);
    var firstPageStartY = PDF_MARGIN + PDF_FIRST_ROW_Y_MEMBER_DETAIL;
    var rowsPerFirstPage = Math.max(1, Math.floor((usableBottom - firstPageStartY) / PDF_ROW_H));
    var contStartY = PDF_MARGIN + PDF_CONT_FIRST_ROW_Y;
    var rowsPerContPage = Math.max(1, Math.floor((usableBottom - contStartY) / PDF_ROW_H));
    var totalRows = daily.length;
    var extraPages = 0;
    if (totalRows > rowsPerFirstPage) {
      extraPages = Math.ceil((totalRows - rowsPerFirstPage) / rowsPerContPage);
    }
    memberDetailRowInfo[r.memberId] = { rowsPerFirstPage: rowsPerFirstPage, rowsPerContPage: rowsPerContPage, totalRows: totalRows, extraPages: extraPages };
    page += extraPages;
  });

  /* --- Full Expense List --- */
  page += 1;
  var expenseSectionPage = page;
  var expenseFirstPageStartY = PDF_MARGIN + PDF_FIRST_ROW_Y_STANDARD;
  var expenseRowsPerFirstPage = Math.max(1, Math.floor((usableBottom - expenseFirstPageStartY) / PDF_ROW_H));
  var expenseContStartY = PDF_MARGIN + PDF_CONT_FIRST_ROW_Y;
  var expenseRowsPerContPage = Math.max(1, Math.floor((usableBottom - expenseContStartY) / PDF_ROW_H));
  var expenseTotalRows = monthExpenses.length + 1; // +1 for the Total row
  var expenseExtraPages = 0;
  if (monthExpenses.length > 0 && expenseTotalRows > expenseRowsPerFirstPage) {
    expenseExtraPages = Math.ceil((expenseTotalRows - expenseRowsPerFirstPage) / expenseRowsPerContPage);
  }
  page = expenseSectionPage + expenseExtraPages;

  /* --- Full Deposit List --- */
  page += 1;
  var depositSectionPage = page;
  var depositFirstPageStartY = PDF_MARGIN + PDF_FIRST_ROW_Y_STANDARD;
  var depositRowsPerFirstPage = Math.max(1, Math.floor((usableBottom - depositFirstPageStartY) / PDF_ROW_H));
  var depositContStartY = PDF_MARGIN + PDF_CONT_FIRST_ROW_Y;
  var depositRowsPerContPage = Math.max(1, Math.floor((usableBottom - depositContStartY) / PDF_ROW_H));
  var depositTotalRows = monthDeposits.length + 1;
  var depositExtraPages = 0;
  if (monthDeposits.length > 0 && depositTotalRows > depositRowsPerFirstPage) {
    depositExtraPages = Math.ceil((depositTotalRows - depositRowsPerFirstPage) / depositRowsPerContPage);
  }
  page = depositSectionPage + depositExtraPages;

  return {
    monthKey: monthKey,
    summary: s,
    availableBalance: availableBalance,
    monthExpenses: monthExpenses,
    monthDeposits: monthDeposits,
    totalPages: page,
    memberSectionPage: memberSectionPage,
    rowsLeftOnFirstMemberPage: rowsLeftOnPage,
    rowsPerMemberContPage: contRowsPerPage,
    memberDetailPages: memberDetailPages,
    memberDetailRowInfo: memberDetailRowInfo,
    expenseSectionPage: expenseSectionPage,
    expenseRowsPerFirstPage: expenseRowsPerFirstPage,
    expenseRowsPerContPage: expenseRowsPerContPage,
    depositSectionPage: depositSectionPage,
    depositRowsPerFirstPage: depositRowsPerFirstPage,
    depositRowsPerContPage: depositRowsPerContPage,
  };
}

/* Pass 2: walks the layout plan and actually draws every page. Kept as a
   handful of small helpers (closed over `pdf`, `pageWidth`, `pageHeight`)
   rather than one giant function, mirroring how the rest of this file
   factors big renders into small composable pieces. */
function drawPdfFromLayoutPlan(pdf, plan) {
  var pageWidth = pdf.internal.pageSize.getWidth();
  var pageHeight = pdf.internal.pageSize.getHeight();
  var contentWidth = pageWidth - PDF_MARGIN * 2;
  var usableBottom = pageHeight - PDF_MARGIN;

  var TONE_COLORS = {
    danger: [220, 38, 38],
    success: [22, 163, 74],
    gray: [107, 114, 128],
    warning: [217, 119, 6],
    navy: [11, 31, 75],
  };

  function setGray(shade) { pdf.setDrawColor(shade, shade, shade); }

  function pageHeader(title) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(title, PDF_MARGIN, 24);
    pdf.text("Page " + pdf.internal.getNumberOfPages(), pageWidth - PDF_MARGIN, 24, { align: "right" });
    setGray(210);
    pdf.setLineWidth(0.75);
    pdf.line(PDF_MARGIN, 30, pageWidth - PDF_MARGIN, 30);
    pdf.setTextColor(0, 0, 0);
  }

  function backLink(targetPage) {
    var y = PDF_MARGIN + 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(11, 31, 75);
    var label = "< Back to Summary";
    pdf.text(label, PDF_MARGIN, y + 20);
    var w = pdf.getTextWidth(label);
    pdf.link(PDF_MARGIN, y + 20 - 9, w, 12, { pageNumber: targetPage });
    pdf.setTextColor(0, 0, 0);
    return y + 30; // next available y
  }

  function sectionHeading(text, y) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(11, 31, 75);
    pdf.text(text, PDF_MARGIN, y);
    pdf.setTextColor(0, 0, 0);
    return y + 18;
  }

  /* Generic paginated table drawer. columns: [{label, width, align}].
     rows: array of arrays of string cell values, already formatted.
     startY: y of the first header row on the CURRENT page (already added).
     Handles overflow onto new pages, repeating the header each time.
     totalRowRenderer (optional) draws a bold "Total" row after all data
     rows on whichever page the last data row landed on. */
  function drawTable(opts) {
    var columns = opts.columns;
    var rows = opts.rows;
    var y = opts.startY;
    var pageTitle = opts.pageTitle;
    var totalRow = opts.totalRow || null;
    var emptyText = opts.emptyText;

    function drawHeaderRow(yy) {
      pdf.setFillColor(243, 244, 246);
      pdf.rect(PDF_MARGIN, yy - 13, contentWidth, PDF_HEADER_H, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(90, 90, 90);
      var x = PDF_MARGIN + 6;
      columns.forEach(function (col) {
        var tx = col.align === "right" ? x + col.width - 6 : x;
        pdf.text(col.label, tx, yy, { align: col.align === "right" ? "right" : "left" });
        x += col.width;
      });
      pdf.setTextColor(0, 0, 0);
      setGray(220);
      pdf.setLineWidth(0.5);
      pdf.line(PDF_MARGIN, yy + 5, PDF_MARGIN + contentWidth, yy + 5);
      return yy + PDF_HEADER_H;
    }

    y = drawHeaderRow(y);

    if (rows.length === 0) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(140, 140, 140);
      pdf.text(emptyText || "No data", PDF_MARGIN + contentWidth / 2, y + 20, { align: "center" });
      pdf.setTextColor(0, 0, 0);
      return y + 36;
    }

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    rows.forEach(function (row) {
      if (y + PDF_ROW_H > usableBottom) {
        pdf.addPage();
        pageHeader(pageTitle);
        y = PDF_MARGIN + PDF_CONT_HEADER_TOP;
        y = drawHeaderRow(y);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
      }
      var x = PDF_MARGIN + 6;
      row.forEach(function (cell, i) {
        var col = columns[i];
        var tx = col.align === "right" ? x + col.width - 6 : x;
        pdf.text(String(cell), tx, y, { align: col.align === "right" ? "right" : "left" });
        x += col.width;
      });
      setGray(235);
      pdf.setLineWidth(0.4);
      pdf.line(PDF_MARGIN, y + 6, PDF_MARGIN + contentWidth, y + 6);
      y += PDF_ROW_H;
    });

    if (totalRow) {
      if (y + PDF_ROW_H > usableBottom) {
        pdf.addPage();
        pageHeader(pageTitle);
        y = PDF_MARGIN + PDF_CONT_HEADER_TOP;
        y = drawHeaderRow(y);
      }
      pdf.setFillColor(238, 241, 250);
      pdf.rect(PDF_MARGIN, y - 12, contentWidth, PDF_ROW_H + 2, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9.5);
      pdf.setTextColor(11, 31, 75);
      var x2 = PDF_MARGIN + 6;
      totalRow.forEach(function (cell, i) {
        var col = columns[i];
        var tx = col.align === "right" ? x2 + col.width - 6 : x2;
        if (cell !== null) pdf.text(String(cell), tx, y, { align: col.align === "right" ? "right" : "left" });
        x2 += col.width;
      });
      pdf.setTextColor(0, 0, 0);
      y += PDF_ROW_H;
    }

    return y;
  }

  var s = plan.summary;
  var monthKey = plan.monthKey;

  /* ---------- PAGE 1: Executive Summary ---------- */
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(11, 31, 75);
  pdf.text("Monthly Summary Report", PDF_MARGIN, 60);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(60, 60, 60);
  pdf.text(monthLabel(monthKey), PDF_MARGIN, 80);
  pdf.setFontSize(9);
  pdf.setTextColor(130, 130, 130);
  var generatedAt = new Date();
  var generatedAtLabel = generatedAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
    " at " + generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  pdf.text("Report generated on: " + generatedAtLabel, PDF_MARGIN, 96);
  pdf.setTextColor(0, 0, 0);
  setGray(220);
  pdf.setLineWidth(0.75);
  pdf.line(PDF_MARGIN, 108, pageWidth - PDF_MARGIN, 108);

  var cards = [
    { label: "Total Bazar/Meal Cost", value: pdfCurrency(s.totalBazarCost), tone: "danger", targetPage: plan.expenseSectionPage },
    { label: "Total Money Deposited", value: pdfCurrency(s.totalPaid), tone: "success", targetPage: plan.depositSectionPage },
    { label: "Total Meals", value: formatNumber(s.totalMeals), tone: "gray", targetPage: plan.memberSectionPage },
    { label: "Meal Rate", value: pdfCurrency(s.mealRate) + " / meal", tone: "warning", targetPage: plan.memberSectionPage },
    { label: "Available Balance", value: (plan.availableBalance < 0 ? "-" : "") + pdfCurrency(Math.abs(plan.availableBalance)), tone: plan.availableBalance < 0 ? "danger" : "navy", targetPage: plan.memberSectionPage },
  ];

  var cardGap = 14;
  var cardW = (contentWidth - cardGap * 2) / 3;
  var cardH = 62;
  var cardTop = 130;
  cards.forEach(function (card, i) {
    var col = i % 3;
    var rowIdx = Math.floor(i / 3);
    var cx = PDF_MARGIN + col * (cardW + cardGap);
    var cy = cardTop + rowIdx * (cardH + cardGap);
    var color = TONE_COLORS[card.tone] || TONE_COLORS.gray;

    // card border
    setGray(225);
    pdf.setLineWidth(0.75);
    pdf.rect(cx, cy, cardW, cardH);
    // left accent strip
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.rect(cx, cy, 3, cardH, "F");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(card.label.toUpperCase(), cx + 12, cy + 16, { maxWidth: cardW - 20 });

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14.5);
    pdf.setTextColor(20, 20, 20);
    pdf.text(card.value, cx + 12, cy + 36, { maxWidth: cardW - 20 });

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(11, 31, 75);
    pdf.text("View Details >", cx + 12, cy + 50);
    pdf.setTextColor(0, 0, 0);

    // whole card is clickable, not just the label
    pdf.link(cx, cy, cardW, cardH, { pageNumber: card.targetPage });
  });

  /* ---------- Member Breakdown ---------- */
  pdf.addPage();
  pageHeader("MealMate — Monthly Summary Report");
  var my = backLink(1);
  my = sectionHeading("2. Member Breakdown — " + monthLabel(monthKey), my + 4);

  var memberColumns = [
    { label: "NAME", width: contentWidth * 0.18, align: "left" },
    { label: "TOTAL PAID", width: contentWidth * 0.12, align: "right" },
    { label: "MEALS", width: contentWidth * 0.08, align: "right" },
    { label: "MEAL COST", width: contentWidth * 0.12, align: "right" },
    { label: "BALANCE", width: contentWidth * 0.13, align: "right" },
    { label: "STATUS", width: contentWidth * 0.30, align: "left" },
    { label: "DETAILS", width: contentWidth * 0.07, align: "left" },
  ];
  var memberRowsData = s.members.map(function (r) {
    return [r.name, pdfCurrency(r.paid), formatNumber(r.meals), pdfCurrency(r.mealCost),
      (r.balance > 0 ? "+" : r.balance < 0 ? "-" : "") + pdfCurrency(Math.abs(r.balance)),
      pdfStatusLabel(r.balance), "View >"];
  });

  /* Draw manually (not via drawTable's generic loop) so each row's "Details"
     cell can carry its own pdf.link() to that member's detail block — the
     generic drawTable helper only draws text, it doesn't know about links. */
  var pageTitle = "MealMate — Monthly Summary Report";
  function drawMemberHeaderRow(yy) {
    pdf.setFillColor(243, 244, 246);
    pdf.rect(PDF_MARGIN, yy - 13, contentWidth, PDF_HEADER_H, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(90, 90, 90);
    var x = PDF_MARGIN + 6;
    memberColumns.forEach(function (col) {
      var tx = col.align === "right" ? x + col.width - 6 : x;
      pdf.text(col.label, tx, yy, { align: col.align === "right" ? "right" : "left" });
      x += col.width;
    });
    pdf.setTextColor(0, 0, 0);
    setGray(220);
    pdf.setLineWidth(0.5);
    pdf.line(PDF_MARGIN, yy + 5, PDF_MARGIN + contentWidth, yy + 5);
    return yy + PDF_HEADER_H;
  }

  my = drawMemberHeaderRow(my);

  if (s.members.length === 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(140, 140, 140);
    pdf.text("No active members", PDF_MARGIN + contentWidth / 2, my + 20, { align: "center" });
    pdf.setTextColor(0, 0, 0);
  } else {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    s.members.forEach(function (r, idx) {
      if (my + PDF_ROW_H > usableBottom) {
        pdf.addPage();
        pageHeader(pageTitle);
        my = PDF_MARGIN + PDF_CONT_HEADER_TOP;
        my = drawMemberHeaderRow(my);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
      }
      var row = memberRowsData[idx];
      var x = PDF_MARGIN + 6;
      row.forEach(function (cell, i) {
        var col = memberColumns[i];
        var tx = col.align === "right" ? x + col.width - 6 : x;
        var isDetailsCell = i === row.length - 1;
        var isStatusCell = i === row.length - 2;
        if (isDetailsCell) pdf.setTextColor(11, 31, 75); else pdf.setTextColor(0, 0, 0);
        /* Status text ("Will Receive Tk 12,345.67") is the longest value
           in this table by far, so it gets a slightly smaller size to fit
           its column comfortably rather than risk colliding with the
           Details column next to it (jsPDF does not clip/ellipsize
           overflowing text on its own, and a maxWidth option would instead
           silently word-wrap to a second line, which would then collide
           with the row below — smaller text + a generously-sized column
           is the simpler, safer fix here). */
        if (isStatusCell) pdf.setFontSize(8.5);
        pdf.text(String(cell), tx, my, { align: col.align === "right" ? "right" : "left" });
        if (isStatusCell) pdf.setFontSize(9.5);
        if (isDetailsCell) {
          pdf.link(x - 6, my - 10, col.width, 14, { pageNumber: plan.memberDetailPages[r.memberId] });
        }
        x += col.width;
      });
      pdf.setTextColor(0, 0, 0);
      setGray(235);
      pdf.setLineWidth(0.4);
      pdf.line(PDF_MARGIN, my + 6, PDF_MARGIN + contentWidth, my + 6);
      my += PDF_ROW_H;
    });
  }

  /* ---------- Per-member daily meal detail blocks ---------- */
  s.members.forEach(function (r) {
    pdf.addPage();
    pageHeader(pageTitle);
    var dy = backLink(1);
    dy = sectionHeading(r.name + " — Day-by-Day Meal Breakdown", dy + 4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 90, 90);
    pdf.text(monthLabel(monthKey), PDF_MARGIN, dy + 2);
    pdf.setTextColor(0, 0, 0);
    dy += 24;

    var daily = computeMemberDailyMeals(r.memberId, monthKey);
    var dailyColumns = [
      { label: "DATE", width: contentWidth * 0.30, align: "left" },
      { label: "BREAKFAST", width: contentWidth * 0.20, align: "left" },
      { label: "LUNCH", width: contentWidth * 0.18, align: "left" },
      { label: "DINNER", width: contentWidth * 0.17, align: "left" },
      { label: "TOTAL", width: contentWidth * 0.15, align: "right" },
    ];
    var dailyRows = daily.map(function (d) {
      return [dateLabelMed(d.date), d.breakfast ? "Yes" : "—", d.lunch ? "Yes" : "—", d.dinner ? "Yes" : "—", String(d.total)];
    });
    drawTable({ columns: dailyColumns, rows: dailyRows, startY: dy, pageTitle: pageTitle, emptyText: "No days recorded yet" });
  });

  /* ---------- Full Expense List ---------- */
  pdf.addPage();
  pageHeader(pageTitle);
  var ey = backLink(1);
  ey = sectionHeading("3. Full Expense List — " + monthLabel(monthKey), ey + 4);
  var expenseColumns = [
    { label: "DATE", width: contentWidth * 0.16, align: "left" },
    { label: "ITEMS", width: contentWidth * 0.42, align: "left" },
    { label: "BOUGHT BY", width: contentWidth * 0.22, align: "left" },
    { label: "AMOUNT", width: contentWidth * 0.20, align: "right" },
  ];
  var expenseRows = plan.monthExpenses.map(function (e) {
    var names = (e.buyerIds || []).map(function (id) { var m = memberById(id); return m ? m.name : null; }).filter(Boolean);
    var itemsText = expenseItemsSummary(e);
    if (itemsText.length > 60) itemsText = itemsText.slice(0, 57) + "...";
    return [dateLabelMed(e.date), itemsText, names.length ? names.join(", ") : "Unknown", "-" + pdfCurrency(e.amount)];
  });
  drawTable({
    columns: expenseColumns,
    rows: expenseRows,
    startY: ey,
    pageTitle: pageTitle,
    emptyText: "No expenses this month",
    totalRow: plan.monthExpenses.length ? ["Total", null, null, pdfCurrency(s.totalBazarCost)] : null,
  });

  /* ---------- Full Deposit List ---------- */
  pdf.addPage();
  pageHeader(pageTitle);
  var py = backLink(1);
  py = sectionHeading("4. Full Deposit List — " + monthLabel(monthKey), py + 4);
  var depositColumns = [
    { label: "DATE", width: contentWidth * 0.18, align: "left" },
    { label: "MEMBER", width: contentWidth * 0.25, align: "left" },
    { label: "AMOUNT", width: contentWidth * 0.20, align: "right" },
    { label: "NOTE", width: contentWidth * 0.37, align: "left" },
  ];
  var depositRows = plan.monthDeposits.map(function (d) {
    var m = memberById(d.memberId);
    var note = d.note || "-";
    if (note.length > 45) note = note.slice(0, 42) + "...";
    return [dateLabelMed(d.date), m ? m.name : "Unknown", "+" + pdfCurrency(d.amount), note];
  });
  drawTable({
    columns: depositColumns,
    rows: depositRows,
    startY: py,
    pageTitle: pageTitle,
    emptyText: "No deposits this month",
    totalRow: plan.monthDeposits.length ? ["Total", null, pdfCurrency(s.totalPaid), null] : null,
  });
}

/* Builds the Summary report as a natively-drawn multi-page PDF (real vector
   text + real clickable internal links — see the big comment above) and
   triggers the browser download. Synchronous end-to-end: no DOM cloning, no
   html2canvas, no screenshotting — just reading DB state and calling jsPDF's
   own drawing API, so this no longer needs a promise chain or a setTimeout. */
/* jsPDF (~350KB) is only downloaded the first time someone exports a PDF,
   keeping the initial app load light. */
var PDF_LOADING = false;
function withPdf(fn) {
  if (window.jspdf && window.jspdf.jsPDF) { fn(); return; }
  if (PDF_LOADING) return;
  PDF_LOADING = true;
  toast("Preparing PDF...", "default");
  CTX.loadPdf().then(function (jsPDF) {
    window.jspdf = { jsPDF: jsPDF };
    fn();
  }).catch(function () {
    toast("PDF export isn't available right now — please check your connection.", "error");
  }).then(function () { PDF_LOADING = false; });
}

function downloadSummaryPdf(monthKey) {
  if (!window.jspdf) {
    toast("PDF export isn't available right now — please try again.", "error");
    return;
  }

  toast("Preparing PDF...", "default");

  try {
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    var pageHeight = pdf.internal.pageSize.getHeight();
    var effectiveMonthKey = (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) ? monthKey : latestMonthKey();

    var plan = buildPdfLayoutPlan(effectiveMonthKey, pageHeight);
    drawPdfFromLayoutPlan(pdf, plan);

    var fileMonth = effectiveMonthKey.replace(/[^0-9a-zA-Z-]/g, "");
    pdf.save("MealMate-Summary-" + fileMonth + ".pdf");
    toast("PDF downloaded.", "success");
  } catch (err) {
    toast("Couldn't generate the PDF. Please try again.", "error");
  }
}

function renderSummary(monthKeyParam) {
  var monthKey = monthKeyParam && /^\d{4}-\d{2}$/.test(monthKeyParam) ? monthKeyParam : latestMonthKey();
  var s = computeHisabSummary(monthKey);
  var availableBalance = computeMonthAvailableBalance(monthKey);
  var generatedAt = new Date();
  var generatedAtLabel = generatedAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
    " at " + generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

  var monthExpenses = DB.expenses.filter(function (e) { return inMonth(e.date, monthKey); }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var monthDeposits = DB.deposits.filter(function (d) { return inMonth(d.date, monthKey); }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  function buyerNamesHtml(e) {
    var names = (e.buyerIds || []).map(function (id) { var m = memberById(id); return m ? esc(m.name) : null; }).filter(Boolean);
    return names.length ? names.join(", ") : "Unknown";
  }

  var memberRowsHtml = s.members.map(function (r) {
    var daily = computeMemberDailyMeals(r.memberId, monthKey);
    var dailyRowsHtml = daily.map(function (d) {
      return (
        '<tr class="border-b border-border last:border-0">' +
          '<td class="px-4 py-2 text-muted">' + dateLabelMed(d.date) + "</td>" +
          '<td class="px-3 py-2 text-center">' + (d.breakfast ? "Yes" : "—") + "</td>" +
          '<td class="px-3 py-2 text-center">' + (d.lunch ? "Yes" : "—") + "</td>" +
          '<td class="px-3 py-2 text-center">' + (d.dinner ? "Yes" : "—") + "</td>" +
          '<td class="px-4 py-2 text-right font-semibold tabular-nums">' + d.total + "</td>" +
        "</tr>"
      );
    }).join("");
    var detailsId = "summary-details-" + r.memberId;
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50 summary-row-avoid-break">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' +
          avatarHtml(r.pictureUrl, r.name, "h-8 w-8", r.avatarColor) +
          '<span class="font-medium text-foreground">' + esc(r.name) + "</span>" +
        "</div></td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-success-700">' + formatCurrency(r.paid) + "</td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-foreground">' + formatNumber(r.meals) + "</td>" +
        '<td class="px-5 py-3 text-right tabular-nums text-danger-600">' + formatCurrency(r.mealCost) + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums ' + (r.balance > 0.01 ? "text-success-700" : r.balance < -0.01 ? "text-danger-600" : "text-muted") + '">' + (r.balance > 0 ? "+" : r.balance < 0 ? "−" : "") + formatCurrency(Math.abs(r.balance)) + "</td>" +
        '<td class="px-5 py-3">' + statusBadgeForBalance(r.balance) + "</td>" +
        '<td class="px-5 py-3 text-right no-print">' +
          '<button type="button" data-action="toggle-summary-details" data-target="' + detailsId + '" class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:bg-navy-50">' + icon("chevron-down", "h-3.5 w-3.5") + "Details</button>" +
        "</td>" +
      "</tr>" +
      '<tr class="details-collapsed border-b border-border last:border-0" id="' + detailsId + '">' +
        '<td colspan="7" class="bg-gray-100/40 px-5 py-4">' +
          '<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">' + esc(r.name) + " — Day-by-Day Meal Breakdown (" + esc(monthLabel(monthKey)) + ")</p>" +
          (daily.length === 0 ? emptyState("utensils-crossed", "No days recorded yet") :
          '<div class="overflow-x-auto rounded-xl border border-border"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-4 py-2">Date</th><th class="px-3 py-2 text-center">Breakfast</th><th class="px-3 py-2 text-center">Lunch</th><th class="px-3 py-2 text-center">Dinner</th><th class="px-4 py-2 text-right">Total</th></tr></thead><tbody>' + dailyRowsHtml + "</tbody></table></div>") +
        "</td>" +
      "</tr>"
    );
  }).join("");

  var expenseRowsHtml = monthExpenses.map(function (e) {
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50 summary-row-avoid-break">' +
        '<td class="px-5 py-3 text-muted">' + dateLabelMed(e.date) + "</td>" +
        '<td class="px-5 py-3 font-medium text-foreground">' + esc(expenseItemsSummary(e)) + "</td>" +
        '<td class="px-5 py-3 text-foreground">' + buyerNamesHtml(e) + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">−' + formatCurrency(e.amount) + "</td>" +
      "</tr>"
    );
  }).join("");

  var depositRowsHtml = monthDeposits.map(function (d) {
    var m = memberById(d.memberId);
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50 summary-row-avoid-break">' +
        '<td class="px-5 py-3 text-muted">' + dateLabelMed(d.date) + "</td>" +
        '<td class="px-5 py-3 font-medium text-foreground">' + esc(m ? m.name : "Unknown") + "</td>" +
        '<td class="px-5 py-3 text-right font-semibold tabular-nums text-success-700">+' + formatCurrency(d.amount) + "</td>" +
        '<td class="px-5 py-3 text-muted">' + esc(d.note || "—") + "</td>" +
      "</tr>"
    );
  }).join("");

  return (
    '<div class="space-y-6 summary-report">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between no-print">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Summary</h1><p class="mt-1 text-sm text-muted">A complete printable report for ' + esc(monthLabel(monthKey)) + ".</p></div>" +
        '<div class="flex items-center gap-2">' +
          monthSwitcherHtml(monthKey, "summary-month-nav") +
          '<button type="button" data-action="print-summary" data-month="' + esc(monthKey) + '" class="btn-primary">' + icon("receipt", "h-4 w-4") + "Download PDF</button>" +
        "</div>" +
      "</div>" +

      '<div class="summary-print-header hidden">' +
        '<h1 class="text-2xl font-bold tracking-tight">Monthly Summary Report</h1>' +
        '<p class="mt-1 text-sm">' + esc(monthLabel(monthKey)) + "</p>" +
        '<p class="mt-1 text-xs">Report generated on: ' + esc(generatedAtLabel) + "</p>" +
      "</div>" +

      '<div><h2 class="summary-section-heading text-foreground">1. Executive Summary</h2>' +
        '<div class="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3 summary-cards-grid">' +
          summaryAccentCard({ label: "Total Bazar/Meal Cost", value: s.totalBazarCost, prefix: "৳", tone: "danger", targetId: "summary-expenses" }) +
          summaryAccentCard({ label: "Total Money Deposited", value: s.totalPaid, prefix: "৳", tone: "success", targetId: "summary-deposits" }) +
          summaryAccentCard({ label: "Total Meals", value: s.totalMeals, tone: "gray", targetId: "summary-members" }) +
          summaryAccentCard({ label: "Meal Rate", value: s.mealRate, decimals: 2, prefix: "৳", suffix: " / meal", tone: "warning", targetId: "summary-members" }) +
          summaryAccentCard({ label: "Available Balance", value: Math.abs(availableBalance), prefix: (availableBalance < 0 ? "−৳" : "৳"), tone: availableBalance < 0 ? "danger" : "navy", targetId: "summary-members" }) +
        "</div>" +
      "</div>" +

      '<div id="summary-members" class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] summary-section">' +
        '<div class="border-b border-border p-5"><h2 class="summary-section-heading text-foreground">2. Member Breakdown</h2></div>' +
        (s.members.length === 0 ? '<div class="p-6">' + emptyState("users", "No active members") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Name</th><th class="px-5 py-3 text-right">Total Paid</th><th class="px-5 py-3 text-right">Total Meals</th><th class="px-5 py-3 text-right">Meal Cost</th><th class="px-5 py-3 text-right">Balance</th><th class="px-5 py-3">Status</th><th class="px-5 py-3 text-right no-print">Details</th>' +
        "</tr></thead><tbody>" + memberRowsHtml + "</tbody></table></div>") +
      "</div>" +

      '<div id="summary-expenses" class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] summary-section">' +
        '<div class="border-b border-border p-5"><h2 class="summary-section-heading text-foreground">3. Full Expense List — ' + esc(monthLabel(monthKey)) + "</h2></div>" +
        (monthExpenses.length === 0 ? '<div class="p-6">' + emptyState("shopping-cart", "No expenses this month") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Date</th><th class="px-5 py-3">Items</th><th class="px-5 py-3">Bought By</th><th class="px-5 py-3 text-right">Amount</th>' +
        "</tr></thead><tbody>" + expenseRowsHtml +
        '<tr class="bg-navy-50"><td class="px-5 py-3 text-sm font-semibold text-navy-900" colspan="3">Total</td><td class="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">' + formatCurrency(s.totalBazarCost) + "</td></tr>" +
        "</tbody></table></div>") +
      "</div>" +

      '<div id="summary-deposits" class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] summary-section">' +
        '<div class="border-b border-border p-5"><h2 class="summary-section-heading text-foreground">4. Full Deposit List — ' + esc(monthLabel(monthKey)) + "</h2></div>" +
        (monthDeposits.length === 0 ? '<div class="p-6">' + emptyState("wallet", "No deposits this month") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Date</th><th class="px-5 py-3">Member</th><th class="px-5 py-3 text-right">Amount</th><th class="px-5 py-3">Note</th>' +
        "</tr></thead><tbody>" + depositRowsHtml +
        '<tr class="bg-navy-50"><td class="px-5 py-3 text-sm font-semibold text-navy-900" colspan="2">Total</td><td class="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">' + formatCurrency(s.totalPaid) + "</td><td></td></tr>" +
        "</tbody></table></div>") +
      "</div>" +
    "</div>"
  );
}

/* ============================== AVAILABLE BALANCE ============================== */
function renderBalance() {
  var all = computeAllTimeSummary();
  var moneyIn = DB.deposits.map(function (d) { return { type: "in", date: d.date, label: (memberById(d.memberId) || {}).name || "Unknown", amount: d.amount }; });
  var moneyOut = DB.expenses.map(function (e) { return { type: "out", date: e.date, label: expenseItemsSummary(e) || "Expense", amount: e.amount }; });
  var recent = moneyIn.concat(moneyOut).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 20);

  var recentHtml = recent.length === 0 ? emptyState("banknote", "No transactions yet") : recent.map(function (t) {
    var isIn = t.type === "in";
    return (
      '<div class="flex items-center gap-3 rounded-xl px-2 py-2 text-sm">' +
        '<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ' + (isIn ? "text-success-600 bg-success-100" : "text-danger-600 bg-danger-100") + '">' + icon(isIn ? "circle-arrow-up" : "circle-arrow-down", "h-4 w-4") + "</span>" +
        '<span class="flex-1 text-foreground">' + esc(t.label) + "</span>" +
        '<span class="shrink-0 font-semibold tabular-nums ' + (isIn ? "text-success-700" : "text-danger-600") + '">' + (isIn ? "+" : "−") + formatCurrency(t.amount) + "</span>" +
        '<span class="shrink-0 text-xs text-muted">' + dateLabelMed(t.date) + "</span>" +
      "</div>"
    );
  }).join("");

  return (
    '<div class="space-y-6">' +
      '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Available Balance</h1><p class="mt-1 text-sm text-muted">Total money added minus total meal expense, updated automatically.</p></div>' +
      '<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">' +
        statCard({ label: "Total Money Added", value: all.totalMoneyAdded, prefix: "৳", icon: "trending-up", tone: "success", href: "#/money" }) +
        statCard({ label: "Total Meal Expense", value: all.totalMealExpense, prefix: "৳", icon: "trending-down", tone: "danger", href: "#/expenses" }) +
        statCard({ label: "Available Balance", value: all.availableBalance, prefix: "৳", icon: "banknote", tone: "navy" }) +
      "</div>" +
      '<div class="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] animate-slide-up">' +
        '<h3 class="mb-4 text-sm font-semibold text-foreground">Balance Breakdown</h3>' +
        '<div class="space-y-3">' +
          cashRow("Money Added (Money In)", all.totalMoneyAdded, "success", "+") +
          cashRow("Meal Expense (Money Out)", all.totalMealExpense, "danger", "−") +
          cashRow("Available Balance", all.availableBalance, "navy", null, true) +
        "</div>" +
      "</div>" +
      '<div class="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] animate-slide-up">' +
        '<h3 class="mb-3 text-sm font-semibold text-foreground">Recent Transactions</h3>' +
        '<div class="space-y-1">' + recentHtml + "</div>" +
      "</div>" +
    "</div>"
  );
}

/* ============================== SETTINGS / PASSWORD ============================== */
function renderSettingsPage() {
  var name = SESSION.name || "";
  var hasLocalLegacy = !!legacyLocalData();
  return (
    '<div class="mx-auto max-w-2xl space-y-6">' +
      '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Profile &amp; Settings</h1><p class="mt-1 text-sm text-muted">Update your name, profile picture and password.</p></div>' +

      '<form data-form="profile" class="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">' +
        '<h2 class="text-sm font-semibold text-foreground">Profile</h2>' +
        pictureUploadFieldHtml("avatarUrl", "profile-picture-preview", SESSION.avatarUrl || null, name, "var(--navy-900)") +
        "<div>" + fieldLabel("Display Name") + '<input name="name" required maxlength="80" value="' + esc(name) + '" placeholder="Your name" class="' + FIELD_CLASS + '" /></div>' +
        "<div>" + fieldLabel("Email") + '<input value="' + esc(SESSION.email || "") + '" disabled class="' + FIELD_CLASS + ' cursor-not-allowed opacity-60" /></div>' +
        '<button type="submit" class="btn-primary btn-block">Save Profile</button>' +
      "</form>" +

      '<form data-form="change-password" class="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">' +
        '<h2 class="text-sm font-semibold text-foreground">Change Password</h2>' +
        "<div>" + fieldLabel("Current Password") + '<input name="current" type="password" autocomplete="current-password" required class="' + FIELD_CLASS + '" /></div>' +
        "<div>" + fieldLabel("New Password") + '<input name="next" type="password" autocomplete="new-password" required minlength="8" class="' + FIELD_CLASS + '" /></div>' +
        "<div>" + fieldLabel("Confirm New Password") + '<input name="confirm" type="password" autocomplete="new-password" required class="' + FIELD_CLASS + '" /></div>' +
        '<button type="submit" class="btn-primary btn-block">Update Password</button>' +
      "</form>" +

      (can("settings.manage") ?
      '<form data-form="rename-group" class="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">' +
        '<h2 class="text-sm font-semibold text-foreground">MealMate Name</h2>' +
        "<div>" + fieldLabel("Name") + '<input name="groupName" required minlength="2" maxlength="60" value="' + esc(CTX.groupName) + '" class="' + FIELD_CLASS + '" /></div>' +
        '<button type="submit" class="btn-primary btn-block">Save Name</button>' +
      "</form>" : "") +

      '<div class="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">' +
        '<div><h2 class="text-sm font-semibold text-foreground">Backup</h2><p class="mt-1 text-sm text-muted">Download a copy of all ' + esc(CTX.groupName) + " data" + (can("settings.manage") ? ", or import data from the old offline MealMate app." : ".") + "</p></div>" +
        (hasLocalLegacy && can("settings.manage") ?
          '<div class="rounded-xl bg-warning-100 px-4 py-3 text-sm text-warning-700"><p class="font-semibold">Old MealMate data found on this device</p><p class="mt-0.5">Import it once to move it into your shared MealMate.</p>' +
          '<button type="button" data-action="import-local-data" class="btn-primary btn-sm mt-3">' + icon("rotate-ccw", "h-4 w-4") + "Import from this device</button></div>" : "") +
        '<div class="flex flex-wrap gap-2">' +
          '<button type="button" data-action="export-backup" class="btn-secondary">' + icon("circle-arrow-down", "h-4 w-4") + "Download Backup</button>" +
          (can("settings.manage") ? '<label data-action="import-backup" class="btn-secondary cursor-pointer">' + icon("circle-arrow-up", "h-4 w-4") + 'Import Backup<input type="file" accept="application/json,.json" data-action="import-backup-input" class="hidden" /></label>' : "") +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

/* ============================== BACKUP / LEGACY IMPORT ============================== */
var LEGACY_DB_KEY = "mealmate_db_v2";
function legacyLocalData() {
  try {
    var raw = localStorage.getItem(LEGACY_DB_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) { return null; }
}
function exportBackup() {
  var copy = {};
  Object.keys(DB).forEach(function (k) { copy[k] = DB[k]; });
  var payload = JSON.stringify({ app: "MealMate", version: 3, exportedAt: new Date().toISOString(), group: CTX.groupName, data: copy }, null, 2);
  var blob = new Blob([payload], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "MealMate-backup-" + latestDateAcross() + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Backup downloaded.", "success");
}
function runImport(legacy, sourceLabel) {
  if (!legacy || typeof legacy !== "object") { toast("That file isn't a MealMate backup.", "error"); return; }
  var data = legacy.data && typeof legacy.data === "object" ? legacy.data : legacy;
  var looksRight = ["members", "meals", "deposits", "expenses"].some(function (k) { return Array.isArray(data[k]); });
  if (!looksRight) { toast("That file isn't a MealMate backup.", "error"); return; }
  if (!CTX.isFresh()) { toast("Still syncing with the server — try again in a second.", "error"); return; }
  CTX.api.importBackup(data).then(function (res) {
    toast("Imported " + res.count + " records from " + sourceLabel + ".", "success");
    if (sourceLabel === "this device") {
      try { localStorage.setItem(LEGACY_DB_KEY + "_imported", localStorage.getItem(LEGACY_DB_KEY) || ""); localStorage.removeItem(LEGACY_DB_KEY); } catch (e) {}
    }
    render();
  }).catch(function (err) { toast(CTX.friendlyError(err), "error"); });
}


/* ============================== TEAM & INVITES ============================== */
/* Login accounts (Supabase Auth users) that belong to this MealMate, their
   roles, and the group's invite code/link. This is separate from the
   "Members" page, which is the mess roster used for meals & money (a roster
   member doesn't need a login; every account gets a roster row on join). */
var TEAM = { loaded: false, loading: false, accounts: [], invite: null, requests: [], error: "" };
var PENDING_ROLE_CHANGE = null;
var PENDING_REMOVE = null;

var ROLE_META = {
  ADMIN: { label: "Admin", tone: "navy" },
  MODERATOR: { label: "Moderator", tone: "warning" },
  MEMBER: { label: "Member", tone: "gray" },
};
function roleLabel(role) { return (ROLE_META[role] || ROLE_META.MEMBER).label; }
function roleBadgeHtml(role) { return badge(roleLabel(role), (ROLE_META[role] || ROLE_META.MEMBER).tone); }

function inviteLinkFor(code) { return (CTX.inviteBaseUrl || location.origin) + "/join/" + encodeURIComponent(code || ""); }

function loadTeam() {
  if (!CTX || TEAM.loading) return;
  TEAM.loading = true;
  var wantsInvite = can("invites.manage");
  var wantsRequests = can("members.manage");
  /* Each piece loads on its own, so one failing call (e.g. a database that
     is missing a newer function) doesn't hide the invite code or the list. */
  var firstErr = null;
  function settle(p, fallback) {
    return p.then(null, function (err) { if (!firstErr) firstErr = err; return fallback; });
  }
  Promise.all([
    settle(can("members.view") ? CTX.api.listAccounts() : Promise.resolve([]), TEAM.accounts),
    settle(wantsInvite ? CTX.api.getInvite() : Promise.resolve(null), TEAM.invite),
    settle(wantsRequests ? CTX.api.listJoinRequests() : Promise.resolve([]), TEAM.requests),
  ]).then(function (res) {
    TEAM.accounts = res[0] || [];
    TEAM.invite = res[1];
    TEAM.requests = res[2] || [];
    TEAM.loaded = true;
    TEAM.error = firstErr ? CTX.friendlyError(firstErr) : "";
  }).then(function () {
    TEAM.loading = false;
    var p = parseHash().path;
    if (p === "team" || p === "dashboard") softRender();
  });
}

function copyText(text, okMessage, button) {
  function done() {
    toast(okMessage, "success");
    if (button) {
      button.classList.add("mm-copied");
      setTimeout(function () { button.classList.remove("mm-copied"); }, 1600);
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) ? done() : toast("Couldn't copy — please copy it manually.", "error"); });
  } else if (fallbackCopy(text)) done();
  else toast("Couldn't copy — please copy it manually.", "error");
}
function fallbackCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function inviteCodeChipsHtml(code) {
  return '<span class="mm-code">' + String(code || "").split("").map(function (ch, i) {
    return '<span class="mm-code-char" style="animation-delay:' + (i * 45) + 'ms">' + esc(ch) + "</span>";
  }).join("") + "</span>";
}

function dashboardInviteCardHtml() {
  if (!TEAM.loaded && !TEAM.loading) setTimeout(loadTeam, 0);
  var inv = TEAM.invite;
  return (
    '<div class="mm-invite-card stat-card-bg animate-slide-up">' +
      '<div class="mm-invite-card-glow" aria-hidden="true"></div>' +
      '<div class="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        "<div>" +
          '<p class="text-xs font-semibold uppercase tracking-wide text-white/60">Invite your mess</p>' +
          '<p class="mt-1 text-sm text-white/80">Share this code so members can join <span class="font-semibold text-white">' + esc(CTX.groupName) + "</span>.</p>" +
          '<div class="mt-3">' + (inv ? inviteCodeChipsHtml(inv.code) : '<span class="mm-skeleton mm-skeleton--dark" style="width:11rem;height:2.25rem"></span>') + "</div>" +
        "</div>" +
        '<div class="flex flex-wrap gap-2">' +
          (inv ? '<button type="button" data-action="copy-invite-code" class="mm-glass-btn">' + icon("clipboard-list", "h-4 w-4") + "<span>Copy Code</span></button>" +
          '<button type="button" data-action="copy-invite-link" class="mm-glass-btn">' + icon("arrow-right", "h-4 w-4") + "<span>Copy Link</span></button>" : "") +
          '<a href="#/team" class="mm-glass-btn mm-glass-btn--solid">' + icon("users", "h-4 w-4") + "<span>Manage Team</span></a>" +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

function formatJoined(ts) {
  if (!ts) return "—";
  var d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function teamSkeletonRows() {
  var row = '<tr class="border-b border-border last:border-0"><td class="px-5 py-4" colspan="6"><div class="flex items-center gap-3"><span class="mm-skeleton" style="width:2.25rem;height:2.25rem;border-radius:999px"></span><span class="mm-skeleton" style="width:40%;height:.8rem"></span></div></td></tr>';
  return row + row + row;
}

function renderTeam() {
  var accounts = TEAM.accounts || [];
  var counts = { ADMIN: 0, MODERATOR: 0, MEMBER: 0 };
  accounts.forEach(function (a) { counts[a.role] = (counts[a.role] || 0) + 1; });
  var canRoles = can("roles.manage");
  var canRemove = can("members.remove");
  var inv = TEAM.invite;
  var link = inv ? inviteLinkFor(inv.code) : "";

  var rows = !TEAM.loaded ? teamSkeletonRows() : accounts.map(function (a) {
    var roleCell = canRoles ?
      '<select data-action="change-role" data-user="' + esc(a.user_id) + '" data-current="' + esc(a.role) + '" class="mm-role-select" aria-label="Role for ' + esc(a.full_name) + '">' +
        ["ADMIN", "MODERATOR", "MEMBER"].map(function (r) { return '<option value="' + r + '"' + (r === a.role ? " selected" : "") + ">" + roleLabel(r) + "</option>"; }).join("") +
      "</select>" : roleBadgeHtml(a.role);
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' + avatarHtml(a.avatar_url, a.full_name || a.email, "h-9 w-9", a.role === "ADMIN" ? "var(--navy-900)" : a.role === "MODERATOR" ? "#B45309" : "#667085") +
          '<div class="min-w-0"><span class="block truncate font-medium text-foreground">' + esc(a.full_name || "—") + (a.is_me ? ' <span class="mm-you">You</span>' : "") + "</span>" +
          '<span class="block truncate text-xs text-muted sm:hidden">' + esc(a.email || "") + "</span></div>" +
        "</div></td>" +
        '<td class="hidden px-5 py-3 text-muted sm:table-cell">' + esc(a.email || "") + "</td>" +
        '<td class="px-5 py-3">' + roleCell + "</td>" +
        '<td class="px-5 py-3">' + badge(a.roster_status === "INACTIVE" ? "Inactive" : "Active", a.roster_status === "INACTIVE" ? "gray" : "success") + "</td>" +
        '<td class="hidden px-5 py-3 text-muted md:table-cell">' + formatJoined(a.joined_at) + "</td>" +
        '<td class="px-5 py-3 text-right">' +
          (canRemove && !a.is_me ? '<button data-action="remove-account" data-user="' + esc(a.user_id) + '" title="Remove from MealMate" class="rounded-lg p-2 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600">' + icon("trash", "h-4 w-4") + "</button>" : "") +
        "</td>" +
      "</tr>"
    );
  }).join("");

  var inviteSection = !can("invites.manage") ? "" : (
    '<div class="mm-invite-hero stat-card-bg animate-slide-up">' +
      '<div class="mm-invite-card-glow" aria-hidden="true"></div>' +
      '<div class="relative grid gap-6 lg:grid-cols-2 lg:items-center">' +
        "<div>" +
          '<p class="text-xs font-semibold uppercase tracking-wide text-white/60">MealMate</p>' +
          '<h2 class="mt-1 text-xl font-semibold text-white">' + esc(CTX.groupName) + "</h2>" +
          '<p class="mt-1 text-sm text-white/70">Anyone with this code or link can join as a <span class="font-semibold text-white">Member</span>. Generate a new code any time — the old one stops working instantly.</p>' +
          '<label class="mm-switch mt-4">' +
            '<input type="checkbox" data-action="toggle-invite"' + (inv && inv.enabled ? " checked" : "") + (inv ? "" : " disabled") + " />" +
            '<span class="mm-switch-track"><span class="mm-switch-thumb"></span></span>' +
            '<span class="text-sm text-white/85">' + (inv && !inv.enabled ? "Invites paused — nobody can join" : "Accepting new members") + "</span>" +
          "</label>" +
          '<label class="mm-switch mt-3">' +
            '<input type="checkbox" data-action="toggle-auto-approve"' + (inv && inv.auto_approve ? " checked" : "") + (inv ? "" : " disabled") + " />" +
            '<span class="mm-switch-track"><span class="mm-switch-thumb"></span></span>' +
            '<span class="text-sm text-white/85">' + (inv && inv.auto_approve ? "Auto-approve ON — new people join instantly" : "Auto-approve OFF — you approve each join request") + "</span>" +
          "</label>" +
        "</div>" +
        '<div class="space-y-3">' +
          '<div><p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">Invite Code</p>' +
            (inv ? inviteCodeChipsHtml(inv.code) : '<span class="mm-skeleton mm-skeleton--dark" style="width:12rem;height:2.5rem"></span>') + "</div>" +
          '<div><p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">Invite Link</p>' +
            '<div class="mm-link-box"><span class="truncate">' + (inv ? esc(link) : "…") + "</span></div></div>" +
          '<div class="flex flex-wrap gap-2 pt-1">' +
            '<button type="button" data-action="copy-invite-code" class="mm-glass-btn"' + (inv ? "" : " disabled") + ">" + icon("clipboard-list", "h-4 w-4") + "<span>Copy Invite Code</span></button>" +
            '<button type="button" data-action="copy-invite-link" class="mm-glass-btn"' + (inv ? "" : " disabled") + ">" + icon("arrow-right", "h-4 w-4") + "<span>Copy Invite Link</span></button>" +
            (typeof navigator !== "undefined" && navigator.share ? '<button type="button" data-action="share-invite" class="mm-glass-btn"' + (inv ? "" : " disabled") + ">" + icon("user-plus", "h-4 w-4") + "<span>Share</span></button>" : "") +
            '<button type="button" data-action="regenerate-invite" class="mm-glass-btn mm-glass-btn--solid"' + (inv ? "" : " disabled") + ">" + icon("rotate-ccw", "h-4 w-4") + "<span>Generate New Code</span></button>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>"
  );

  var permMatrix = [
    ["View dashboard, meals, expenses, shopping list, balance & reports", 1, 1, 1],
    ["View team members", 1, 1, 0],
    ["Add / update meals, turn meals on/off", 1, 1, 0],
    ["Add expenses", 1, 1, 0],
    ["Manage shopping list & stock", 1, 1, 0],
    ["Edit / delete expenses, manage deposits", 1, 0, 0],
    ["Monthly closing & settlements", 1, 0, 0],
    ["Invite members, change roles, remove members", 1, 0, 0],
    ["MealMate settings & roster", 1, 0, 0],
  ];
  function tick(v) { return v ? '<span class="mm-tick mm-tick--yes">' + icon("circle-check", "h-4 w-4") + "</span>" : '<span class="mm-tick mm-tick--no">—</span>'; }

  return (
    '<div class="space-y-6">' +
      '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">' +
        '<div><h1 class="text-2xl font-semibold tracking-tight text-foreground">Team &amp; Invites</h1><p class="mt-1 text-sm text-muted">Everyone who can sign in to ' + esc(CTX.groupName) + ", and what they're allowed to do.</p></div>" +
      "</div>" +
      (TEAM.error ? '<div class="rounded-xl bg-danger-100 px-4 py-3 text-sm font-medium text-danger-700">' + esc(TEAM.error) + ' <button data-action="retry-team" class="ml-2 underline">Try again</button></div>' : "") +
      inviteSection +
      joinRequestsSectionHtml() +
      '<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">' +
        statCard({ label: "Accounts", value: accounts.length, icon: "users", tone: "navy", compact: true }) +
        statCard({ label: "Admins", value: counts.ADMIN, icon: "shield-check", tone: "success", compact: true }) +
        statCard({ label: "Moderators", value: counts.MODERATOR, icon: "gauge", tone: "warning", compact: true }) +
        statCard({ label: "Members", value: counts.MEMBER, icon: "user-plus", tone: "gray", compact: true }) +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Members</h2></div>' +
        (TEAM.loaded && accounts.length === 0 ? '<div class="p-6">' + emptyState("users", "No accounts yet", "Share the invite code to add people.") + "</div>" :
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
          '<th class="px-5 py-3">Name</th><th class="hidden px-5 py-3 sm:table-cell">Email</th><th class="px-5 py-3">Role</th><th class="px-5 py-3">Status</th><th class="hidden px-5 py-3 md:table-cell">Joined</th><th class="px-5 py-3 text-right">Actions</th>' +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>") +
      "</div>" +
      '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
        '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">What each role can do</h2><p class="mt-0.5 text-xs text-muted">Enforced by the database itself, not just this screen.</p></div>' +
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted"><th class="px-5 py-3">Permission</th><th class="px-3 py-3 text-center">Admin</th><th class="px-3 py-3 text-center">Moderator</th><th class="px-3 py-3 text-center">Member</th></tr></thead><tbody>' +
          permMatrix.map(function (r) {
            return '<tr class="border-b border-border last:border-0"><td class="px-5 py-2.5 text-foreground">' + esc(r[0]) + '</td><td class="px-3 py-2.5 text-center">' + tick(r[1]) + '</td><td class="px-3 py-2.5 text-center">' + tick(r[2]) + '</td><td class="px-3 py-2.5 text-center">' + tick(r[3]) + "</td></tr>";
          }).join("") +
        "</tbody></table></div>" +
      "</div>" +
    "</div>" +
    modalWrapper("confirm-role-modal", "Change role?", '<p id="confirm-role-text" class="text-sm text-muted"></p><div class="mt-5 flex justify-end gap-2"><button type="button" data-action="cancel-role-change" class="btn-secondary">Cancel</button><button type="button" data-action="confirm-change-role" class="btn-primary">Change Role</button></div>') +
    modalWrapper("confirm-remove-modal", "Remove member?", '<p id="confirm-remove-text" class="text-sm text-muted"></p><div class="mt-5 flex justify-end gap-2"><button type="button" data-action="close-modal" data-modal="confirm-remove-modal" class="btn-secondary">Cancel</button><button type="button" data-action="confirm-remove-account" class="btn-danger">Remove</button></div>') +
    modalWrapper("confirm-regenerate-modal", "Generate a new invite code?", '<p class="text-sm text-muted">The current code and link will stop working immediately. People who already joined are not affected.</p><div class="mt-5 flex justify-end gap-2"><button type="button" data-action="close-modal" data-modal="confirm-regenerate-modal" class="btn-secondary">Cancel</button><button type="button" data-action="confirm-regenerate-invite" class="btn-primary">' + icon("rotate-ccw", "h-4 w-4") + "Generate New Code</button></div>")
  );
}

function joinRequestsSectionHtml() {
  if (!can("members.manage") || !(TEAM.requests && TEAM.requests.length)) return "";
  var rows = TEAM.requests.map(function (r) {
    return (
      '<tr class="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">' +
        '<td class="px-5 py-3"><div class="flex items-center gap-3">' + avatarHtml(null, r.full_name || r.email, "h-9 w-9", "#667085") +
          '<div class="min-w-0"><span class="block truncate font-medium text-foreground">' + esc(r.full_name || "—") + "</span>" +
          '<span class="block truncate text-xs text-muted sm:hidden">' + esc(r.email || "") + "</span></div>" +
        "</div></td>" +
        '<td class="hidden px-5 py-3 text-muted sm:table-cell">' + esc(r.email || "") + "</td>" +
        '<td class="hidden px-5 py-3 text-muted md:table-cell">' + formatJoined(r.requested_at) + "</td>" +
        '<td class="px-5 py-3 text-right"><div class="flex justify-end gap-2">' +
          '<button type="button" data-action="approve-join" data-user="' + esc(r.user_id) + '" class="btn-primary btn-sm">' + icon("circle-check", "h-4 w-4") + "Approve</button>" +
          '<button type="button" data-action="reject-join" data-user="' + esc(r.user_id) + '" class="rounded-lg p-2 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600" title="Reject">' + icon("trash", "h-4 w-4") + "</button>" +
        "</div></td>" +
      "</tr>"
    );
  }).join("");
  return (
    '<div class="animate-slide-up overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">' +
      '<div class="border-b border-border p-5"><h2 class="text-sm font-semibold text-foreground">Join Requests</h2><p class="mt-0.5 text-xs text-muted">Approve someone before they can see meals, money or the roster. Their meal counting starts the day you approve them.</p></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">' +
        '<th class="px-5 py-3">Name</th><th class="hidden px-5 py-3 sm:table-cell">Email</th><th class="hidden px-5 py-3 md:table-cell">Requested</th><th class="px-5 py-3 text-right">Actions</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
    "</div>"
  );
}

function accountById(userId) { return (TEAM.accounts || []).filter(function (a) { return a.user_id === userId; })[0] || null; }
function adminCount() { return (TEAM.accounts || []).filter(function (a) { return a.role === "ADMIN"; }).length; }

function applyRoleChange(userId, role) {
  CTX.api.changeRole(userId, role).then(function () {
    var a = accountById(userId);
    toast((a ? a.full_name || a.email : "Member") + " is now " + roleLabel(role) + ".", "success");
    TEAM.loaded = false;
    loadTeam();
  }).catch(function (err) {
    toast(CTX.friendlyError(err), "error");
    render();
  });
}

function handleTeamClick(action, el) {
  if (action === "copy-invite-code") {
    if (TEAM.invite) copyText(TEAM.invite.code, "Invite code copied.", el);
    return true;
  }
  if (action === "copy-invite-link") {
    if (TEAM.invite) copyText(inviteLinkFor(TEAM.invite.code), "Invite link copied.", el);
    return true;
  }
  if (action === "share-invite") {
    if (TEAM.invite && navigator.share) {
      navigator.share({ title: "Join " + CTX.groupName + " on MealMate", text: "Join our mess on MealMate with code " + TEAM.invite.code, url: inviteLinkFor(TEAM.invite.code) }).catch(function () {});
    }
    return true;
  }
  if (action === "approve-join") {
    el.disabled = true;
    var r = (TEAM.requests || []).filter(function (x) { return x.user_id === el.dataset.user; })[0];
    CTX.api.approveJoinRequest(el.dataset.user).then(function () {
      toast((r ? r.full_name || r.email : "Member") + " approved. Meals start counting from today.", "success");
      TEAM.loaded = false;
      loadTeam();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); el.disabled = false; });
    return true;
  }
  if (action === "reject-join") {
    el.disabled = true;
    var rr = (TEAM.requests || []).filter(function (x) { return x.user_id === el.dataset.user; })[0];
    CTX.api.rejectJoinRequest(el.dataset.user).then(function () {
      toast((rr ? rr.full_name || rr.email : "Request") + " rejected.", "success");
      TEAM.loaded = false;
      loadTeam();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); el.disabled = false; });
    return true;
  }
  if (action === "regenerate-invite") { document.getElementById("confirm-regenerate-modal").hidden = false; return true; }
  if (action === "confirm-regenerate-invite") {
    el.disabled = true;
    CTX.api.regenerateInvite().then(function (code) {
      TEAM.invite = { code: code, enabled: true };
      toast("New invite code: " + code + ". The old one no longer works.", "success");
      render();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); el.disabled = false; });
    return true;
  }
  if (action === "cancel-role-change") {
    PENDING_ROLE_CHANGE = null;
    document.getElementById("confirm-role-modal").hidden = true;
    render(); /* resets the <select> back to the saved role */
    return true;
  }
  if (action === "confirm-change-role") {
    var p = PENDING_ROLE_CHANGE;
    PENDING_ROLE_CHANGE = null;
    document.getElementById("confirm-role-modal").hidden = true;
    if (p) applyRoleChange(p.userId, p.role);
    return true;
  }
  if (action === "remove-account") {
    var a = accountById(el.dataset.user);
    if (!a) return true;
    if (a.role === "ADMIN" && adminCount() <= 1) { toast("You can't remove the last Admin. Promote someone else first.", "error"); return true; }
    PENDING_REMOVE = a.user_id;
    document.getElementById("confirm-remove-text").textContent = "Remove " + (a.full_name || a.email) + " from " + CTX.groupName + "? They lose access right away. Their meal and money history stays in your records.";
    document.getElementById("confirm-remove-modal").hidden = false;
    return true;
  }
  if (action === "confirm-remove-account") {
    var uid2 = PENDING_REMOVE;
    PENDING_REMOVE = null;
    document.getElementById("confirm-remove-modal").hidden = true;
    if (!uid2) return true;
    CTX.api.removeAccount(uid2).then(function () {
      toast("Member removed.", "success");
      TEAM.accounts = TEAM.accounts.filter(function (x) { return x.user_id !== uid2; });
      TEAM.loaded = false;
      loadTeam();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); });
    return true;
  }
  if (action === "retry-team") { TEAM.loaded = false; TEAM.error = ""; loadTeam(); render(); return true; }
  return false;
}

function handleTeamChange(el) {
  if (el.dataset.action === "change-role") {
    var userId = el.dataset.user, current = el.dataset.current, next = el.value;
    if (next === current) return true;
    var a = accountById(userId);
    if (current === "ADMIN" && next !== "ADMIN" && adminCount() <= 1) {
      toast("Every MealMate needs at least one Admin. Promote someone else first.", "error");
      el.value = current;
      return true;
    }
    if (current === "ADMIN" || next === "ADMIN") {
      PENDING_ROLE_CHANGE = { userId: userId, role: next };
      var who = a ? (a.full_name || a.email) : "this member";
      document.getElementById("confirm-role-text").textContent = (a && a.is_me && current === "ADMIN") ?
        "You are about to change your own role from Admin to " + roleLabel(next) + ". You will lose admin access immediately." :
        "Change " + who + " from " + roleLabel(current) + " to " + roleLabel(next) + "?" + (next === "ADMIN" ? " Admins have full control, including removing other members." : "");
      document.getElementById("confirm-role-modal").hidden = false;
      return true;
    }
    el.disabled = true;
    applyRoleChange(userId, next);
    return true;
  }
  if (el.dataset.action === "toggle-invite") {
    var enabled = el.checked;
    el.disabled = true;
    CTX.api.setInviteEnabled(enabled).then(function () {
      if (TEAM.invite) TEAM.invite.enabled = enabled;
      toast(enabled ? "Invites turned on." : "Invites paused — the code won't work until you turn it back on.", "success");
      render();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); render(); });
    return true;
  }
  if (el.dataset.action === "toggle-auto-approve") {
    var auto = el.checked;
    el.disabled = true;
    CTX.api.setInviteAutoApprove(auto).then(function () {
      if (TEAM.invite) TEAM.invite.auto_approve = auto;
      toast(auto ? "Auto-approve on — people who join with the code become members right away." : "Auto-approve off — new joins will wait for your approval.", "success");
      render();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); render(); });
    return true;
  }
  return false;
}


/* ============================== MUTATIONS ============================== */
function setMealValue(memberId, dateKey, type, value) {
  var row = DB.meals.filter(function (m) { return m.memberId === memberId && m.date === dateKey; })[0];
  if (!row) {
    var defaults = mealFor(memberId, dateKey);
    row = { id: uid("meal"), memberId: memberId, date: dateKey, breakfast: defaults.breakfast, lunch: defaults.lunch, dinner: defaults.dinner };
    DB.meals.push(row);
  }
  row[type] = value;
}

function setPicturePreview(previewId, pictureUrl, name, color) {
  var span = document.getElementById(previewId);
  if (span) span.outerHTML = '<span id="' + previewId + '">' + avatarHtml(pictureUrl, name, "h-14 w-14", color, "text-base") + "</span>";
}

/* Reads an <input type=file>'s chosen image, downsizes it to at most
   256x256 on a canvas and resolves with a JPEG data-URL (quality ~0.8) —
   used for both member pictures and the profile picture. */
function downsizeImageFile(file, callback) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var maxDim = 256;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = function () { callback(null); };
    img.src = reader.result;
  };
  reader.onerror = function () { callback(null); };
  reader.readAsDataURL(file);
}

function closeMonth(monthKey) {
  var s = computeHisabSummary(monthKey);
  var snapshot = {
    id: uid("settlement"),
    monthKey: monthKey,
    finalizedAt: new Date().toISOString(),
    totalBazarCost: s.totalBazarCost,
    totalPaid: s.totalPaid,
    totalMeals: s.totalMeals,
    mealRate: s.mealRate,
    members: s.members.map(function (r) {
      return { memberId: r.memberId, name: r.name, paid: r.paid, meals: r.meals, mealCost: r.mealCost, balance: r.balance };
    }),
    transfers: s.transfers,
  };
  var existingIndex = -1;
  DB.settlements.forEach(function (row, i) { if (row.monthKey === monthKey) existingIndex = i; });
  if (existingIndex >= 0) DB.settlements[existingIndex] = snapshot;
  else DB.settlements.push(snapshot);
  saveDB();
}

/* Syncs a member form's three Default Meals toggle pairs (both the hidden
   defaultMeal_<type> inputs the submit handler reads, and the Yes/No
   button visuals) to the given {breakfast, lunch, dinner} values -- used
   both to populate the Edit form from an existing member and to reset the
   Add form back to the app-wide default when it's freshly opened. */
function setDefaultMealsInForm(form, defaults) {
  ["breakfast", "lunch", "dinner"].forEach(function (type) {
    var value = !!defaults[type];
    var hidden = form.querySelector('[name="defaultMeal_' + type + '"]');
    if (hidden) hidden.value = value ? "true" : "false";
    form.querySelectorAll('[data-action="set-default-meal-toggle"][data-type="' + type + '"]').forEach(function (btn) {
      var isSelected = (btn.dataset.value === "true") === value;
      btn.classList.toggle("bg-danger-600", isSelected && !value);
      btn.classList.toggle("bg-success-600", isSelected && value);
      btn.classList.toggle("text-white", isSelected);
      btn.classList.toggle("text-muted", !isSelected);
    });
  });
}

function openMemberEditModal(id) {
  var m = memberById(id);
  if (!m) return;
  var modal = document.getElementById("member-edit-modal");
  var form = modal.querySelector("form");
  modal.querySelector('[name="id"]').value = m.id;
  modal.querySelector('[name="name"]').value = m.name;
  modal.querySelector('[name="phone"]').value = m.phone || "";
  modal.querySelector('[name="email"]').value = m.email || "";
  modal.querySelector('[name="pictureUrl"]').value = m.pictureUrl || "";
  modal.querySelector('[name="status"]').value = m.status;
  setPicturePreview("member-edit-picture-preview", m.pictureUrl || null, m.name, m.avatarColor);
  setDefaultMealsInForm(form, memberDefaultMeals(m));
  modal.hidden = false;
}
function openDepositEditModal(id) {
  var d = DB.deposits.filter(function (x) { return x.id === id; })[0];
  if (!d) return;
  var modal = document.getElementById("deposit-edit-modal");
  modal.querySelector('[name="id"]').value = d.id;
  modal.querySelector('[name="memberId"]').value = d.memberId;
  modal.querySelector('[name="date"]').value = d.date;
  modal.querySelector('[name="amount"]').value = d.amount;
  modal.querySelector('[name="note"]').value = d.note || "";
  modal.hidden = false;
}
function openExpenseEditModal(id) {
  var e = DB.expenses.filter(function (x) { return x.id === id; })[0];
  if (!e) return;
  var modal = document.getElementById("expense-edit-modal");
  var form = modal.querySelector("form");
  modal.querySelector('[name="id"]').value = e.id;
  var buyerIds = e.buyerIds || [];
  modal.querySelectorAll('[name="buyerIds"]').forEach(function (cb) { cb.checked = buyerIds.indexOf(cb.value) >= 0; });
  modal.querySelector('[name="date"]').value = e.date;
  modal.querySelector('[name="note"]').value = e.note || "";
  setExpenseItemRows(form, e.items || []);
  modal.hidden = false;
}

var PENDING_DELETE = null;
var SEARCH_DEBOUNCE = null;
var SHOPPING_SEARCH_DEBOUNCE = null;
/* {monthKey, item, unit} for whichever stock row the
   "Edit Stock" modal (see editStockModal / open-edit-stock-row /
   confirm-edit-stock) is currently editing. */
var EDIT_STOCK_TARGET = null;

/* ============================== EVENT DELEGATION ============================== */
on(document, "click", function (e) {
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var action = el.dataset.action;
  /* inputs handle themselves in the "change"/"input" listeners */
  if (el.tagName === "INPUT" || el.tagName === "SELECT") return;
  if (!guardAction(action)) return;
  if (handleTeamClick(action, el)) return;

  /* close the user menu on any other click */
  var openMenu = document.getElementById("user-menu");
  if (openMenu && !openMenu.hidden && action !== "toggle-usermenu") openMenu.hidden = true;

  if (action === "export-backup") {
    exportBackup();
  } else if (action === "import-local-data") {
    runImport(legacyLocalData(), "this device");
  } else if (action === "toggle-drawer") {
    var app = document.getElementById("app");
    app.dataset.drawerOpen = app.dataset.drawerOpen === "1" ? "0" : "1";
    render();
  } else if (action === "toggle-usermenu") {
    var menu = document.getElementById("user-menu");
    if (menu) menu.hidden = !menu.hidden;
  } else if (action === "logout") {
    CTX.api.signOut();
  } else if (action === "date-nav") {
    navigate("meals", { date: el.dataset.date });
  } else if (action === "store-month-nav") {
    navigate("store", { month: el.dataset.month });
  } else if (action === "dashboard-month-nav") {
    navigate("dashboard", { month: el.dataset.month });
  } else if (action === "money-month-nav") {
    navigate("money", { month: el.dataset.month, q: parseHash().query.q || "" });
  } else if (action === "money-breakdown-month-nav") {
    refreshDepositorsBreakdownModal(el.dataset.month);
  } else if (action === "expenses-month-nav") {
    /* Switching months clears any explicit from/to override so the new
       month's own default range (its 1st day through its end/today) takes
       over, rather than re-applying a stale custom range from before. */
    navigate("expenses", { month: el.dataset.month, q: parseHash().query.q || "" });
  } else if (action === "expenses-range-reset") {
    navigate("expenses", { month: parseHash().query.month || "", q: parseHash().query.q || "" });
  } else if (action === "hisab-month-nav") {
    navigate("hisab", { month: el.dataset.month });
  } else if (action === "summary-month-nav") {
    navigate("summary", { month: el.dataset.month });
  } else if (action === "print-summary") {
    var pdfMonth = el.dataset.month;
    withPdf(function () { downloadSummaryPdf(pdfMonth); });
  } else if (action === "toggle-summary-details") {
    var detailsRow = document.getElementById(el.dataset.target);
    if (detailsRow) detailsRow.classList.toggle("details-collapsed");
  } else if (action === "open-close-month") {
    document.getElementById("close-month-modal").hidden = false;
  } else if (action === "confirm-close-month") {
    /* Read every member's Paid/Carry Forward radio choice out of the modal
       -- this is what closeMoneyMonth() carries forward as next month's
       opening deposits, exactly like the Store Close Month modal reads its
       "remaining" inputs from the DOM rather than tracking separate JS
       state. Members with no radio pair (balance <= 0 this month) simply
       aren't in the map and closeMoneyMonth() skips them. */
    var moneyDecisions = {};
    document.querySelectorAll('#close-month-modal [data-action="close-money-choice-input"]:checked').forEach(function (input) {
      moneyDecisions[input.dataset.member] = input.value;
    });
    closeMonth(el.dataset.month);
    closeMoneyMonth(el.dataset.month, moneyDecisions);
    document.getElementById("close-month-modal").hidden = true;
    toast("Settlement for " + monthLabel(el.dataset.month) + " finalized.", "success");
    render();
  } else if (action === "open-close-store-month") {
    var closeStoreModal = document.getElementById("close-store-month-modal");
    if (closeStoreModal) closeStoreModal.hidden = false;
  } else if (action === "confirm-close-store-month") {
    /* Read every editable "remaining" input the user typed in the Close
       Month modal into a plain {storeStockKey: quantity} map — this is
       what closeStoreMonth() carries forward, instead of any auto-computed
       "used" figure. An input left blank/invalid falls back inside
       closeStoreMonth() to that item's Available quantity. */
    var remainingByKey = {};
    document.querySelectorAll('[data-action="close-store-remaining-input"]').forEach(function (input) {
      remainingByKey[input.dataset.key] = parseFloat(input.value);
    });
    closeStoreMonth(el.dataset.month, remainingByKey);
    document.getElementById("close-store-month-modal").hidden = true;
    toast(monthLabel(el.dataset.month) + " closed — remaining stock carried forward to " + monthLabel(shiftMonthKey(el.dataset.month, 1)) + ".", "success");
    render();
  } else if (action === "open-edit-stock-row") {
    /* storeStockKey() concatenates item+unit with no separator, so it can't
       be reliably split back apart -- instead re-derive the row's own key
       and match it against this month's already-computed stock summary
       (the same summary the Store page's table itself just rendered from)
       to find which item/unit/available this click refers to. */
    var editMonthKey = parseHash().query.month && /^\d{4}-\d{2}$/.test(parseHash().query.month) ? parseHash().query.month : latestMonthKey();
    var editStock = computeStoreStockSummary(editMonthKey);
    var editRow = editStock.rows.filter(function (r) { return storeStockKey(r.item, r.unit) === el.dataset.key; })[0];
    if (!editRow) { toast("Could not find that item.", "error"); return; }
    EDIT_STOCK_TARGET = { monthKey: editMonthKey, item: editRow.item, unit: editRow.unit };
    var editBody = document.getElementById("edit-stock-body");
    if (editBody) editBody.innerHTML = editStockModalBody(editRow.item, editRow.unit, editRow.available);
    document.getElementById("edit-stock-modal").hidden = false;
  } else if (action === "confirm-edit-stock") {
    if (!EDIT_STOCK_TARGET) { document.getElementById("edit-stock-modal").hidden = true; return; }
    var editInput = document.getElementById("edit-stock-quantity-input");
    var editVal = editInput ? parseFloat(editInput.value) : NaN;
    if (isNaN(editVal) || editVal < 0) { toast("Please enter a valid quantity.", "error"); return; }
    recordManualStockCarryForward(EDIT_STOCK_TARGET.item, EDIT_STOCK_TARGET.unit, EDIT_STOCK_TARGET.monthKey, editVal);
    saveDB();
    document.getElementById("edit-stock-modal").hidden = true;
    toast("Stock for " + EDIT_STOCK_TARGET.item + " updated.", "success");
    EDIT_STOCK_TARGET = null;
    render();
  } else if (action === "view-store-history-month") {
    var historyBody = document.getElementById("store-history-body");
    if (historyBody) historyBody.innerHTML = storeHistoryDetailHtml(el.dataset.month);
  } else if (action === "back-to-store-history-list") {
    var historyBody2 = document.getElementById("store-history-body");
    if (historyBody2) historyBody2.innerHTML = storeHistoryListHtml();
  } else if (action === "open-modal") {
    var m1 = document.getElementById(el.dataset.modal);
    if (m1) {
      if (el.dataset.modal === "deposit-add-modal" || el.dataset.modal === "expense-add-modal") {
        var form = m1.querySelector("form");
        if (form) form.reset();
        if (el.dataset.modal === "expense-add-modal" && form) setExpenseItemRows(form, []);
        var dateInput = m1.querySelector('[name="date"]');
        if (dateInput) dateInput.value = latestDateAcross();
      }
      m1.hidden = false;
    }
  } else if (action === "close-modal") {
    var m2 = document.getElementById(el.dataset.modal);
    if (m2) m2.hidden = true;
  } else if (action === "shopping-select-category") {
    navigate("shopping-list", { category: el.dataset.category });
  } else if (action === "shopping-add-others") {
    var othersInput = document.querySelector('[data-action="shopping-others-input"]');
    var othersName = othersInput ? othersInput.value.trim() : "";
    var othersCategory = el.dataset.category;
    if (!othersName) { toast("Type an item name first.", "error"); return; }
    addToShoppingList(othersCategory, othersName);
    if (othersInput) othersInput.value = "";
    refreshShoppingListPanel();
    refreshShoppingListLeftPane();
    toast(othersName + " added to " + othersCategory + ".", "success");
  } else if (action === "shopping-remove-item") {
    removeFromShoppingList(el.dataset.id);
    refreshShoppingListPanel();
    refreshShoppingListLeftPane();
  } else if (action === "download-shopping-list") {
    withPdf(downloadShoppingListFile);
  } else if (action === "edit-member") {
    openMemberEditModal(el.dataset.id);
  } else if (action === "set-default-meal-toggle") {
    var toggleForm = el.closest("form");
    if (toggleForm) {
      var current = {
        breakfast: toggleForm.querySelector('[name="defaultMeal_breakfast"]').value === "true",
        lunch: toggleForm.querySelector('[name="defaultMeal_lunch"]').value === "true",
        dinner: toggleForm.querySelector('[name="defaultMeal_dinner"]').value === "true",
      };
      current[el.dataset.type] = el.dataset.value === "true";
      setDefaultMealsInForm(toggleForm, current);
    }
  } else if (action === "remove-picture") {
    var pForm = el.closest("form");
    var pHidden = pForm ? pForm.querySelector('[name="' + el.dataset.target + '"]') : null;
    if (pHidden) { pHidden.value = ""; pHidden.dataset.removed = "1"; }
    setPicturePreview(el.dataset.preview, null, (pForm && pForm.querySelector('[name="name"]') ? pForm.querySelector('[name="name"]').value : "") || "?", "#888");
  } else if (action === "toggle-member-status") {
    var mem = memberById(el.dataset.id);
    if (mem) {
      mem.status = mem.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      saveDB();
      toast(mem.name + " is now " + (mem.status === "ACTIVE" ? "active" : "inactive") + ".", "success");
      render();
    }
  } else if (action === "add-deposit") {
    var dModal = document.getElementById("deposit-add-modal");
    var df = dModal.querySelector("form");
    if (df) df.reset();
    dModal.querySelector('[name="date"]').value = latestDateAcross();
    dModal.hidden = false;
  } else if (action === "edit-deposit") {
    openDepositEditModal(el.dataset.id);
  } else if (action === "delete-deposit") {
    PENDING_DELETE = { type: "deposit", id: el.dataset.id };
    document.getElementById("delete-deposit-modal").hidden = false;
  } else if (action === "add-expense") {
    var eModal = document.getElementById("expense-add-modal");
    var ef = eModal.querySelector("form");
    if (ef) ef.reset();
    eModal.querySelector('[name="date"]').value = latestDateAcross();
    if (ef) setExpenseItemRows(ef, []);
    eModal.hidden = false;
  } else if (action === "edit-expense") {
    openExpenseEditModal(el.dataset.id);
  } else if (action === "add-item-row") {
    var rowForm = el.closest("form");
    if (rowForm) { addExpenseItemRow(rowForm); refreshExpenseItemTotal(rowForm); }
  } else if (action === "remove-item-row") {
    var removeForm = el.closest("form");
    var rowToRemove = el.closest("[data-item-row]");
    if (removeForm && rowToRemove) {
      var rowCount = removeForm.querySelectorAll("[data-item-row]").length;
      if (rowCount > 1) {
        rowToRemove.parentNode.removeChild(rowToRemove);
        updateRemoveRowButtons(removeForm);
        refreshExpenseItemTotal(removeForm);
      }
    }
  } else if (action === "delete-expense") {
    PENDING_DELETE = { type: "expense", id: el.dataset.id };
    document.getElementById("delete-expense-modal").hidden = false;
  } else if (action === "confirm-delete") {
    if (PENDING_DELETE) {
      if (PENDING_DELETE.type === "deposit") {
        DB.deposits = DB.deposits.filter(function (d) { return d.id !== PENDING_DELETE.id; });
      } else if (PENDING_DELETE.type === "expense") {
        DB.expenses = DB.expenses.filter(function (x) { return x.id !== PENDING_DELETE.id; });
      }
      saveDB();
      toast("Deleted.", "success");
      PENDING_DELETE = null;
    }
    document.getElementById(el.dataset.modal).hidden = true;
    render();
  } else if (action === "set-meal") {
    setMealValue(el.dataset.member, el.dataset.date, el.dataset.type, el.dataset.value === "true");
    saveDB();
    render();
  } else if (action === "set-meal-default") {
    var defaultMember = memberById(el.dataset.member);
    if (defaultMember) {
      var newDefaults = memberDefaultMeals(defaultMember);
      newDefaults[el.dataset.type] = el.dataset.value === "true";
      defaultMember.defaultMeals = newDefaults;
      saveDB();
      toast(defaultMember.name + "'s default " + el.dataset.type + " is now " + (newDefaults[el.dataset.type] ? "Yes" : "No") + ".", "success");
      render();
    }
  } else if (action === "set-meal-all") {
    var allValue = el.dataset.value === "true";
    activeMembers().forEach(function (m) {
      setMealValue(m.id, el.dataset.date, el.dataset.type, allValue);
    });
    saveDB();
    toast("Set all members' " + el.dataset.type + " to " + (allValue ? "Yes" : "No") + ".", "success");
    render();
  } else if (action === "select-item-suggestion") {
    var itemField = el.closest("[data-item-field]");
    var itemInput = itemField ? itemField.querySelector('[data-field="item"]') : null;
    if (itemInput) {
      itemInput.value = el.dataset.value;
      var list = itemField.querySelector("[data-item-suggestions]");
      if (list) list.hidden = true;
      var suggestionRow = itemInput.closest("[data-item-row]");
      if (suggestionRow) refreshStockReconcileForRow(suggestionRow, itemInput.closest("form"));
    }
  }
});

on(document, "mousedown", function (e) {
  if (e.target.closest("[data-action='select-item-suggestion']")) {
    e.preventDefault();
  }
});

/* Tracks pointer position over each quick-action pill (Dashboard's Add
   Meal/Money/Expense/Member buttons) so the hover fill in .quick-action-pill
   ::before (see manual patch 15) grows outward from wherever the cursor
   actually entered, instead of always expanding from the button's center. */
on(document, "pointermove", function (e) {
  var pill = e.target.closest && e.target.closest('[data-action="quick-action-hover-fill"]');
  if (!pill) return;
  var rect = pill.getBoundingClientRect();
  pill.style.setProperty("--mx", ((e.clientX - rect.left) / rect.width * 100) + "%");
  pill.style.setProperty("--my", ((e.clientY - rect.top) / rect.height * 100) + "%");
});

on(document, "focusout", function (e) {
  var field = e.target.closest("[data-item-field]");
  if (!field) return;
  setTimeout(function () {
    if (!field.contains(document.activeElement)) {
      var list = field.querySelector("[data-item-suggestions]");
      if (list) list.hidden = true;
    }
  }, 120);
});

on(document, "input", function (e) {
  if (e.target.dataset.action === "shopping-quantity-input" && !guardAction("shopping-quantity-input")) return;
  if (e.target.dataset.action === "search-input") {
    var value = e.target.value;
    clearTimeout(SEARCH_DEBOUNCE);
    SEARCH_DEBOUNCE = setTimeout(function () {
      navigate(parseHash().path, currentQueryWith({ q: value }));
    }, 350);
  } else if (e.target.dataset.action === "item-input") {
    refreshItemSuggestions(e.target);
    var itemRow = e.target.closest("[data-item-row]");
    if (itemRow) refreshStockReconcileForRow(itemRow, e.target.closest("form"));
  } else if (e.target.dataset.action === "item-amount-input") {
    refreshExpenseItemTotal(e.target);
  } else if (e.target.dataset.action === "shopping-category-search") {
    var categorySearchValue = e.target.value;
    clearTimeout(SHOPPING_SEARCH_DEBOUNCE);
    SHOPPING_SEARCH_DEBOUNCE = setTimeout(function () {
      /* Live-filters just the items grid (not a full navigate()/render())
         so the input never loses focus while typing. Rebuilding the whole
         checklist via refreshShoppingListLeftPane() would also blow away
         the just-typed search value's cursor position, so only the items
         list underneath is patched here instead. */
      var checklistHost = document.getElementById("shopping-item-checklist");
      var chipsHost = document.getElementById("shopping-category-chips");
      var activeChip = chipsHost ? chipsHost.querySelector(".bg-navy-900") : null;
      var activeCategory = activeChip ? activeChip.dataset.category : "";
      if (checklistHost) checklistHost.innerHTML = shoppingListItemChecklistHtml(activeCategory, categorySearchValue);
      var newSearchInput = document.querySelector('[data-action="shopping-category-search"]');
      if (newSearchInput) {
        newSearchInput.focus();
        newSearchInput.setSelectionRange(newSearchInput.value.length, newSearchInput.value.length);
      }
    }, 200);
  } else if (e.target.dataset.action === "shopping-quantity-input") {
    var qtyRow = DB.shoppingList.filter(function (r) { return r.id === e.target.dataset.id; })[0];
    if (qtyRow) { qtyRow.quantity = e.target.value; saveDB(); }
  }
});

on(document, "focusin", function (e) {
  if (e.target.dataset.action === "item-input") {
    refreshItemSuggestions(e.target);
  }
});

on(document, "change", function (e) {
  var changeAction = e.target.dataset.action;
  if (changeAction && ACTION_PERMS[changeAction]) {
    if (!guardAction(changeAction)) {
      if (e.target.type === "checkbox") e.target.checked = !e.target.checked;
      if (changeAction === "change-role") e.target.value = e.target.dataset.current;
      return;
    }
    if (handleTeamChange(e.target)) return;
  }
  if (changeAction === "import-backup-input") {
    var backupFile = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!backupFile) return;
    if (backupFile.size > 25 * 1024 * 1024) { toast("That file is too large.", "error"); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var parsed = null;
      try { parsed = JSON.parse(String(fr.result || "")); } catch (err) {}
      runImport(parsed, "the backup file");
    };
    fr.onerror = function () { toast("Could not read that file.", "error"); };
    fr.readAsText(backupFile);
    return;
  }
  if (e.target.dataset.field === "category") {
    var row = e.target.closest("[data-item-row]");
    var itemInput = row ? row.querySelector('[data-field="item"]') : null;
    if (itemInput) refreshItemSuggestions(itemInput);
  } else if (e.target.dataset.action === "item-unit-input") {
    var unitRow = e.target.closest("[data-item-row]");
    if (unitRow) refreshStockReconcileForRow(unitRow, e.target.closest("form"));
  } else if (e.target.dataset.action === "stock-finished-input") {
    var reconcileBlock = e.target.closest("[data-stock-reconcile]");
    var remainingField = reconcileBlock ? reconcileBlock.querySelector("[data-stock-remaining-field]") : null;
    if (remainingField) remainingField.hidden = e.target.value !== "no";
  } else if (e.target.name === "date" && e.target.closest('[data-form="expense"]')) {
    var expenseForm = e.target.closest("form");
    expenseForm.querySelectorAll("[data-item-row]").forEach(function (r) { refreshStockReconcileForRow(r, expenseForm); });
  } else if (e.target.dataset.action === "picture-input") {
    var fileInput = e.target;
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var pf = fileInput.closest("form");
    var hiddenInput = pf ? pf.querySelector('[name="' + fileInput.dataset.target + '"]') : null;
    var nameInput = pf ? pf.querySelector('[name="name"]') : null;
    var previewName = (nameInput ? nameInput.value : "") || SESSION.name || "?";
    downsizeImageFile(file, function (dataUrl) {
      if (!dataUrl) { toast("Could not read that image.", "error"); return; }
      if (hiddenInput) { hiddenInput.value = dataUrl; hiddenInput.dataset.removed = "0"; }
      setPicturePreview(fileInput.dataset.preview, dataUrl, previewName, "#888");
    });
  } else if (e.target.dataset.action === "expenses-range-input") {
    var rangeContainer = e.target.closest(".animate-slide-up");
    var fromInput = rangeContainer ? rangeContainer.querySelector('[data-bound="from"]') : null;
    var toInput = rangeContainer ? rangeContainer.querySelector('[data-bound="to"]') : null;
    var fromVal = fromInput ? fromInput.value : "";
    var toVal = toInput ? toInput.value : "";
    if (!fromVal || !toVal) return; /* wait until both ends of the range are set */
    if (fromVal > toVal) { toast("Start date must be before the end date.", "error"); return; }
    navigate("expenses", { from: fromVal, to: toVal, q: parseHash().query.q || "" });
  } else if (e.target.dataset.action === "shopping-toggle-item") {
    var category = e.target.dataset.category, itemName = e.target.dataset.item;
    if (e.target.checked) addToShoppingList(category, itemName);
    else {
      var existing = shoppingListEntry(category, itemName);
      if (existing) removeFromShoppingList(existing.id);
    }
    refreshShoppingListPanel();
    refreshShoppingListLeftPane();
  } else if (e.target.dataset.action === "shopping-toggle-checked") {
    var checkedRow = DB.shoppingList.filter(function (r) { return r.id === e.target.dataset.id; })[0];
    if (checkedRow) { checkedRow.checked = e.target.checked; saveDB(); }
    refreshShoppingListPanel();
  }
});

on(document, "submit", function (e) {
  var form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  var type = form.dataset.form;
  var fd = new FormData(form);

  var formPerm = type === "member" ? "members.manage" :
    type === "deposit" ? "deposits.manage" :
    type === "expense" ? (form.dataset.mode === "edit" ? "expenses.edit" : "expenses.create") :
    type === "rename-group" ? "settings.manage" : null;
  if (formPerm && !can(formPerm)) { toast("You don't have permission to do that.", "error"); return; }
  if (formPerm && !CTX.isFresh()) { toast("Still syncing with the server — try again in a second.", "error"); return; }
  var submitBtn = form.querySelector('[type="submit"]');

  if (type === "rename-group") {
    var newGroupName = String(fd.get("groupName") || "").trim();
    if (newGroupName.length < 2) { toast("Name must be at least 2 characters.", "error"); return; }
    if (submitBtn) submitBtn.disabled = true;
    CTX.api.renameGroup(newGroupName).then(function () {
      CTX.groupName = newGroupName;
      toast("MealMate renamed.", "success");
      render();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); if (submitBtn) submitBtn.disabled = false; });
  } else if (type === "member") {
    var mode = form.dataset.mode;
    var name = String(fd.get("name") || "").trim();
    var phone = String(fd.get("phone") || "").trim();
    var memberEmail = String(fd.get("email") || "").trim();
    var pictureUrl = String(fd.get("pictureUrl") || "").trim();
    var defaultMeals = {
      breakfast: String(fd.get("defaultMeal_breakfast") || "false") === "true",
      lunch: String(fd.get("defaultMeal_lunch") || "false") === "true",
      dinner: String(fd.get("defaultMeal_dinner") || "false") === "true",
    };
    if (name.length < 2) { toast("Name must be at least 2 characters.", "error"); return; }
    /* Members are only ever created via an approved join request now --
       this form can only edit an existing roster row. */
    var id = String(fd.get("id") || "");
    var status = String(fd.get("status") || "ACTIVE") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    var m = memberById(id);
    if (m) { m.name = name; m.status = status; m.phone = phone || null; m.email = memberEmail || null; m.pictureUrl = pictureUrl || null; m.defaultMeals = defaultMeals; }
    saveDB();
    document.getElementById("member-edit-modal").hidden = true;
    toast("Member updated.", "success");
    render();
  } else if (type === "deposit") {
    var dmode = form.dataset.mode;
    var memberId = String(fd.get("memberId") || "");
    var date = String(fd.get("date") || "");
    var amount = parseFloat(fd.get("amount"));
    var note = String(fd.get("note") || "").trim();
    if (!memberId) { toast("Please select a member.", "error"); return; }
    if (!date) { toast("Please select a date.", "error"); return; }
    if (!(amount > 0)) { toast("Please enter a valid amount.", "error"); return; }
    if (dmode === "edit") {
      var did = String(fd.get("id") || "");
      var d = DB.deposits.filter(function (x) { return x.id === did; })[0];
      if (d) { d.memberId = memberId; d.date = date; d.amount = amount; d.note = note || null; }
    } else {
      DB.deposits.push({ id: uid("dep"), memberId: memberId, date: date, amount: amount, note: note || null });
    }
    saveDB();
    document.getElementById(dmode === "edit" ? "deposit-edit-modal" : "deposit-add-modal").hidden = true;
    toast(dmode === "edit" ? "Deposit updated." : "Deposit added.", "success");
    render();
  } else if (type === "expense") {
    var emode = form.dataset.mode;
    var buyerIds = fd.getAll("buyerIds").map(String);
    var edate = String(fd.get("date") || "");
    var enote = String(fd.get("note") || "").trim();
    var edateMonthKey = edate ? monthKeyOf(edate) : latestMonthKey();
    var itemsResult = parseExpenseItemRows(form, edateMonthKey);
    if (itemsResult.error) { toast(itemsResult.error, "error"); return; }
    var eitems = itemsResult.items;
    if (!eitems.length) { toast("Please add at least one item.", "error"); return; }
    if (!edate) { toast("Please select a date.", "error"); return; }
    if (!buyerIds.length) { toast("Please select who did it (Done By) before adding the expense.", "error"); return; }
    var eamount = eitems.reduce(function (s, it) { return s + it.amount; }, 0);

    /* Apply every "Previous stock finished?" correction the user answered
       (see parseExpenseItemRows -- "Yes" means 0 remains, "No" means the
       typed remaining amount) as a manual stock carry-forward delta for
       this item, in the month the expense is dated -- then strip the
       transient UI-only fields before the item is stored, since
       DB.expenses items only ever hold {category, item, quantity, unit,
       amount} (see expenseItemsSummary and every other reader of .items). */
    eitems.forEach(function (it) {
      if (it.quantity > 0 && it.unit && it.manualStockRemaining !== null) {
        recordManualStockCarryForward(it.item, it.unit, edateMonthKey, it.manualStockRemaining);
      }
      delete it.manualStockRemaining;
    });

    if (emode === "edit") {
      var eid = String(fd.get("id") || "");
      var ex = DB.expenses.filter(function (x) { return x.id === eid; })[0];
      if (ex) { ex.buyerIds = buyerIds; ex.date = edate; ex.note = enote || null; ex.items = eitems; ex.amount = eamount; }
    } else {
      DB.expenses.push({ id: uid("exp"), buyerIds: buyerIds, date: edate, note: enote || null, items: eitems, amount: eamount });
    }
    saveDB();
    document.getElementById(emode === "edit" ? "expense-edit-modal" : "expense-add-modal").hidden = true;
    toast(emode === "edit" ? "Expense updated." : "Expense added.", "success");
    render();
  } else if (type === "profile") {
    var profileName = String(fd.get("name") || "").trim();
    var profileAvatarUrl = String(fd.get("avatarUrl") || "").trim();
    if (profileName.length < 2) { toast("Name must be at least 2 characters.", "error"); return; }
    /* hidden input starts empty; keep the current picture unless the user
       uploaded a new one or pressed Remove (which sets data-removed). */
    var avatarInput = form.querySelector('[name="avatarUrl"]');
    var removed = avatarInput && avatarInput.dataset.removed === "1";
    var nextAvatar = profileAvatarUrl || (removed ? null : SESSION.avatarUrl || null);
    if (submitBtn) submitBtn.disabled = true;
    CTX.api.updateProfile({ name: profileName, avatarUrl: nextAvatar }).then(function () {
      SESSION = { name: profileName, email: SESSION.email, avatarUrl: nextAvatar };
      CTX.profile = SESSION;
      toast("Profile updated.", "success");
      render();
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); if (submitBtn) submitBtn.disabled = false; });
  } else if (type === "change-password") {
    var current = String(fd.get("current") || "");
    var next = String(fd.get("next") || "");
    var confirm = String(fd.get("confirm") || "");
    if (next.length < 8) { toast("New password must be at least 8 characters.", "error"); return; }
    if (next !== confirm) { toast("Passwords do not match.", "error"); return; }
    if (next === current) { toast("New password must be different from the current one.", "error"); return; }
    if (submitBtn) submitBtn.disabled = true;
    CTX.api.changePassword(current, next).then(function () {
      form.reset();
      toast("Password updated.", "success");
    }).catch(function (err) { toast(CTX.friendlyError(err), "error"); }).then(function () { if (submitBtn) submitBtn.disabled = false; });
  }
});

