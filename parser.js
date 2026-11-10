// Bilingual (Tamil+English) invoice-command parser with an optional AI (Gemini) fallback.
//
// SAFETY SPINE (fail-closed, verified by tests.js):
// - Currency is NEVER guessed. Family words (dollar/டாலர் = CAD-or-USD ambiguous;
//   rupee/ரூபாய் = INR-or-LKR ambiguous) only set a hint. Currency resolves ONLY on an
//   explicit ISO code or the worker's own pick in the draft UI.
// - Recipient email is NEVER fabricated. Drafts without one are flagged
//   recipient_email_required and no PayPal call is made.
// - Amounts must be well-formed positive numbers; bad grouping/decimals are rejected.
// - AI output passes through THE SAME validators below. The deterministic layer is the
//   authority: if the AI proposes an amount, currency or email that fails validation,
//   the field stays UNRESOLVED and the worker is asked.
const TA_DIGITS = { "௦": "0", "௧": "1", "௨": "2", "௩": "3", "௪": "4", "௫": "5", "௬": "6", "௭": "7", "௮": "8", "௯": "9" };
function normDigits(s) { return s.replace(/[௦-௯]/g, d => TA_DIGITS[d] || d); }

const ISO_CODES = ["USD", "CAD", "INR", "LKR", "EUR", "GBP", "AUD", "SGD"];
const ISO = new RegExp("^(" + ISO_CODES.join("|") + ")$", "i");
const RUPEE = /^(rupees?|rs\.?|ரூபாய்|ரூ)$/i;
const DOLLAR = /^(dollars?|டாலர்)$/i;
const STOP = new Set(["send", "to", "for", "bhejo", "invoice", "அனுப்பு", "இன்வாய்ஸ்", "க்கு", "க்காக", "ko", "please", "தயவுசெய்து", "a", "an", "the"]);
const AMOUNT_RE = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isNum = t => AMOUNT_RE.test(t);
const isMoneyWord = t => ISO.test(t) || RUPEE.test(t) || DOLLAR.test(t);
const isStop = t => STOP.has(t.toLowerCase());

