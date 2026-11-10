// Live sandbox smoke test - exercises the REAL PayPal sandbox loop end to end.
// Fictional sandbox identities only. Run: node --env-file=.env scripts/sandbox-smoke.js
const paypal = require("../paypal.js");

(async () => {
  const currency = "CAD", amount = "42.00";
  console.log("1) create draft…");
  const draft = await paypal.createDraft({
    detail: { currency_code: currency, note: "Kural Cash smoke test" },
    primary_recipients: [{ billing_info: { name: { full_name: "Sandbox Customer" }, email_address: process.env.DEMO_RECIPIENT || "sb-ieyfh53669720@personal.example.com" } }],
    items: [{ name: "Smoke test service", quantity: "1", unit_amount: { currency_code: currency, value: amount } }]
  });
  console.log("   draft id:", draft.id, "status:", draft.status);

  console.log("2) send…");
  await paypal.sendInvoice(draft.id);
  let inv = await paypal.getInvoice(draft.id);
  console.log("   status:", inv.status);

  console.log("3) remind…");
  await paypal.sendReminder(inv.id, "Smoke test reminder - a friendly note that this invoice is open.");
  console.log("   reminder sent");

  console.log("4) record payment…");
  await paypal.recordPayment(inv.id, amount, currency);
  inv = await paypal.getInvoice(draft.id);
  console.log("   status:", inv.status);

  console.log("SANDBOX LOOP OK");
})().catch(e => { console.error("SMOKE FAIL:", e.message, e.detail ? JSON.stringify(e.detail).slice(0, 400) : ""); process.exit(1); });
