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
    toDb: (r) => ({
      id: String(r.id),
      category: String(r.category || "Grocery"),
      item: String(r.item || ""),
      quantity: String(r.quantity || "").slice(0, 40),
      checked: !!r.checked,
    }),
    fromDb: (d) => ({ id: d.id, category: d.category, item: d.item, quantity: d.quantity || "", checked: !!d.checked }),
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

export function createSync({ supabase, groupId, onRemoteChange, onStateChange, onError }) {
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
    let changed = false;
    adapters.forEach((a, i) => {
      if (!fresh || !sameAsLocal(a, results[i])) changed = true;
      applyServerRows(a, results[i]);
    });
    fresh = true;
    return changed;
  }

  /* Seed from a cached copy (instant first paint on repeat visits). */
  function hydrate(cached) {
    if (!cached) return;
    TABLES.forEach((t) => {
      if (Array.isArray(cached[t.coll])) {
        db[t.coll] = cached[t.coll];
        const snap = new Map();
        serialize(t, cached[t.coll]).forEach((v, k) => snap.set(k, v.json));
        snapshot[t.coll] = snap;
      }
    });
  }

  function computeChanges() {
    const changes = [];
    TABLES.forEach((adapter) => {
      const local = serialize(adapter, db[adapter.coll]);
      const snap = snapshot[adapter.coll];
      const upserts = [];
      const deletes = [];
      local.forEach((v, k) => {
        if (snap.get(k) !== v.json) upserts.push({ key: k, row: v.row, json: v.json });
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
        setState("saving");
        try {
          const touched = await writeChanges(changes);
          allTouched = allTouched.concat(touched);
        } catch (err) {
          failed = true;
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          setState(offline ? "offline" : "error");
          onError && onError(err);
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
    setState("saving");
    timer = setTimeout(flush, 350);
  }

  async function flushNow() {
    clearTimeout(timer);
    await flush();
  }

  function hasPendingWrites() {
    return !!flushing || computeChanges().length > 0;
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
