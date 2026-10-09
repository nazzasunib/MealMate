/* MealMate sync layer — the "compatibility layer" between the original
   in-memory DB object (same shape the old localStorage version used) and
   Supabase Postgres, which is now the single source of truth.

   How it works
   - load():  fetches every table for the group in parallel and builds DB.
   - persist(): called by the engine's saveDB(). Debounced; computes a diff
     between DB and the last known server state (per row, per table) and
     sends only changed rows (upsert) / removed rows (delete).
   - After a successful write, a tiny broadcast ("these tables changed") is
     sent to everyone else in the group; they re-fetch just those tables.
     No data travels over the broadcast, so it can't leak anything.
   - Refreshes never clobber unsaved local edits: they wait for the write
     queue to drain first. */

const PAGE = 1000;

const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v) => (v === null || v === undefined ? null : String(v));

const SHOP_SEP = "\u001F";
export function cleanShopPrice(v) {
  const s = String(v === null || v === undefined ? "" : v).replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100).slice(0, 10) : "";
}
function encodeShopQty(quantity, price) {
  const q = String(quantity || "").split(SHOP_SEP).join("").slice(0, 28);
  const p = cleanShopPrice(price);
  return p ? q + SHOP_SEP + p : q;
}
function decodeShopQty(stored) {
  const parts = String(stored || "").split(SHOP_SEP);
  return { quantity: parts[0] || "", price: cleanShopPrice(parts[1]) };
}

