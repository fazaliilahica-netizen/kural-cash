// Fail-closed policy tests. Run: node tests.js (no network, no credentials).
const assert = require("assert");
const { parseCommand, toPayPalDraft, validateAmount, validateCurrency, validateEmail } = require("./parser.js");
const { reminderDrafts, ageDays } = require("./reminder.js");

let n = 0;
function t(name, fn) { fn(); n++; }

// --- currency is never guessed ---
t("rupee word -> UNRESOLVED, hint only", () => {
  const p = parseCommand("ரமேஷ் க்கு 1500 ரூபாய் அனுப்பு");
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.currencyResolved, false);
  assert.strictEqual(p.currencyCode, null);
  assert.strictEqual(p.currencyFamily, "rupee");
  const d = toPayPalDraft(p);
  assert.strictEqual(d.ready, false);
  assert.ok(d.missing.some(m => /currency/.test(m)));
});
t("dollar word -> UNRESOLVED, hint only", () => {
  const p = parseCommand("invoice Meera 80 dollars logo design");
  assert.strictEqual(p.currencyResolved, false);
  assert.strictEqual(p.currencyFamily, "dollar");
});
t("explicit ISO code resolves", () => {
  const p = parseCommand("invoice Meera 80 CAD logo design");
  assert.strictEqual(p.currencyCode, "CAD");
  assert.strictEqual(p.currencyResolved, true);
});
t("explicit ISO code resolves (Tamil utterance)", () => {
  const p = parseCommand("ரமேஷ் க்கு வெப்சைட் வேலை 1500 CAD அனுப்பு");
  assert.strictEqual(p.currencyCode, "CAD");
});

// --- recipient email is never fabricated ---
t("no email -> blocked", () => {
  const p = parseCommand("invoice Meera 80 CAD logo design");
  const d = toPayPalDraft(p);
  assert.strictEqual(d.ready, false);
  assert.ok(d.missing.some(m => /email/.test(m)));
});
t("real email accepted", () => {
  const p = parseCommand("invoice Meera 80 CAD logo design to meera@example.com");
  const d = toPayPalDraft(p);
  assert.strictEqual(d.ready, true);
  assert.strictEqual(d.body.primary_recipients[0].billing_info.email_address, "meera@example.com");
});

// --- amount validation ---
t("no amount -> error", () => assert.strictEqual(parseCommand("invoice Meera logo design").ok, false));
t("zero -> error", () => assert.strictEqual(parseCommand("invoice Meera 0 CAD x").ok, false));
t("negative-looking -> error", () => assert.strictEqual(parseCommand("invoice Meera -5 CAD x").ok, false));
t("bad grouping 1,50 -> error", () => assert.strictEqual(parseCommand("invoice Meera 1,50 CAD x").ok, false));
t("bad decimals 15.005 -> error", () => assert.strictEqual(parseCommand("invoice Meera 15.005 CAD x").ok, false));
t("good grouping 1,500 kept", () => {
  const p = parseCommand("invoice Meera 1,500 CAD x");
  assert.strictEqual(p.amount, "1500");
});
t("Tamil digits normalized", () => {
  const p = parseCommand("ரமேஷ் க்கு ௧௫௦௦ CAD அனுப்பு a@b.co");
  assert.strictEqual(p.amount, "1500");
});

// --- validators reject AI-style junk (the deterministic layer is the authority) ---
t("validateAmount rejects words", () => assert.strictEqual(validateAmount("lots"), null));
t("validateAmount rejects 1e3 notation", () => assert.strictEqual(validateAmount("1e3"), null));
t("validateCurrency rejects 'dollar'", () => assert.strictEqual(validateCurrency("dollar"), null));
t("validateCurrency rejects unknown ISO", () => assert.strictEqual(validateCurrency("XXX"), null));
t("validateCurrency case-insensitive ISO ok", () => assert.strictEqual(validateCurrency("usd"), "USD"));
t("validateEmail rejects garbage", () => assert.strictEqual(validateEmail("meera at gmail"), null));

// --- English grammar ---
t("english to/for structure", () => {
  const p = parseCommand("send invoice to Arun for 200 USD tutoring");
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.amount, "200");
  assert.strictEqual(p.currencyCode, "USD");
});

// --- reminder engine is fail-closed too ---
t("reminder blocked when currency unresolved", () => {
  const d = reminderDrafts({ id: 1, client: "M", amount: "80", currency: null, currencyResolved: false, email: "m@x.co", description: "logo", createdAt: new Date().toISOString() });
  assert.strictEqual(d.ok, false);
});
t("reminder blocked when email missing", () => {
  const d = reminderDrafts({ id: 1, client: "M", amount: "80", currency: "CAD", currencyResolved: true, email: null, description: "logo", createdAt: new Date().toISOString() });
  assert.strictEqual(d.ok, false);
});
t("reminder uses ONLY stored fields, 4 tones", () => {
  const inv = { id: 1, client: "Meera", amount: "80", currency: "CAD", currencyResolved: true, email: "m@x.co", description: "logo design", createdAt: new Date().toISOString() };
  const d = reminderDrafts(inv);
  assert.strictEqual(d.ok, true);
  ["gentle_en", "firm_en", "gentle_ta", "firm_ta"].forEach(k => {
    assert.ok(d.drafts[k].includes("80 CAD"));
    assert.ok(d.drafts[k].includes("logo design"));
  });
});
t("aging counts from sent/created, 0 when paid", () => {
  const now = Date.now();
  const inv = { createdAt: new Date(now - 3 * 86400000).toISOString() };
  assert.strictEqual(ageDays(inv, now), 3);
  assert.strictEqual(ageDays({ ...inv, paidAt: new Date(now).toISOString() }, now), 0);
});

// --- PayPal body shape ---
t("draft body shape matches Invoicing v2", () => {
  const p = parseCommand("invoice Meera 80 CAD logo design to meera@example.com");
  const d = toPayPalDraft(p);
  assert.strictEqual(d.body.detail.currency_code, "CAD");
  assert.strictEqual(d.body.items[0].unit_amount.value, "80");
  assert.strictEqual(d.body.items.length, 1);
});

console.log(n + "/" + n + " tests passed");
