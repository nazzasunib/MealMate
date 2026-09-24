import { describe, expect, it } from "vitest";
import {
  calcMealRate,
  computeSettlementRows,
  computeSettlementTransfers,
  computeStockRows,
  countMemberMeals,
  findStockRow,
  spendByMember,
} from "./calculations";

describe("meals", () => {
  const defaults = { breakfast: false, lunch: true, dinner: true };
  it("uses member defaults for days without an override", () => {
    const overrides = new Map([["2026-09-02", { breakfast: true, lunch: true, dinner: true }]]);
    expect(countMemberMeals(defaults, overrides, ["2026-09-01", "2026-09-02", "2026-09-03"])).toBe(2 + 3 + 2);
  });
});

describe("meal rate", () => {
  it("divides expense by meals", () => expect(calcMealRate(900, 30)).toBe(30));
  it("is 0 with no meals", () => expect(calcMealRate(900, 0)).toBe(0));
});

describe("settlement", () => {
  it("computes balances and one transfer for two members", () => {
    const rows = computeSettlementRows(
      [
        { memberId: "a", name: "A", avatarColor: "", pictureUrl: null, paid: 1000, meals: 10 },
        { memberId: "b", name: "B", avatarColor: "", pictureUrl: null, paid: 0, meals: 10 },
      ],
      calcMealRate(1000, 20),
    );
    expect(rows.map((r) => r.balance)).toEqual([500, -500]);
    expect(computeSettlementTransfers(rows)).toEqual([{ from: "B", to: "A", amount: 500 }]);
  });
  it("returns no transfers when settled", () => {
    expect(computeSettlementTransfers([{ name: "A", balance: 0.004 }])).toEqual([]);
  });
});

describe("stock", () => {
  it("sums purchases and carry-ins by (item, unit)", () => {
    const rows = computeStockRows(
      [
        { item: "Rice", unit: "kg", quantity: 5, amount: 400 },
        { item: "Rice", unit: "kg", quantity: 2, amount: 170 },
        { item: "Rice", unit: "g", quantity: 500, amount: 50 },
      ],
      [
        { item: "Rice", unit: "kg", quantity: 3 },
        { item: "Rice", unit: "kg", quantity: -4 },
      ],
    );
    const kg = rows.find((r) => r.unit === "kg")!;
    expect(kg).toMatchObject({ purchased: 7, previousCarryForward: -1, available: 6, purchaseAmount: 570 });
    expect(rows).toHaveLength(2);
    expect(findStockRow(rows, "rice", "KG")?.available).toBe(6);
  });
});

describe("spend by member", () => {
  it("splits shared expenses equally", () => {
    const m = spendByMember([{ amount: 300, buyerIds: ["a", "b"] }, { amount: 100, buyerIds: ["a"] }]);
    expect(m.get("a")).toBe(250);
    expect(m.get("b")).toBe(150);
  });
});