/* ---------- table adapters: engine row <-> database row ---------- */
export const TABLES = [
  {
    coll: "members",
    table: "members",
    order: ["created_at", "id"],
    keyCols: ["id"],
    key: (r) => String(r.id),
    toDb: (r) => ({
      id: String(r.id),
      user_id: r.userId || null,
      name: String(r.name || "").slice(0, 80) || "Member",
      avatar_color: r.avatarColor || "#0B1F4B",
      status: r.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      joined_at: r.joinedAt || new Date().toISOString().slice(0, 10),
      phone: r.phone || null,
      email: r.email || null,
      picture_url: r.pictureUrl || null,
      default_meals: r.defaultMeals || { breakfast: false, lunch: true, dinner: true },
    }),
    fromDb: (d) => ({
      id: d.id,
      userId: d.user_id || null,
      name: d.name,
      avatarColor: d.avatar_color,
      status: d.status,
      joinedAt: d.joined_at,
      phone: d.phone,
      email: d.email,
      pictureUrl: d.picture_url,
      defaultMeals: d.default_meals || undefined,
    }),
  },
  {
    coll: "meals",
    table: "meals",
    order: ["date", "member_id"],
    keyCols: ["member_id", "date"],
    key: (r) => r.memberId + "|" + r.date,
    toDb: (r) => ({
      member_id: String(r.memberId),
      date: r.date,
      id: r.id || null,
      breakfast: !!r.breakfast,
      lunch: !!r.lunch,
      dinner: !!r.dinner,
    }),
    fromDb: (d) => ({ id: d.id || d.member_id + "_" + d.date, memberId: d.member_id, date: d.date, breakfast: !!d.breakfast, lunch: !!d.lunch, dinner: !!d.dinner }),
  },
  {
    coll: "guestMeals",
    table: "guest_meals",
    order: ["created_at", "id"],
    keyCols: ["id"],
    key: (r) => String(r.id),
    toDb: (r) => ({
      id: String(r.id),
      host_member_id: String(r.hostMemberId || ""),
      guest_name: r.guestName || null,
      date: r.date,
      breakfast: !!r.breakfast,
      lunch: !!r.lunch,
      dinner: !!r.dinner,
      quantity: Math.max(1, num(r.quantity) || 1),
      note: r.note || null,
    }),
    fromDb: (d) => ({
      id: d.id,
      hostMemberId: d.host_member_id,
      guestName: d.guest_name || "",
      date: d.date,
      breakfast: !!d.breakfast,
      lunch: !!d.lunch,
      dinner: !!d.dinner,
      quantity: num(d.quantity) || 1,
      note: d.note || "",
    }),
  },
  {
    coll: "deposits",
    table: "deposits",
    order: ["created_at", "id"],
    keyCols: ["id"],
    key: (r) => String(r.id),
    toDb: (r) => ({
      id: String(r.id),
      member_id: String(r.memberId || ""),
      date: r.date,
      amount: Math.round(num(r.amount) * 100) / 100,
      note: r.note || null,
      carried_from_month_key: r.carriedFromMonthKey || null,
    }),
    fromDb: (d) => {
      const o = { id: d.id, memberId: d.member_id, date: d.date, amount: num(d.amount), note: d.note };
      if (d.carried_from_month_key) o.carriedFromMonthKey = d.carried_from_month_key;
      return o;
    },
  },
  {
    coll: "expenses",
    table: "expenses",
    order: ["seq"],
    keyCols: ["id"],
    key: (r) => String(r.id),
    toDb: (r) => ({
      id: String(r.id),
      date: r.date,
      amount: Math.round(num(r.amount) * 100) / 100,
      note: r.note || null,
      buyer_ids: (r.buyerIds || []).map(String),
      items: (r.items && r.items.length
        ? r.items
        : [{ category: r.category || null, item: r.item || "Item", quantity: r.quantity || null, unit: r.unit || null, amount: num(r.amount) }]
      ).map((it) => ({
        category: it.category || null,
        item: String(it.item || ""),
        quantity: numOrNull(it.quantity),
        unit: it.unit || null,
        amount: num(it.amount),
      })),
    }),
    fromDb: (d) => ({
      id: d.id,
      date: d.date,
      amount: num(d.amount),
      note: d.note,
      buyerIds: d.buyer_ids || [],
      items: (d.items || []).map((it) => ({
        category: it.category || null,
        item: it.item,
        quantity: numOrNull(it.quantity),
        unit: it.unit || null,
        amount: num(it.amount),
      })),
    }),
  },
  {
    coll: "shoppingList",
    table: "shopping_items",
    order: ["created_at", "id"],
    keyCols: ["id"],
    key: (r) => String(r.id),
    /* The optional price is kept in the same `quantity` text column as
       "<qty>\u001F<price>" (qty ≤ 28 chars, price digits), so no database
       change is needed; the engine only ever sees separate quantity/price. */
    toDb: (r) => ({
      id: String(r.id),
      category: String(r.category || "Grocery"),
      item: String(r.item || ""),
      quantity: encodeShopQty(r.quantity, r.price),
      checked: !!r.checked,
    }),
    fromDb: (d) => {
      const q = decodeShopQty(d.quantity);
      return { id: d.id, category: d.category, item: d.item, quantity: q.quantity, price: q.price, checked: !!d.checked };
    },
  },
  {
    coll: "storeCarryForward",
    table: "store_carry_forward",
    order: ["month_key", "from_month_key", "item", "unit"],
    keyCols: ["month_key", "from_month_key", "item", "unit"],
    key: (r) => [r.monthKey, r.fromMonthKey, r.item, r.unit || ""].join("|"),
    /* the engine may (in theory) hold two rows with the same key; they are
       summed, which is exactly how storeCarryForwardInto() reads them */
    merge: (a, b) => ({ ...a, quantity: num(a.quantity) + num(b.quantity) }),
    toDb: (r) => ({
      month_key: r.monthKey,
      from_month_key: r.fromMonthKey,
      item: String(r.item || ""),
      unit: r.unit || "",
      quantity: num(r.quantity),
    }),
    fromDb: (d) => ({ item: d.item, unit: d.unit || null, monthKey: d.month_key, fromMonthKey: d.from_month_key, quantity: num(d.quantity) }),
  },
  {
    coll: "storeClosedMonths",
    table: "store_closed_months",
    order: ["month_key"],
    keyCols: ["month_key"],
    key: (r) => r.monthKey,
    toDb: (r) => ({ month_key: r.monthKey, closed_at: r.closedAt || new Date().toISOString(), rows: r.rows || [], totals: r.totals || {} }),
    fromDb: (d) => ({ monthKey: d.month_key, closedAt: d.closed_at, rows: d.rows || [], totals: d.totals || {} }),
  },
  {
    coll: "moneyClosedMonths",
    table: "money_closed_months",
    order: ["month_key"],
    keyCols: ["month_key"],
    key: (r) => r.monthKey,
    toDb: (r) => ({ month_key: r.monthKey, closed_at: r.closedAt || new Date().toISOString(), decisions: r.decisions || [] }),
    fromDb: (d) => ({ monthKey: d.month_key, closedAt: d.closed_at, decisions: d.decisions || [] }),
  },
  {
    coll: "settlements",
    table: "settlements",
    order: ["month_key"],
    keyCols: ["month_key"],
    key: (r) => r.monthKey,
    toDb: (r) => ({
      month_key: r.monthKey,
      id: r.id || null,
      finalized_at: r.finalizedAt || new Date().toISOString(),
      total_bazar_cost: Math.round(num(r.totalBazarCost) * 100) / 100,
      total_paid: Math.round(num(r.totalPaid) * 100) / 100,
      total_meals: num(r.totalMeals),
      meal_rate: num(r.mealRate),
      members: r.members || [],
      transfers: r.transfers || [],
    }),
    fromDb: (d) => ({
      id: d.id || "settlement_" + d.month_key,
      monthKey: d.month_key,
      finalizedAt: d.finalized_at,
      totalBazarCost: num(d.total_bazar_cost),
      totalPaid: num(d.total_paid),
      totalMeals: num(d.total_meals),
      mealRate: num(d.meal_rate),
      members: d.members || [],
      transfers: d.transfers || [],
    }),
  },
];
const BY_COLL = Object.fromEntries(TABLES.map((t) => [t.coll, t]));
const BY_TABLE = Object.fromEntries(TABLES.map((t) => [t.table, t]));