function validateAmount(a) {
  const s = String(a == null ? "" : a).replace(/,/g, "");
  if (!AMOUNT_RE.test(String(a == null ? "" : a)) && !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  if (!(parseFloat(s) > 0)) return null;
  return s;
}
function validateCurrency(c) {
  if (!c) return null;
  const up = String(c).toUpperCase();
  return ISO.test(up) ? up : null;
}
function validateEmail(e) { return e && EMAIL_RE.test(String(e).trim()) ? String(e).trim() : null; }

function parseCommand(raw) {
  const text = normDigits(String(raw || "").trim());
  const toks = text.split(/\s+/).filter(Boolean);
  const amtIdx = toks.findIndex(isNum);
  if (amtIdx < 0) return { ok: false, error: "no_amount", raw: text };
  const amount = validateAmount(toks[amtIdx]);
  if (!amount) return { ok: false, error: "nonpositive_amount", raw: text };
  const isoTok = toks.find(t => ISO.test(t));
  const currencyCode = isoTok ? isoTok.toUpperCase() : null;
  const currencyFamily = toks.some(t => DOLLAR.test(t)) ? "dollar"
    : toks.some(t => RUPEE.test(t)) ? "rupee" : null;
  const email = toks.find(t => EMAIL_RE.test(t)) || null;
  let client = "Client";
  let ki = toks.findIndex(t => t === "க்கு" || t.toLowerCase() === "ko");
  if (ki > 0) {
    const c = [];
    for (let j = ki - 1; j >= 0 && c.length < 2; j--) {
      if (isStop(toks[j]) || isNum(toks[j]) || isMoneyWord(toks[j])) break;
      c.unshift(toks[j]);
    }
    if (c.length) client = c.join(" ");
  } else {
    const ti = toks.findIndex(t => t.toLowerCase() === "to");
    if (ti >= 0 && ti + 1 < toks.length) {
      const c = [];
      for (let j = ti + 1; j < toks.length && c.length < 2; j++) {
        if (isStop(toks[j]) || isNum(toks[j]) || isMoneyWord(toks[j])) break;
        c.push(toks[j]);
      }
      if (c.length) client = c.join(" ");
    }
  }
  let desc = "";
  let di = toks.findIndex(t => t === "க்காக");
  if (di > 0) {
    const d = [];
    for (let j = di - 1; j >= 0; j--) {
      if (isNum(toks[j]) || isMoneyWord(toks[j])) break;
      if (toks[j] === "க்கு" || toks[j].toLowerCase() === "ko") break;
      d.unshift(toks[j]);
    }
    desc = d.join(" ");
  }
  if (!desc) {
    const fi = toks.findIndex(t => t.toLowerCase() === "for");
    if (fi >= 0) {
      const d = [];
      for (let j = fi + 1; j < toks.length; j++) {
        if (["invoice", "இன்வாய்ஸ்", "அனுப்பு", "bhejo", "send"].includes(toks[j].toLowerCase())) break;
        if (isNum(toks[j]) || isMoneyWord(toks[j])) continue;
        d.push(toks[j]);
      }
      desc = d.join(" ");
    }
  }
  if (!desc) {
    const clientToks = new Set(client.toLowerCase().split(" "));
    desc = toks.filter(t => !isNum(t) && !isMoneyWord(t) && !isStop(t) && !clientToks.has(t.toLowerCase()) && t !== email).join(" ");
  }
  desc = desc.replace(/\s+/g, " ").trim();
  if (!desc) desc = "Services rendered";
  return { ok: true, client, amount, currencyCode, currencyFamily, currencyResolved: !!currencyCode, email, description: desc, raw: text, source: "deterministic" };
}

// --- AI fallback (Gemini). The model may ONLY propose fields; validators decide. ---
// Returns null when no key is configured or anything fails - caller keeps the deterministic result.
async function aiParseCommand(raw, gemini) {
  if (!gemini || !gemini.available()) return null;
  const prompt = [
    "You extract invoice fields from a worker's short message in any language (often Tamil or Tanglish).",
    "Return STRICT JSON with keys: client (string name or null), amount (string number or null),",
    "currency (ISO 4217 code like USD/CAD/INR/LKR, or null if not explicitly stated - words like",
    "'dollar' or 'rupee' are ambiguous and must return null), email (string or null),",
    "description (short English string), description_original (short string in the worker's language).",
    "Never invent values. If unsure, use null. Message: " + JSON.stringify(String(raw || ""))
  ].join(" ");
  let obj;
  try { obj = await gemini.generateJSON(prompt); } catch (e) { return null; }
  if (!obj || typeof obj !== "object") return null;
  const amount = validateAmount(obj.amount);
  if (!amount) return null; // fail-closed: no trustworthy amount, no draft
  const currencyCode = validateCurrency(obj.currency);
  const email = validateEmail(obj.email);
  const client = (typeof obj.client === "string" && obj.client.trim()) ? obj.client.trim().slice(0, 60) : "Client";
  const description = (typeof obj.description === "string" && obj.description.trim()) ? obj.description.trim().slice(0, 200) : "Services rendered";
  return {
    ok: true, client, amount, currencyCode,
    currencyFamily: currencyCode ? null : (/rupee/i.test(String(raw)) || /ரூபாய்/.test(String(raw)) ? "rupee" : (/dollar/i.test(String(raw)) || /டாலர்/.test(String(raw)) ? "dollar" : null)),
    currencyResolved: !!currencyCode, email, description, raw: String(raw || ""), source: "ai"
  };
}

// Build the exact PayPal Invoicing v2 create-draft body. FAIL-CLOSED: refuses unless
// currency is resolved and a real recipient email is supplied.
function toPayPalDraft(p, opts) {
  const currency = validateCurrency((opts && opts.currency) || p.currencyCode);
  const email = validateEmail((opts && opts.email) || p.email);
  const missing = [];
  if (!currency) missing.push("currency (unresolved" + (p.currencyFamily ? " - heard '" + p.currencyFamily + "', confirm ISO code" : "") + ")");
  if (!email) missing.push("recipient email");
  if (missing.length) return { ready: false, missing };
  const amount = validateAmount(p.amount);
  if (!amount) return { ready: false, missing: ["amount"] };
  return {
    ready: true, body: {
      detail: { currency_code: currency, note: "Created by Kural Cash voice agent" },
      invoicer: (opts && opts.invoicer) || undefined,
      primary_recipients: [{ billing_info: { name: { full_name: p.client }, email_address: email } }],
      items: [{ name: String(p.description || "Services rendered").slice(0, 200), quantity: "1", unit_amount: { currency_code: currency, value: amount } }]
    }
  };
}

module.exports = { parseCommand, aiParseCommand, toPayPalDraft, validateAmount, validateCurrency, validateEmail, ISO_CODES };
