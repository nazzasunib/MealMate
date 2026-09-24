/** Expense / shopping categories, identical to the legacy EXPENSE_CATEGORIES list. */
export const EXPENSE_CATEGORIES: ReadonlyArray<{ name: string; items: readonly string[] }> = [
  { name: "Fish & Meat", items: ["Chicken", "Beef", "Fish", "Egg"] },
  {
    name: "Vegetables",
    items: ["Potato", "Onion", "Garlic", "Ginger", "Tomato", "Green Chili", "Brinjal", "Cabbage", "Cauliflower", "Other Vegetables"],
  },
  {
    name: "Grocery",
    items: ["Rice", "Dal", "Flour / Atta", "Salt", "Sugar", "Cooking Oil", "Soy Sauce", "Noodles", "Pasta", "Biscuit", "Bread"],
  },
  { name: "Spices", items: ["Turmeric", "Chili Powder", "Cumin", "Coriander", "Garam Masala", "Black Pepper", "Other Spices"] },
  { name: "Fruits", items: ["Banana", "Apple", "Orange", "Guava", "Papaya", "Lemon", "Other Fruits"] },
  {
    name: "Household",
    items: ["Drinking Water", "Tissue", "Dishwashing Liquid", "Detergent", "Garbage Bag", "Soap", "Shampoo", "Toothpaste", "Other Household"],
  },
  /** Catch-all for anything that doesn't fit above. Items are typed in freely. */
  { name: "Others", items: [] },
];

export const CATEGORY_NAMES = EXPENSE_CATEGORIES.map((c) => c.name);

export function itemsForCategory(name: string | null | undefined): readonly string[] {
  return EXPENSE_CATEGORIES.find((c) => c.name === name)?.items ?? [];
}

/** Standard units, identical to the legacy UNIT_OPTIONS. */
export const UNITS = ["kg", "g", "L", "mL", "pcs", "dozen", "packet", "box"] as const;
export type Unit = (typeof UNITS)[number];

export const AVATAR_COLORS = ["#0B1F4B", "#1A3570", "#16A34A", "#B45309", "#7C3AED", "#DC2626"];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** App-wide fallback default when a member has none set (legacy DEFAULT_MEAL_DEFAULTS). */
export const DEFAULT_MEAL_DEFAULTS = { breakfast: false, lunch: true, dinner: true } as const;

/**
 * Categorical chart hues, assigned in this fixed order (never cycled). Validated
 * with the dataviz palette checker on the white surface: all hard checks pass;
 * slots 3–5 are < 3:1 contrast, so every chart ships visible labels/value lists.
 */
export const CHART_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
/** Categories beyond the palette fold into "Other" rather than generating hues. */
export const CHART_OTHER_COLOR = "#98a2b3";
