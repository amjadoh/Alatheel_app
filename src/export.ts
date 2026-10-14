import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { State } from "./service";
import { horseCost } from "./metrics";
export async function exportExcel(s: State, month: string) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "إسطبل الأثيل";
  const sheets: [string, string[], unknown[][]][] = [
    [
      "الخيل",
      [
        "الخيل",
        "المالك",
        "الحالة",
        "التسجيل",
        "رسوم الإيواء",
        "التغذية التقديرية",
        "المصروفات",
        "الإجمالي",
      ],
      s.horses.map((h) => {
        const c = horseCost(s, h, month);
        return [
          h.name,
          h.ownerName,
          h.status,
          h.registrationNum,
          h.boardingFee,
          c.food,
          c.other,
          c.total,
        ];
      }),
    ],
    [
      "التحصيل",
      ["الخيل", "المالك", "المبلغ", "الاستحقاق", "التحصيل"],
      s.income.map((i) => [
        i.horseName,
        i.ownerName,
        i.amount,
        i.dueDate,
        i.collectedAt,
      ]),
    ],
    [
      "المخزون",
      ["الصنف", "الوحدة", "الرصيد", "حد التنبيه", "سعر الوحدة"],
      s.mealTypes.map((m) => [
        m.name,
        m.unit,
        m.currentStock,
        m.minThreshold,
        m.pricePerUnit,
      ]),
    ],
    [
      "المصروفات",
      ["المصروف", "التكلفة", "التكرار"],
      s.expenses.map((e) => [e.name, e.cost, e.frequency]),
    ],
  ];
  for (const [name, headers, rows] of sheets) {
    if (!rows.length) continue;
    const sheet = book.addWorksheet(name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(headers);
    rows.forEach((r) => sheet.addRow(r));
    sheet.columns.forEach((c) => (c.width = 24));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFDFC265" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF171916" },
    };
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: headers.length },
    };
  }
  if (!book.worksheets.length) {
    const sheet = book.addWorksheet("التقرير");
    sheet.addRow(["لا توجد بيانات متاحة"]);
  }
  await save(
    new Blob([(await book.xlsx.writeBuffer()) as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Alatheel-${month}.xlsx`,
  );
}
async function save(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const file = await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ title: "تقرير الأثيل", files: [file.uri] });
  } else {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportPdf(s: State, month: string) {
  await document.fonts.ready;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  const rows = s.horses.map(
    (h) =>
      `${h.name} | ${h.ownerName || ""} | الرسوم: ${h.boardingFee || 0} ر.س`,
  );
  if (!rows.length) rows.push("لا توجد خيل مسجلة");
  for (let page = 0; page < Math.ceil(rows.length / 24); page++) {
    if (page) pdf.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f5f1e7";
    ctx.fillRect(0, 0, 1240, 1754);
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#171916";
    ctx.font = 'bold 48px "Noto Sans Arabic"';
    ctx.fillText("إسطبل الأثيل — تقرير الخيل", 1170, 100);
    ctx.font = '28px "Noto Sans Arabic"';
    ctx.fillText(month, 1170, 165);
    rows
      .slice(page * 24, page * 24 + 24)
      .forEach((r, i) => ctx.fillText(r, 1170, 250 + i * 55, 1100));
    ctx.fillText(`صفحة ${page + 1}`, 1170, 1680);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297);
  }
  await save(pdf.output("blob"), `Alatheel-${month}.pdf`);
}
