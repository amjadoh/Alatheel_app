# Feed purchase and consumption costs

Purchasing stays in Expenses → Inventory purchases. One command creates the
stock movement, paid invoice and payment atomically. Unit price is invoice total
divided by purchase quantity; item definition has no editable price field.
Supplier + invoice number prevents duplicate invoices. A repeated request ID is
idempotent. An identical item/date/quantity/total without an invoice requires an
explicit review confirmation. Existing recurring feed plans remain readable.
New direct feed expenses are rejected so they cannot create a second invoice.
Financial/stock writes require a compatible client (version code 22 or newer).
Already committed request receipts are still acknowledged for older clients, so
an update cannot turn an ambiguous prior success into another charge. This gate
is compatibility metadata, not an authentication mechanism. Existing Android
update checking already requires a published newer Official version to install.
Activation order after all checks: publish the verified Official APK/manifest
first, then deploy `operate`, `synchronizeFeeding` and Firestore rules. No APK,
manifest or function is published by opening a PR or by a successful build.

Each purchase retains its remaining quantity and value in cents. Feeding takes
from the earliest received lot, retaining each lot portion and its cost in the
per-horse daily movement. Same-day horse portions use deterministic horse-ID
order. This is a valuation order; the real store should use oldest stock first.
The feeding plan still determines recorded quantities, with explicit skipped
meals and physical counts. It does not measure food physically eaten.

On transition, a complete unambiguous movement chain can reconstruct remaining
lots. Otherwise existing stock remains explicitly unvalued, with no invented
invoice price. The manager may value each remaining old lot with original date,
quantity, value and reference; this creates no purchase or cash payment. Old
consumed unvalued portions remain incomplete rather than being silently repriced.
Negative stock retains its shortage. A later purchase first covers that shortage
without inventing a retroactive cost for previously unvalued horse portions.

Reports preserve the captured legacy rate for dates before transition and use
recorded lot costs afterwards. Future meals are not reported as already consumed;
the UI explains this, and incomplete periods/unknown lot costs are flagged.
Monthly closed summaries are deep copies. An explicit invoice correction retains
its prior values and updates remaining stock plus recorded portions. Closed-month
totals stay frozen; the cost difference attributable to those horse portions is
recorded in the correction month. Corrections inconsistent with already recorded
quantities are rejected instead of silently creating negative lot stock.

Skipping a recorded meal returns its original lot portions only once. A later
physical count prevents adding those quantities again. Quantity increases without
an invoice are unvalued; decreases consume lots without generating cash payments.

Verification includes the owner's 10 kg/100 → 3 kg/30 → 10 kg/150 example: 13 kg
worth 180; feeding 5 kg costs 60 and leaves 8 kg worth 120. Tests also cover exact
invoice-cent conservation, retries, shortages, skips, corrections, opening values,
closed-period preservation, and real UI flows at 320/390/430 px.
