// Emulator only: actual callable and scheduled handlers; no real identities.
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { createRequire } = require("node:module");
const backend = createRequire(path.resolve("functions/package.json"));
async function main() {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator required");
  process.env.GCLOUD_PROJECT = "demo-alatheel";
  process.env.FIRESTORE_DATABASE_ID = "(default)";
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "demo-alatheel" });
  const functions = require("../functions/lib/index");
  const { getAuth } = backend("firebase-admin/auth"),
    { getFirestore } = backend("firebase-admin/firestore"),
    { deleteApp, getApp } = backend("firebase-admin/app");
  const { businessDay } = require("../functions/lib/dates"),
    { previousFeedingDay } = require("../functions/lib/feeding");
  const today = businessDay(new Date().toISOString()),
    yesterday = previousFeedingDay(today),
    db = getFirestore();
  const uid = "fifo-backend-admin",
    email = "amjadoh@gmail.com";
  getAuth().getUser = async (id) => {
    assert.equal(id, uid);
    return { uid, email, emailVerified: true, disabled: false };
  };
  const call = (data) =>
    functions.operate.run({
      data,
      auth: {
        uid,
        token: {
          email,
          email_verified: true,
          auth_time: Math.floor(Date.now() / 1000),
          firebase: { sign_in_provider: "google.com" },
        },
      },
    });
  try {
    for (const name of [
      "mealTypes",
      "horses",
      "inventoryTransactions",
      "expenses",
      "expensePayments",
      "financialPeriods",
      "activities",
      "settings",
      "incomes",
    ])
      await db.recursiveDelete(db.collection(name));
    await db
      .doc("users/" + uid)
      .set({
        email,
        displayName: "مدير فحص معزول",
        role: "admin",
        membershipApproved: true,
        disabled: false,
      });
    await db
      .doc("mealTypes/fifo-feed")
      .set({
        name: "شعير اختبار",
        unit: "كجم",
        feedingUnit: "كجم",
        feedingUnitsPerPurchaseUnit: 1,
        pricePerUnit: 10,
        currentStock: 3,
        minThreshold: 0,
        batchCostFrom: yesterday,
        legacyFeedPrice: 10,
        feedBatches: [
          {
            id: "old-lot",
            receivedAt: yesterday + "T00:00:00+03:00",
            quantity: 10,
            remaining: 3,
            valueCents: 10000,
            remainingCents: 3000,
          },
        ],
      });
    const request = {
      action: "stock.purchase",
      id: "fifo-feed",
      clientVersionCode: 22,
      requestId: "fifo_backend_purchase",
      data: {
        amount: 10,
        total: 150,
        paidAt: today,
        method: "cash",
        supplier: "مورد معزول",
        invoiceNumber: "QA-001",
      },
    };
    await assert.rejects(() => call({ ...request, clientVersionCode: 21 }));
    await call(request);
    await call(request);
    await call({ ...request, clientVersionCode: 21 }); // saved receipt still acknowledged
    const getMeal = async () =>
      (await db.doc("mealTypes/fifo-feed").get()).data();
    let meal = await getMeal();
    assert.equal(meal.currentStock, 13);
    assert.equal(
      meal.feedBatches.reduce((n, b) => n + b.remainingCents, 0),
      18000,
    );
    assert.equal(
      (
        await db
          .collection("expenses")
          .where("stockTransactionId", "==", request.requestId)
          .get()
      ).size,
      1,
    );
    assert.equal(
      (
        await db
          .collection("expensePayments")
          .where("stockTransactionId", "==", request.requestId)
          .get()
      ).size,
      1,
    );
    await assert.rejects(() =>
      call({ ...request, requestId: "fifo_backend_duplicate" }),
    );
    // Shift generated fixture receipts back one day to exercise the real daily
    // schedule with yesterday's stock; never alter production document dates.
    meal.feedBatches = meal.feedBatches.map((b) => ({
      ...b,
      receivedAt: yesterday + "T00:00:00+03:00",
    }));
    // Stable IDs order the old lot first when both fixtures share a date.
    meal.feedBatches.find((b) => b.id === "old-lot").receivedAt =
      "2020-01-01T00:00:00Z";
    await db
      .doc("mealTypes/fifo-feed")
      .update({ feedBatches: meal.feedBatches, autoFeedingFrom: yesterday });
    await db
      .doc("horses/fifo-horse")
      .set({
        name: "خيل فحص معزول",
        status: "private",
        entryDate: yesterday,
        feeding: [{ mealTypeId: "fifo-feed", quantity: 5, frequency: "daily" }],
      });
    await functions.synchronizeFeeding.run({});
    await functions.synchronizeFeeding.run({});
    meal = await getMeal();
    assert.equal(meal.currentStock, 8);
    assert.equal(
      meal.feedBatches.reduce((n, b) => n + b.remainingCents, 0),
      12000,
    );
    const movement = (
      await db.doc(`inventoryTransactions/feeding_fifo-feed_${yesterday}`).get()
    ).data();
    assert.equal(movement.breakdown[0].batchCostCents, 6000);
    assert.equal(
      (
        await db
          .collection("expensePayments")
          .where("stockTransactionId", "==", request.requestId)
          .get()
      ).size,
      1,
    );
    console.log(
      "PASS actual purchase callable, duplicate invoice/retry guard, scheduled FIFO feeding twice, intact lot values, and no duplicate cash",
    );
  } finally {
    await deleteApp(getApp());
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
