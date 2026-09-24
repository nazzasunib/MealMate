-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "pictureUrl" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#0B1F4B',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultBreakfast" BOOLEAN NOT NULL DEFAULT false,
    "defaultLunch" BOOLEAN NOT NULL DEFAULT true,
    "defaultDinner" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealEntry" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "breakfast" BOOLEAN NOT NULL,
    "lunch" BOOLEAN NOT NULL,
    "dinner" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "carriedFromMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseItem" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "item" TEXT NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseBuyer" (
    "expenseId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "ExpenseBuyer_pkey" PRIMARY KEY ("expenseId","memberId")
);

-- CreateTable
CREATE TABLE "ShoppingListItem" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" TEXT,
    "unit" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCarryForward" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCarryForward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMonthClosing" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "StoreMonthClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementClosing" (
    "id" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,

    CONSTRAINT "SettlementClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- CreateIndex
CREATE INDEX "Member_ownerId_status_idx" ON "Member"("ownerId", "status");

-- CreateIndex
CREATE INDEX "MealEntry_ownerId_date_idx" ON "MealEntry"("ownerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MealEntry_memberId_date_key" ON "MealEntry"("memberId", "date");

-- CreateIndex
CREATE INDEX "Deposit_ownerId_date_idx" ON "Deposit"("ownerId", "date");

-- CreateIndex
CREATE INDEX "Deposit_ownerId_carriedFromMonth_idx" ON "Deposit"("ownerId", "carriedFromMonth");

-- CreateIndex
CREATE INDEX "Expense_ownerId_month_idx" ON "Expense"("ownerId", "month");

-- CreateIndex
CREATE INDEX "Expense_ownerId_date_idx" ON "Expense"("ownerId", "date");

-- CreateIndex
CREATE INDEX "ExpenseItem_expenseId_idx" ON "ExpenseItem"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingListItem_ownerId_category_item_key" ON "ShoppingListItem"("ownerId", "category", "item");

-- CreateIndex
CREATE INDEX "StockCarryForward_ownerId_month_idx" ON "StockCarryForward"("ownerId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "StockCarryForward_ownerId_month_item_unit_source_key" ON "StockCarryForward"("ownerId", "month", "item", "unit", "source");

-- CreateIndex
CREATE UNIQUE INDEX "StoreMonthClosing_ownerId_month_key" ON "StoreMonthClosing"("ownerId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementClosing_ownerId_month_key" ON "SettlementClosing"("ownerId", "month");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealEntry" ADD CONSTRAINT "MealEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBuyer" ADD CONSTRAINT "ExpenseBuyer_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseBuyer" ADD CONSTRAINT "ExpenseBuyer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCarryForward" ADD CONSTRAINT "StockCarryForward_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreMonthClosing" ADD CONSTRAINT "StoreMonthClosing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementClosing" ADD CONSTRAINT "SettlementClosing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Security: Supabase exposes the public schema through its REST/Data API
-- using the public anon key. MealMate only reads/writes these tables from the
-- server via Prisma (which connects as the `postgres` role and bypasses RLS),
-- so enable RLS with NO policies: the anon/authenticated API roles get no access.
-- ---------------------------------------------------------------------------
ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MealEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseBuyer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShoppingListItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCarryForward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreMonthClosing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementClosing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
