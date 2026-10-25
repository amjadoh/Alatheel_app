import { TERMS } from "./terms";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { State } from "./service";
import { businessDay } from "../functions/src/dates";
import { receiptCash, activeReceipt } from "../functions/src/receipt-cash";
import {
  displayAmount,
  displayMonth,
  displayNumber,
  formatQuantity,
} from "./format";
import {
  financialSummary,
  horseFinance,
  expensePaid,
} from "../functions/src/finance";
import {
  horseCost,
  feedingMeasure,
  feedingUnitPrice,
  monthlyExpense,
  expenseIsShared,
  isFeedPurchase,
} from "./metrics";
export async function exportExcel(
  s: State,
  month: string,
  includeFinancials = false,
) {
  const closed = includeFinancials
    ? s.financialPeriods.find((p) => p.id === month && p.closed)
    : undefined;
  if (closed?.basis) s = { ...s, ...closed.basis };
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
        "السند الأصلي", "سبب التغيير", "تاريخ التغيير", "بواسطة",
        "التسجيل",
        "رسوم الإيواء",
        "التحصيل خلال الشهر",
        "متبقي حتى نهاية الشهر",
        ...(includeFinancials
          ? [
              "التغذية التقديرية",
              "مصروفات التشغيل",
              "إجمالي التكلفة",
              TERMS.expectedOwnerAmount,
              TERMS.operatingResult,
              "اكتمال التكلفة",
            ]
          : []),
      ],
      s.horses.map((h) => {
        const c = horseFinance(s, h, month);
        return [
          h.name,
          h.ownerName,
          h.status,
          h.registrationNum,
          h.boardingFee,
          c.cash,
          c.outstanding,
          ...(includeFinancials
            ? [
                c.food,
                c.other,
                c.total,
                c.revenue,
                c.margin,
                c.complete ? "مكتملة" : c.missing.join("، "),
              ]
            : []),
        ];
      }),
    ],
    [
      "التحصيل",
      [
        "الخيل",
        "المالك",
        "المبلغ",
        "الاستحقاق",
        TERMS.collectionDate,
        "نوع الدفعة",
        TERMS.collectionMethod,
        "رصيد مقدم وقت التسجيل",
        "الملاحظة",
        "الحالة",
      ],
      s.income.map((i) => [
        i.horseName,
        i.ownerName,
        i.amount,
        i.dueDate,
        i.collectedAt,
        (
          {
            partial: "دفع جزئي",
            monthly: "دفع استحقاق الشهر",
            arrears: "دفع متأخرات",
          } as Record<string, string>
        )[i.paymentType] || "تحصيل سابق",
        (
          {
            bank: "تحويل بنكي",
            cash: "نقدي",
            card: "شبكة",
            other: "أخرى",
          } as Record<string, string>
        )[i.method] || "",
        i.advanceAmount || 0,
        i.notes || "",
        i.status === "void" ? "ملغاة" : i.status === "replaced" ? "تم تصحيحها" : i.status,
        i.correctsReceiptId || "", i.changeReason || "", i.changedAt || "", i.changedByName || "",
      ]),
    ],
    [
      "المخزون",
      [
        "الصنف",
        "وحدة الشراء",
        "الرصيد",
        "حد التنبيه",
        "سعر وحدة الشراء",
        "وحدة التغذية",
        "وحدات التغذية في وحدة الشراء",
        "سعر وحدة التغذية",
      ],
      s.mealTypes.map((m) => [
        m.name,
        m.unit,
        m.currentStock,
        m.minThreshold,
        m.pricePerUnit,
        feedingMeasure(m).unit,
        feedingMeasure(m).unitsPerPurchaseUnit,
        feedingUnitPrice(m),
      ]),
    ],
    [
      "المصروفات",
      [
        "المصروف",
        "القيمة لكل تكرار",
        "التكرار",
        "التوزيع",
        "التصنيف",
        `قيمة ${month}`,
      ],
      s.expenses.map((e) => [
        e.name,
        e.cost,
        e.frequency,
        expenseIsShared(e) ? "جميع الخيل النشطة" : "الخيل المحددة",
        isFeedPurchase(s, e)
          ? "شراء علف — خارج تكلفة الاستهلاك"
          : "تشغيل — ضمن التكلفة",
        monthlyExpense(e, month),
      ]),
    ],
  ];
  sheets.push([
    "توزيع الدفعات",
    ["السند", "الخيل", TERMS.collectionDate, "الاستحقاق", "النوع", "المبلغ"],
    s.income.filter(activeReceipt).flatMap((i) =>
      (i.allocations || []).map((x: any) => [
        i.id,
        i.horseName,
        businessDay(i.collectedAt),
        x.dueDate,
        x.kind === "boarding" ? "إيواء" : x.name,
        x.amount,
      ]),
    ),
  ]);
  sheets.push([
    "التحصيل والتسويات",
    ["السند", "الخيل", TERMS.collectionDate, "المبلغ", "النوع", "السند المرتبط"],
    receiptCash(s).map(i => [i.id, i.horseName, businessDay(i.collectedAt), i.amount,
      i.cashAdjustment || i.cashRecognitionAt ? "تسوية تصحيح" : "تحصيل",
      i.sourceReceiptId || i.correctsReceiptId || ""]),
  ]);
  if (includeFinancials)
    sheets.push([
      "برنامج التغذية",
      ["الخيل", "الصنف", "الكمية", "التكرار", "عدد مرات الشهر", "تكلفة الشهر"],
      s.horses.flatMap((h) =>
        horseCost(s, h, month).foodItems.map((x: any) => [
          h.name,
          x.name,
          formatQuantity(x.quantity) + " " + x.unit,
          x.frequency === "monthly" ? "كمية المرة" : "إجمالي يومي",
          x.count,
          x.amount,
        ]),
      ),
    ]);
  if (includeFinancials) {
    const f = financialSummary(s, month);
    sheets.unshift([
      "الملخص المالي",
      ["البيان", "ريال", "الأساس"],
      [
        [TERMS.expectedBoarding, f.expected, "وفق سياسة الإيواء المسجلة وأيام الإقامة"],
        [
          "مصروفات تُسترد من الملاك",
          f.recoveries,
          "مصروفات خاصة مستحقة على الملاك",
        ],
        [TERMS.expectedOwnerTotal, f.revenue, "إيواء ومصروفات تُسترد من الملاك"],
        [
          "تكلفة التشغيل المقدّرة",
          f.total,
          "استهلاك التغذية والتشغيل دون تكرار الشراء",
        ],
        [
          TERMS.operatingResult,
          f.operatingBalance,
          f.incompleteCount
            ? "مبدئي — توجد بيانات تغذية ناقصة"
            : closed
              ? "محفوظ عند إغلاق الشهر"
              : "تقديري ببرنامج الشهر الجاري",
        ],
        ["التحصيل في الشهر", f.collected, "تاريخ التحصيل بتوقيت الرياض"],
        [
          "المدفوعات خلال الشهر",
          f.paid,
          "سداد المصروفات المسجل، باستثناء الملغى",
        ],
        ["مدفوع للمخزون", f.inventoryPaid || 0, "فواتير شراء مسددة"],
        ["مدفوع للرواتب", f.salaryPaid || 0, "سداد فعلي"],
        ["مدفوع لمصروفات أخرى", f.otherPaid ?? f.paid, "سداد فعلي"],
        [
          TERMS.cashDifference,
          f.cashBalance,
          "لا يشمل رصيدًا افتتاحيًا ولا يمثل رصيد البنك",
        ],
        [
          "المتبقي على الملاك",
          f.outstanding,
          "حتى نهاية الشهر، شامل الدورات السابقة",
        ],
        [
          "الالتزامات النقدية المقدّرة",
          f.plannedPayments,
          "تشغيل ومشتريات علف حسب التكرار",
        ],
        [
          "تغطية الالتزامات المتوقعة",
          f.fundingBalance,
          "الإجمالي المتوقع من الملاك ناقص الرواتب والتشغيل ومشتريات العلف حسب التكرار",
        ],
        [
          "مصدر التقرير",
          "",
          closed
            ? "شهر مغلق؛ الأسعار والتفاصيل من أساس الشهر المحفوظ"
            : "شهر مفتوح؛ أرقام مباشرة وقت التصدير",
        ],
      ],
    ]);
    sheets.push([
      "سداد المصروفات",
      [
        "المصروف",
        "المبلغ",
        TERMS.expensePaymentDate,
        "الفترة التي يخصها",
        "الحالة",
        "الملاحظة",
        "سبب الإلغاء",
      ],
      s.expensePayments
        .filter(
          (p) => p.period === month || String(p.paidAt).slice(0, 7) === month,
        )
        .map((p) => [
          p.expenseName,
          p.amount,
          p.paidAt,
          p.period,
          p.status === "void" ? "ملغى" : "مسدد",
          p.notes || "",
          p.voidReason || "",
        ]),
    ]);
    sheets.push([
      "سداد حسب الفترة",
      [
        "المصروف",
        "التزام الفترة",
        "سداد يخص الفترة",
        "المتبقي",
        "الجهة المتحملة",
      ],
      s.expenses.map((e) => [
        e.name,
        monthlyExpense(e, month),
        expensePaid(s, e.id, month),
        Math.max(0, monthlyExpense(e, month) - expensePaid(s, e.id, month)),
        Object.keys(e.allocations || {}).length
          ? "يُسترد من الملاك"
          : "الإسطبل",
      ]),
    ]);
  }
  for (const [name, headers, rows] of sheets) {
    if (!rows.length) continue;
    const sheet = book.addWorksheet(name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(headers);
    rows.forEach((r) => sheet.addRow(r));
    // Retain actual numeric cell values for formulas and sorting. Only their display changes.
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((cell, columnNumber) => {
        if (typeof cell.value !== "number") return;
        const header = headers[columnNumber - 1];
        const unitPrice = header.includes("سعر");
        const monetary =
          /ريال|رسوم|تحصيل|متبقي|تكلفة|مصروفات|إجمالي|الدخل|نتيجة|المبلغ|القيمة|قيمة|مقدم|التزام|سداد|المتبقي/.test(
            header,
          );
        cell.numFmt = unitPrice
          ? "#,##0.00######;-#,##0.00######;0.00"
          : monetary
            ? "#,##0.00;-#,##0.00;0.00"
            : "#,##0.########;-#,##0.########;0";
        cell.alignment = { ...cell.alignment, readingOrder: "ltr" };
      });
    });
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
      `${h.name} | ${h.ownerName || ""} | الرسوم: ${displayAmount(h.boardingFee || 0)} ر.س`,
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
    ctx.fillText(displayMonth(month), 1170, 165);
    rows
      .slice(page * 24, page * 24 + 24)
      .forEach((r, i) => ctx.fillText(r, 1170, 250 + i * 55, 1100));
    ctx.fillText(`صفحة ${displayNumber(page + 1)}`, 1170, 1680);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297);
  }
  await save(pdf.output("blob"), `Alatheel-${month}.pdf`);
}
