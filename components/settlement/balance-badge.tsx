import { Badge } from "@/components/ui/card";
import { balanceStatus } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";

export function BalanceBadge({ balance }: { balance: number }) {
  const s = balanceStatus(balance);
  if (s === "receive") return <Badge tone="success">Will Receive {formatCurrency(balance)}</Badge>;
  if (s === "pay") return <Badge tone="danger">Needs to Pay {formatCurrency(Math.abs(balance))}</Badge>;
  return <Badge tone="gray">Settled</Badge>;
}

export function signedCurrency(n: number) {
  return (n > 0.004 ? "+" : n < -0.004 ? "−" : "") + formatCurrency(Math.abs(n));
}
