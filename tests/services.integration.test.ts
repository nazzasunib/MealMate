/**
 * End-to-end service tests against a real PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set. The target DB must already have the
 * migrations applied:  DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 * WARNING: it creates and deletes its own rows — never point it at production.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)("services (integration)", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { currentMonthKey, daysInMonth, shiftMonth } = await import("@/lib/dates");
  const members = await import("@/services/members");
  const meals = await import("@/services/meals");
  const deposits = await import("@/services/deposits");
  const expenses = await import("@/services/expenses");
  const store = await import("@/services/store");
  const settlement = await import("@/services/settlement");
  const account = await import("@/services/account");
  const shopping = await import("@/services/shopping");
  const { importLegacyData } = await import("@/services/legacy-import");
  const { stockKey } = await import("@/lib/calculations");

  const owner = randomUUID();
  const other = randomUUID();
  const importer = randomUUID();
  const month = shiftMonth(currentMonthKey(), -2); // fully elapsed month
  const next = shiftMonth(month, 1);
  const days = daysInMonth(month);
  const d = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  let a = "";
  let b = "";

  beforeAll(async () => {
    for (const [id, name] of [
      [owner, "Owner"],
      [other, "Other"],
      [importer, "Importer"],
    ]) {
      await prisma.profile.create({ data: { id, email: `${id}@test.local`, name } });
    }
    const defaults = { breakfast: false, lunch: true, dinner: true };
    a = (await members.createMember(owner, { name: "Alice", phone: null, email: null, pictureUrl: null, defaultMeals: defaults })).id;
    b = (await members.createMember(owner, { name: "Bob", phone: null, email: null, pictureUrl: null, defaultMeals: defaults })).id;
  });

  afterAll(async () => {
    await prisma.profile.deleteMany({ where: { id: { in: [owner, other, importer] } } });
    await prisma.$disconnect();
  });

  it("resolves default meals plus overrides", async () => {
    await meals.setMeal(owner, a, d(1), "breakfast", true); // +1 for Alice
    const month_ = await meals.getMonthMeals(owner, month);
    expect(month_.find((m) => m.member.id === a)!.total).toBe(days * 2 + 1);
    expect(month_.find((m) => m.member.id === b)!.total).toBe(days * 2);
    const day = await meals.getDayMeals(owner, d(1));
    expect(day.find((r) => r.member.id === a)!.meal).toEqual({ breakfast: true, lunch: true, dinner: true });
  });

  it("computes the settlement like the legacy app", async () => {
    await deposits.createDeposit(owner, { memberId: a, date: d(2), amount: 3000, note: null });
    await expenses.createExpense(owner, {
      date: d(3),
      note: null,
      buyerIds: [a, b],
      items: [
        { category: "Grocery", item: "Rice", quantity: 10, unit: "kg", amount: 800, manualStockRemaining: null },
        { category: "Fish & Meat", item: "Chicken", quantity: 2, unit: "kg", amount: 450, manualStockRemaining: null },
      ],
    });
    const s = await settlement.getSettlementSummary(owner, month);
    const meals_ = days * 4 + 1;
    expect(s.totalBazarCost).toBe(1250);
    expect(s.totalPaid).toBe(3000);
    expect(s.totalMeals).toBe(meals_);
    expect(s.mealRate).toBeCloseTo(1250 / meals_, 10);
    const alice = s.members.find((m) => m.memberId === a)!;
    expect(alice.balance).toBeCloseTo(3000 - (days * 2 + 1) * (1250 / meals_), 6);
    expect(s.transfers).toHaveLength(1);
    expect(s.transfers[0]).toMatchObject({ from: "Bob", to: "Alice" });
  });

  it("tracks stock, manual corrections and store month closing", async () => {
    let stock = await store.getStockSummary(owner, month);
    expect(stock.find((r) => r.item === "Rice")).toMatchObject({ purchased: 10, available: 10 });

    // Buying more rice while saying only 3 kg of the old 10 kg is left.
    await expenses.createExpense(owner, {
      date: d(10),
      note: null,
      buyerIds: [a],
      items: [{ category: "Grocery", item: "Rice", quantity: 5, unit: "kg", amount: 400, manualStockRemaining: 3 }],
    });
    stock = await store.getStockSummary(owner, month);
    expect(stock.find((r) => r.item === "Rice")!.available).toBe(8);

    // Editing stock by hand twice is idempotent.
    await store.setManualStock(owner, month, "Rice", "kg", 6);
    await store.setManualStock(owner, month, "Rice", "kg", 6);
    stock = await store.getStockSummary(owner, month);
    expect(stock.find((r) => r.item === "Rice")!.available).toBe(6);

    await store.closeStoreMonth(owner, month, { [stockKey("Rice", "kg")]: 4, [stockKey("Chicken", "kg")]: 0 });
    await store.closeStoreMonth(owner, month, { [stockKey("Rice", "kg")]: 4, [stockKey("Chicken", "kg")]: 0 }); // re-close
    const carried = await store.getStockSummary(owner, next);
    expect(carried).toEqual([expect.objectContaining({ item: "Rice", previousCarryForward: 4, available: 4 })]);
    expect((await store.listStoreClosings(owner)).map((c) => c.month)).toEqual([month]);
  });

  it("closes the settlement month and carries forward without duplicates", async () => {
    await settlement.closeSettlementMonth(owner, month, { [a]: "carry" });
    await settlement.closeSettlementMonth(owner, month, { [a]: "carry" });
    const nextDeposits = await deposits.listDepositsForMonth(owner, next);
    expect(nextDeposits).toHaveLength(1);
    expect(nextDeposits[0]).toMatchObject({ memberId: a, date: `${next}-01`, carriedFromMonth: month });
    await settlement.closeSettlementMonth(owner, month, { [a]: "paid" });
    expect(await deposits.listDepositsForMonth(owner, next)).toHaveLength(0);
    expect((await settlement.getSettlementClosing(owner, month))!.decisions[0].choice).toBe("paid");
  });

  it("never lets one account touch another account's data", async () => {
    const [dep] = await deposits.listDepositsForMonth(owner, month);
    await expect(deposits.updateDeposit(other, dep.id, { memberId: a, date: d(5), amount: 1, note: null })).rejects.toThrow();
    await expect(deposits.deleteDeposit(other, dep.id)).rejects.toThrow();
    await expect(meals.setMeal(other, a, d(5), "lunch", false)).rejects.toThrow();
    expect(await members.listMembers(other)).toEqual([]);
  });

  it("keeps the shopping list unique per category", async () => {
    await shopping.addShoppingItem(owner, "Grocery", "Salt");
    await shopping.addShoppingItem(owner, "Grocery", "Salt");
    await shopping.addShoppingItem(owner, "Others", "Candles");
    const items = await shopping.listShoppingItems(owner);
    expect(items).toHaveLength(2);
    await shopping.updateShoppingItem(owner, items[0].id, { completed: true, unit: "kg", quantity: "1" });
    expect(await shopping.clearCompletedShoppingItems(owner)).toBe(1);
  });

  it("imports a legacy localStorage backup", async () => {
    const legacy = {
      members: [
        { id: "m1", name: "Rahim", status: "ACTIVE", avatarColor: "#0B1F4B", joinedAt: d(1), defaultMeals: { breakfast: true, lunch: true, dinner: false } },
        { id: "m2", name: "Karim", status: "ACTIVE" },
      ],
      meals: [{ id: "x", memberId: "m1", date: d(2), breakfast: false, lunch: false, dinner: false }],
      deposits: [{ id: "y", memberId: "m2", date: d(3), amount: 500, note: "cash" }],
      expenses: [
        { id: "e1", buyerIds: ["m1"], date: d(4), note: null, amount: 300, items: [{ category: "Grocery", item: "Dal", quantity: 2, unit: "kg", amount: 300 }] },
        { id: "e2", memberId: "m2", date: d(5), amount: 120, item: "Egg", quantity: 12, unit: "pcs" },
      ],
      shoppingList: [{ id: "s", category: "Grocery", item: "Salt", quantity: "1", checked: true }],
      storeCarryForward: [{ item: "Dal", unit: "kg", monthKey: next, fromMonthKey: month, quantity: 1 }],
      storeClosedMonths: [],
      settlements: [],
      moneyClosedMonths: [],
      users: [{ email: "x", password: "y", name: "z" }],
    };
    const summary = await importLegacyData(importer, JSON.stringify(legacy));
    expect(summary).toEqual({ members: 2, meals: 1, deposits: 1, expenses: 2, shoppingItems: 1 });
    const s = await settlement.getSettlementSummary(importer, month);
    expect(s.totalBazarCost).toBe(420);
    expect((await store.getStockSummary(importer, next))[0]).toMatchObject({ item: "Dal", available: 1 });
    await expect(importLegacyData(importer, JSON.stringify(legacy))).rejects.toThrow(/already has data/);
  });

  it("resets all account data", async () => {
    await account.resetAccountData(owner);
    expect(await account.accountHasData(owner)).toBe(false);
    expect(await prisma.profile.count({ where: { id: owner } })).toBe(1);
  });
});
