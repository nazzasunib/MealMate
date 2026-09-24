/**
 * Plain, serialisable shapes passed from server components/services to the UI.
 * Prisma Decimals are converted to numbers and DATE columns to "YYYY-MM-DD".
 */

export type MemberStatus = "ACTIVE" | "INACTIVE";

export interface MealDefaults {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface MemberDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pictureUrl: string | null;
  avatarColor: string;
  status: MemberStatus;
  defaultMeals: MealDefaults;
  joinedAt: string;
}

export interface MealDay extends MealDefaults {
  date: string;
  /** true when a saved override exists; false when the member default applied. */
  overridden: boolean;
}

export interface DepositDTO {
  id: string;
  memberId: string;
  date: string;
  amount: number;
  note: string | null;
  carriedFromMonth: string | null;
}

export interface ExpenseItemDTO {
  category: string | null;
  item: string;
  quantity: number | null;
  unit: string | null;
  amount: number;
}

export interface ExpenseDTO {
  id: string;
  date: string;
  amount: number;
  note: string | null;
  buyerIds: string[];
  items: ExpenseItemDTO[];
  createdAt: string;
}

export interface ShoppingItemDTO {
  id: string;
  category: string;
  item: string;
  quantity: string | null;
  unit: string | null;
  completed: boolean;
}

export interface StockRow {
  item: string;
  unit: string;
  purchased: number;
  purchaseAmount: number;
  previousCarryForward: number;
  available: number;
}

export interface StoreClosedRow {
  item: string;
  unit: string;
  purchased: number;
  previousCarryForward: number;
  available: number;
  remaining: number;
}

export interface StoreClosingDTO {
  month: string;
  closedAt: string;
  rows: StoreClosedRow[];
  totals: { purchased: number; previousCarryForward: number; available: number; remaining: number };
}

export interface SettlementMemberRow {
  memberId: string;
  name: string;
  avatarColor: string;
  pictureUrl: string | null;
  paid: number;
  meals: number;
  mealCost: number;
  balance: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementSummary {
  month: string;
  totalBazarCost: number;
  totalPaid: number;
  totalMeals: number;
  mealRate: number;
  memberCount: number;
  members: SettlementMemberRow[];
  transfers: Transfer[];
}

export type CarryChoice = "paid" | "carry";

export interface SettlementClosingDTO {
  month: string;
  finalizedAt: string;
  decisions: { memberId: string; name: string; balance: number; choice: CarryChoice }[];
}

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string };