/* ---------- activity feed ("Notifications") ----------
   After this device saves changes, one short line per kind of change is added
   to activity_log (the database stamps who did it). Everyone in the MealMate
   sees these lines in the bell menu. */
const MEAL_TYPES = ["breakfast", "lunch", "dinner"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(d || "");
};
const fmtMonth = (k) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(k || ""));
  return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : String(k || "");
};
const tk = (n) => "৳" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const listNames = (names, noun) => {
  const u = Array.from(new Set(names.filter(Boolean)));
  if (u.length <= 3) return u.join(", ");
  return u.length + " " + noun;
};
const mealsText = (r) => MEAL_TYPES.filter((t) => r[t]).map(cap).join(", ");
const TABLE_KIND = {
  members: "member", meals: "meal", guest_meals: "guest", deposits: "deposit", expenses: "expense",
  shopping_items: "shopping", store_carry_forward: "store", store_closed_months: "store",
  money_closed_months: "month", settlements: "settlement",
};
const TABLE_NOUN = {
  members: "members", meals: "meal entries", guest_meals: "guest meals", deposits: "deposits", expenses: "expenses",
  shopping_items: "shopping items", store_closed_months: "store months", money_closed_months: "money months", settlements: "settlements",
};

export function describeChanges(changes, db) {
  const out = [];
  const memberName = (id, fallback) => {
    const m = (db.members || []).find((x) => String(x.id) === String(id));
    return m ? m.name : fallback || "a member";
  };
  const push = (table, action, summary) => { if (summary) out.push({ kind: TABLE_KIND[table] || "other", action, summary: summary.slice(0, 400) }); };
  for (const ch of changes) {
    const table = ch.adapter.table;
    if (table === "store_carry_forward") continue; // part of closing a store month
    // single shopping-list items stay quiet (too many lines); assigning the
    // list is announced by the database instead (set_shopping_plan)
    if (table === "shopping_items") continue;
    const ins = ch.upserts.filter((u) => !u.prev);
    const upd = ch.upserts.filter((u) => u.prev);
    const del = ch.deletes.map((d) => JSON.parse(d.json));
    const total = ins.length + upd.length + del.length;
    if (total > 15 && table !== "meals") { // a backup import or a big batch
      push(table, "updated", `updated ${total} ${TABLE_NOUN[table] || "rows"} at once`);
      continue;
    }
    if (table === "members") {
      ins.forEach((u) => push(table, "added", `added member ${u.row.name}`));
      upd.forEach((u) => {
        const o = JSON.parse(u.prev), n = u.row;
        if (o.status !== n.status) push(table, "updated", `marked ${n.name} ${n.status === "ACTIVE" ? "active" : "inactive"}`);
        else if (o.name !== n.name) push(table, "updated", `renamed ${o.name} to ${n.name}`);
        else if (JSON.stringify(o.default_meals) !== JSON.stringify(n.default_meals)) {
          const on = mealsText(n.default_meals || {}) || "no meals";
          push(table, "updated", `changed ${n.name}'s default meals · ${on}`);
        } else if (o.picture_url !== n.picture_url) push(table, "updated", `updated ${n.name}'s picture`);
        else if (o.user_id === n.user_id) push(table, "updated", `updated ${n.name}'s details`);
      });
      del.forEach((o) => push(table, "deleted", `removed member ${o.name}`));
    } else if (table === "meals") {
      const byDate = new Map(); // date -> Map(diffText -> [names])
      ch.upserts.forEach((u) => {
        const n = u.row;
        let o = u.prev ? JSON.parse(u.prev) : null;
        if (!o) {
          const m = (db.members || []).find((x) => String(x.id) === String(n.member_id));
          const d = (m && m.defaultMeals) || { breakfast: false, lunch: true, dinner: true };
          o = { breakfast: !!d.breakfast, lunch: !!d.lunch, dinner: !!d.dinner };
        }
        const diff = MEAL_TYPES.filter((t) => !!o[t] !== !!n[t]).map((t) => cap(t) + (n[t] ? " on" : " off")).join(", ");
        if (!diff) return;
        if (!byDate.has(n.date)) byDate.set(n.date, new Map());
        const g = byDate.get(n.date);
        if (!g.has(diff)) g.set(diff, []);
        g.get(diff).push(memberName(n.member_id));
      });
      byDate.forEach((g, date) => {
        const people = Array.from(g.values()).reduce((a, b) => a.concat(b), []);
        if (g.size <= 2) g.forEach((names, diff) => push(table, "updated", `changed meals · ${listNames(names, "members")}: ${diff} · ${fmtDay(date)}`));
        else push(table, "updated", `updated meals for ${people.length} members · ${fmtDay(date)}`);
      });
    } else if (table === "guest_meals") {
      ins.forEach((u) => {
        const r = u.row, q = Number(r.quantity) || 1;
        push(table, "added", `added ${q > 1 ? q + " guest meals" : "a guest meal"} for ${memberName(r.host_member_id)}${r.guest_name ? " (" + r.guest_name + ")" : ""} · ${fmtDay(r.date)} · ${mealsText(r)}`);
      });
      upd.forEach((u) => push(table, "updated", `edited a guest meal for ${memberName(u.row.host_member_id)} · ${fmtDay(u.row.date)} · ${mealsText(u.row)}`));
      del.forEach((o) => push(table, "deleted", `removed a guest meal for ${memberName(o.host_member_id)} · ${fmtDay(o.date)}`));
    } else if (table === "deposits") {
      const carried = ins.filter((u) => u.row.carried_from_month_key);
      if (carried.length) push(table, "added", `carried forward ${carried.length} balance${carried.length > 1 ? "s" : ""} to the new month`);
      ins.filter((u) => !u.row.carried_from_month_key).forEach((u) => push(table, "added", `added ${tk(u.row.amount)} for ${memberName(u.row.member_id)} · ${fmtDay(u.row.date)}`));
      upd.forEach((u) => {
        const o = JSON.parse(u.prev), n = u.row;
        push(table, "updated", o.amount !== n.amount
          ? `edited ${memberName(n.member_id)}'s deposit ${tk(o.amount)} → ${tk(n.amount)}`
          : `edited ${memberName(n.member_id)}'s deposit · ${fmtDay(n.date)}`);
      });
      del.forEach((o) => push(table, "deleted", `deleted ${memberName(o.member_id)}'s deposit of ${tk(o.amount)} · ${fmtDay(o.date)}`));
    } else if (table === "expenses") {
      const items = (r) => {
        const names = (r.items || []).map((i) => i.item).filter(Boolean);
        return names.length ? " · " + names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "") : "";
      };
      ins.forEach((u) => push(table, "added", `added an expense of ${tk(u.row.amount)}${items(u.row)} · ${fmtDay(u.row.date)}`));
      upd.forEach((u) => {
        const o = JSON.parse(u.prev), n = u.row;
        push(table, "updated", o.amount !== n.amount
          ? `edited an expense ${tk(o.amount)} → ${tk(n.amount)}${items(n)} · ${fmtDay(n.date)}`
          : `edited an expense of ${tk(n.amount)}${items(n)} · ${fmtDay(n.date)}`);
      });
      del.forEach((o) => push(table, "deleted", `deleted an expense of ${tk(o.amount)}${items(o)} · ${fmtDay(o.date)}`));
    } else if (table === "shopping_items") {
      const parts = [];
      if (ins.length) parts.push("added " + listNames(ins.map((u) => u.row.item), "items"));
      const bought = upd.filter((u) => JSON.parse(u.prev).checked !== u.row.checked);
      const nowBought = bought.filter((u) => u.row.checked).map((u) => u.row.item);
      if (nowBought.length) parts.push("bought " + listNames(nowBought, "items"));
      const qty = upd.filter((u) => decodeShopQty(JSON.parse(u.prev).quantity).quantity !== decodeShopQty(u.row.quantity).quantity);
      if (qty.length && !ins.length) parts.push("changed quantity of " + listNames(qty.map((u) => u.row.item), "items"));
      const priced = upd.filter((u) => decodeShopQty(JSON.parse(u.prev).quantity).price !== decodeShopQty(u.row.quantity).price);
      if (priced.length && !ins.length) {
        parts.push(priced.length === 1
          ? "price of " + priced[0].row.item + " " + (decodeShopQty(priced[0].row.quantity).price ? tk(decodeShopQty(priced[0].row.quantity).price) : "removed")
          : "changed prices of " + listNames(priced.map((u) => u.row.item), "items"));
      }
      if (del.length) parts.push("removed " + listNames(del.map((o) => o.item), "items"));
      if (parts.length) push(table, "updated", "updated the shopping list: " + parts.join("; "));
    } else if (table === "store_closed_months") {
      ins.forEach((u) => push(table, "updated", `closed the store for ${fmtMonth(u.row.month_key)}`));
      del.forEach((o) => push(table, "updated", `reopened the store for ${fmtMonth(o.month_key)}`));
    } else if (table === "money_closed_months") {
      ins.forEach((u) => push(table, "updated", `closed money for ${fmtMonth(u.row.month_key)}`));
      del.forEach((o) => push(table, "updated", `reopened money for ${fmtMonth(o.month_key)}`));
    } else if (table === "settlements") {
      ch.upserts.forEach((u) => push(table, "updated", `finalized the settlement for ${fmtMonth(u.row.month_key)}`));
      del.forEach((o) => push(table, "deleted", `removed the settlement for ${fmtMonth(o.month_key)}`));
    }
  }
  return out.slice(0, 8);
}

