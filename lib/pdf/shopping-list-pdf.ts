import type { ShoppingItemDTO } from "@/types";

/** Clean printable shopping list PDF with date & time, grouped by category (legacy downloadShoppingListFile). */
export async function downloadShoppingListPdf(groups: { category: string; rows: ShoppingItemDTO[] }[], fileDate: string) {
  const { jsPDF } = await import("jspdf");
  const now = new Date();
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;
  const ensure = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(11, 31, 75);
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

  for (const g of groups) {
    ensure(24);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(20, 20, 20);
    pdf.text(g.category, margin, y);
    y += 18;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    for (const row of g.rows) {
      ensure(16);
      // Checkbox square, ticked for completed items.
      pdf.setDrawColor(120, 120, 120);
      pdf.rect(margin + 10, y - 8, 8, 8);
      if (row.completed) {
        pdf.setTextColor(140, 140, 140);
        pdf.line(margin + 11, y - 4, margin + 13.5, y - 1.5);
        pdf.line(margin + 13.5, y - 1.5, margin + 17, y - 7);
      } else {
        pdf.setTextColor(50, 50, 50);
      }
      const qty = [row.quantity, row.unit].filter(Boolean).join(" ");
      pdf.text(row.item + (qty ? `  -  ${qty}` : ""), margin + 26, y);
      y += 16;
    }
    y += 12;
  }
  pdf.save(`shopping-list-${fileDate}.pdf`);
}