export function emptyDB() {
  const db = {};
  TABLES.forEach((t) => (db[t.coll] = []));
  return db;
}

/* Canonical {key -> {row, json}} map of a collection as it would be stored. */
function serialize(adapter, rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (!r) return;
    const k = adapter.key(r);
    if (map.has(k) && adapter.merge) {
      const merged = adapter.merge(map.get(k).src, r);
      const row = adapter.toDb(merged);
      map.set(k, { src: merged, row, json: JSON.stringify(row) });
    } else {
      const row = adapter.toDb(r);
      map.set(k, { src: r, row, json: JSON.stringify(row) });
    }
  });
  return map;
}

function stableKeyFromDb(adapter, d) {
  return adapter.key(adapter.fromDb(d));
}

/* A save that failed because there was no connection (not because the
   server refused it). Those edits stay on the device and are retried. */
export function isNetworkError(err) {
  if (!err) return false;
  const msg = String((err && (err.message || err.details)) || err);
  return err.name === "TypeError" || /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET|ERR_NETWORK/i.test(msg);
}

export function createSync({ supabase, groupId, onRemoteChange, onStateChange, onError, onActivity }) {
  const db = emptyDB();
  const snapshot = {}; // coll -> Map(key -> json)
  TABLES.forEach((t) => (snapshot[t.coll] = new Map()));

  let fresh = false;
  let state = "idle"; // idle | saving | error | offline
  let timer = null;
  let flushing = null;
  let again = false;
  let channel = null;
  let refreshTimer = null;
  const pendingRefresh = new Set();
  let destroyed = false;

  const setState = (s) => {
    if (state === s) return;
    state = s;
    onStateChange && onStateChange(s);
  };

  async function fetchTable(adapter) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(adapter.table).select("*").eq("group_id", groupId);
      adapter.order.forEach((c) => (q = q.order(c, { ascending: true })));
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  function applyServerRows(adapter, dbRows) {
    const rows = dbRows.map(adapter.fromDb);
    db[adapter.coll] = rows;
    const snap = new Map();
    serialize(adapter, rows).forEach((v, k) => snap.set(k, v.json));
    snapshot[adapter.coll] = snap;
  }

  function sameAsLocal(adapter, dbRows) {
    const current = serialize(adapter, db[adapter.coll]);
    const incoming = serialize(adapter, dbRows.map(adapter.fromDb));
    if (current.size !== incoming.size) return false;
    for (const [k, v] of incoming) {
      const c = current.get(k);
      if (!c || c.json !== v.json) return false;
    }
    return true;
  }

  async function load(tables) {
    const adapters = tables ? tables.map((t) => BY_TABLE[t] || BY_COLL[t]).filter(Boolean) : TABLES;
    const results = await Promise.all(adapters.map(fetchTable));
    // Edits made on this device that the server hasn't got yet (for example
    // made while offline) must survive the reload: take the server rows as
    // the new base, then lay our unsaved edits back on top and save them.
    const pending = new Map();
    computeChanges().forEach((ch) => pending.set(ch.adapter.coll, ch));
    let changed = false;
    let rebased = false;
    adapters.forEach((a, i) => {
      if (!fresh || !sameAsLocal(a, results[i])) changed = true;
      applyServerRows(a, results[i]);
      const p = pending.get(a.coll);
      if (p) {
        const m = serialize(a, db[a.coll]);
        p.upserts.forEach((u) => m.set(u.key, { src: u.src }));
        p.deletes.forEach((d) => m.delete(d.key));
        db[a.coll] = Array.from(m.values()).map((v) => v.src);
        rebased = true;
        changed = true;
      }
    });
    fresh = true;
    if (rebased) {
      clearTimeout(timer);
      timer = setTimeout(flush, 60);
    }
    return changed;
  }

  /* Seed from a cached copy (instant first paint on repeat visits). */
  function hydrate(cached) {
    if (!cached) return;
    const base = cached.__base && typeof cached.__base === "object" ? cached.__base : null;
    TABLES.forEach((t) => {
      if (Array.isArray(cached[t.coll])) {
        db[t.coll] = cached[t.coll];
        const snap = new Map();
        if (base && Array.isArray(base[t.coll])) {
          // what the server had last time we heard from it
          base[t.coll].forEach((pair) => { if (Array.isArray(pair) && pair.length === 2) snap.set(pair[0], pair[1]); });
        } else {
          serialize(t, cached[t.coll]).forEach((v, k) => snap.set(k, v.json));
        }
        snapshot[t.coll] = snap;
      }
    });
    // A cache saved with its server base can be edited straight away, even
    // offline: the edits are diffed against that base and sent later.
    if (base) fresh = true;
  }

  /* Everything needed to carry on later, offline included: the data as this
     device sees it, plus the last server copy so unsaved edits can be found. */
  function exportState() {
    const out = { ...db, __base: {} };
    TABLES.forEach((t) => { out.__base[t.coll] = Array.from(snapshot[t.coll].entries()); });
    return out;
  }

  function computeChanges() {
    const changes = [];
    TABLES.forEach((adapter) => {
      const local = serialize(adapter, db[adapter.coll]);
      const snap = snapshot[adapter.coll];
      const upserts = [];
      const deletes = [];
      local.forEach((v, k) => {
        if (snap.get(k) !== v.json) upserts.push({ key: k, row: v.row, src: v.src, json: v.json, prev: snap.get(k) || null });
      });
      snap.forEach((json, k) => {
        if (!local.has(k)) deletes.push({ key: k, json });
      });
      if (upserts.length || deletes.length) changes.push({ adapter, upserts, deletes });
    });
    return changes;
  }

  function keyObjectFromJson(adapter, json) {
    const row = JSON.parse(json);
    const o = {};
    adapter.keyCols.forEach((c) => (o[c] = row[c]));
    return o;
  }

  async function writeChanges(changes) {
    const touched = [];
    // upserts in declared order (members first), deletes afterwards
    for (const ch of changes) {
      if (!ch.upserts.length) continue;
      const rows = ch.upserts.map((u) => ({ group_id: groupId, ...u.row }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from(ch.adapter.table)
          .upsert(rows.slice(i, i + 500), { onConflict: ["group_id", ...ch.adapter.keyCols].join(",") });
        if (error) throw error;
      }
      ch.upserts.forEach((u) => snapshot[ch.adapter.coll].set(u.key, u.json));
      touched.push(ch.adapter.table);
    }
    for (const ch of changes) {
      if (!ch.deletes.length) continue;
      const a = ch.adapter;
      if (a.keyCols.length === 1) {
        const col = a.keyCols[0];
        const values = ch.deletes.map((d) => keyObjectFromJson(a, d.json)[col]);
        for (let i = 0; i < values.length; i += 200) {
          const { error } = await supabase.from(a.table).delete().eq("group_id", groupId).in(col, values.slice(i, i + 200));
          if (error) throw error;
        }
      } else {
        await Promise.all(
          ch.deletes.map(async (d) => {
            const { error } = await supabase.from(a.table).delete().match({ group_id: groupId, ...keyObjectFromJson(a, d.json) });
            if (error) throw error;
          })
        );
      }
      ch.deletes.forEach((d) => snapshot[a.coll].delete(d.key));
      if (touched.indexOf(a.table) < 0) touched.push(a.table);
    }
    return touched;
  }

  function flush() {
    if (flushing) {
      again = true;
      return flushing;
    }
    flushing = (async () => {
      let allTouched = [];
      let failed = false;
      do {
        again = false;
        const changes = computeChanges();
        if (!changes.length) break;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          // kept on this device; sent automatically when the internet is back
          failed = true;
          setState("offline");
          break;
        }
        setState("saving");
        try {
          const touched = await writeChanges(changes);
          allTouched = allTouched.concat(touched);
          logActivity(changes);
        } catch (err) {
          failed = true;
          const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || isNetworkError(err);
          setState(offline ? "offline" : "error");
          if (!offline) onError && onError(err);
          if (!offline) {
            // Server said no (e.g. permission) — put the screen back to the truth.
            try {
              const changed = await load(changes.map((c) => c.adapter.table));
              if (changed) onRemoteChange && onRemoteChange();
            } catch (e) {
              /* ignore, next focus refresh will retry */
            }
          }
          break;
        }
      } while (again);
      flushing = null;
      if (!failed) setState("idle");
      if (allTouched.length) broadcast(Array.from(new Set(allTouched)));
      if (pendingRefresh.size) scheduleRefresh();
    })();
    return flushing;
  }

  function persist() {
    clearTimeout(timer);
    setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "saving");
    timer = setTimeout(flush, 350);
  }

  function markOffline() {
    setState("offline");
  }

  async function flushNow() {
    clearTimeout(timer);
    await flush();
  }

  function hasPendingWrites() {
    return !!flushing || computeChanges().length > 0;
  }

  const recentLines = new Map(); // "kind|summary" -> time last logged
  let activityOff = false; // the activity_log table isn't there yet (migration 0004 not run)
  function logActivity(changes) {
    if (activityOff) return;
    let lines = [];
    try { lines = describeChanges(changes, db); } catch (e) { lines = []; }
    // typing in a box saves several times — don't repeat the same line within 3 minutes
    const now = Date.now();
    lines = lines.filter((l) => {
      const k = l.kind + "|" + l.summary;
      if (recentLines.has(k) && now - recentLines.get(k) < 180000) return false;
      recentLines.set(k, now);
      return true;
    });
    if (!lines.length) return;
    supabase.from("activity_log").insert(lines.map((l) => ({ group_id: groupId, ...l }))).then(({ error }) => {
      if (error) {
        if (/activity_log|does not exist|schema cache/i.test(error.message || "")) activityOff = true;
        return;
      }
      broadcastEvent("activity");
      onActivity && onActivity();
    });
  }

  /* ---------- realtime ---------- */
  function broadcast(tables) {
    if (!channel) return;
    channel.send({ type: "broadcast", event: "changed", payload: { tables } }).catch(() => {});
  }
  function broadcastEvent(event, payload) {
    if (!channel) return;
    channel.send({ type: "broadcast", event, payload: payload || {} }).catch(() => {});
  }

  function scheduleRefresh(tables) {
    (tables || []).forEach((t) => pendingRefresh.add(t));
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (destroyed) return;
      if (hasPendingWrites()) {
        // our own edits go first; we'll come back once they're saved
        clearTimeout(timer);
        flush();
        return;
      }
      const list = Array.from(pendingRefresh);
      pendingRefresh.clear();
      if (!list.length) return;
      try {
        const changed = await load(list.indexOf("*") >= 0 ? null : list);
        if (changed) onRemoteChange && onRemoteChange();
        if (state === "offline" || state === "error") setState("idle");
      } catch (e) {
        list.forEach((t) => pendingRefresh.add(t));
      }
    }, 250);
  }

  function subscribe(handlers) {
    channel = supabase.channel("mealmate:" + groupId, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "changed" }, (msg) => {
      const tables = (msg.payload && msg.payload.tables) || ["*"];
      scheduleRefresh(tables.filter((t) => BY_TABLE[t] || t === "*"));
    });
    channel.on("broadcast", { event: "membership" }, () => handlers && handlers.onMembership && handlers.onMembership());
    channel.on("broadcast", { event: "activity" }, () => handlers && handlers.onActivity && handlers.onActivity());
    channel.subscribe();
  }

  function refreshAll() {
    scheduleRefresh(["*"]);
  }

  async function importData(data) {
    let count = 0;
    TABLES.forEach((t) => {
      const incoming = Array.isArray(data[t.coll]) ? data[t.coll].filter(Boolean) : [];
      if (!incoming.length) return;
      const merged = serialize(t, db[t.coll]);
      incoming.forEach((r) => {
        try {
          const row = t.toDb(r);
          merged.set(t.key(r), { src: r, row, json: JSON.stringify(row) });
          count++;
        } catch (e) {
          /* skip malformed rows */
        }
      });
      db[t.coll] = Array.from(merged.values()).map((v) => v.src);
    });
    // make sure imported rows read back in canonical form
    await flushNow();
    if (state === "error") throw new Error("IMPORT_FAILED");
    await load();
    return { count };
  }

  function destroy() {
    destroyed = true;
    clearTimeout(timer);
    clearTimeout(refreshTimer);
    if (channel) supabase.removeChannel(channel);
    channel = null;
  }

  return {
    db,
    load,
    hydrate,
    exportState,
    markOffline,
    persist,
    flushNow,
    hasPendingWrites,
    isFresh: () => fresh,
    state: () => state,
    subscribe,
    refreshAll,
    broadcastEvent,
    importData,
    destroy,
  };
}
