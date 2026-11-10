// Kural Cash - the get-paid agent for people who never had an accounts department.
// Bilingual voice-first invoicing on PayPal Invoicing v2 (sandbox) with a fail-closed
// money policy and an optional Gemini assist. Zero dependencies (Node 18+).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { parseCommand, aiParseCommand, toPayPalDraft, validateCurrency, validateEmail, validateAmount, ISO_CODES } = require("./parser.js");
const { reminderDrafts, ageDays } = require("./reminder.js");
const paypal = require("./paypal.js");
const gemini = require("./gemini.js");

const PORT = process.env.PORT || 8471;
const DB = path.join(__dirname, "db.json");
const MERCHANT_EMAIL = process.env.MERCHANT_EMAIL || "sb-foxd253705723@business.example.com"; // sandbox business identity
const DEMO_RECIPIENT = process.env.DEMO_RECIPIENT || "sb-ieyfh53669720@personal.example.com"; // sandbox personal identity

let db = { invoices: [], nextId: 1 };
try { db = JSON.parse(fs.readFileSync(DB, "utf8")); } catch (e) {}
const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 2));

function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        ai: gemini.available(), aiModel: gemini.MODEL,
        paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
        paypalBase: paypal.BASE, merchant: MERCHANT_EMAIL, demoRecipient: DEMO_RECIPIENT, isoCodes: ISO_CODES
      });
    }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const data = body ? JSON.parse(body) : {};

        // 1) Parse a spoken/typed command into a verifiable draft (never touches PayPal)
        if (req.method === "POST" && url.pathname === "/api/parse") {
          let p = parseCommand(data.text || "");
          if (!p.ok) {
            const ai = await aiParseCommand(data.text || "", gemini);
            if (ai) p = ai;
          }
          if (!p.ok) return json(res, 422, p);
          const draft = toPayPalDraft(p, {});
          return json(res, 200, { parsed: p, draft });
        }

        // 2) Worker verified every field -> create the REAL sandbox draft invoice
        if (req.method === "POST" && url.pathname === "/api/invoices") {
          const p = { ...(data.parsed || {}), client: String(data.client || data.parsed?.client || "Client").slice(0, 60), description: String(data.description || data.parsed?.description || "Services rendered").slice(0, 200) };
          const currency = validateCurrency(data.currency || p.currencyCode);
          const email = validateEmail(data.email || p.email);
          const amount = validateAmount(data.amount || p.amount);
          const draft = toPayPalDraft({ ...p, amount }, { currency, email });
          if (!draft.ready) return json(res, 422, { error: "missing_fields", missing: draft.missing });
          const inv0 = await paypal.createDraft(draft.body);
          const inv = {
            id: db.nextId++, paypalId: inv0.id, client: String(data.client || p.client || "Client").slice(0, 60),
            amount, currency, currencyResolved: true, email, description: String(data.description || p.description || "Services rendered").slice(0, 200),
            utterance: p.raw || null, parseSource: p.source || "deterministic",
            status: inv0.status || "DRAFT", createdAt: new Date().toISOString(), sentAt: null, paidAt: null, reminders: []
          };
          db.invoices.push(inv); save();
          return json(res, 200, { invoice: inv });
        }

        if (req.method === "GET" && url.pathname === "/api/invoices") {
          // sync status from PayPal (best-effort; local record stays authoritative for UI)
          for (const inv of db.invoices) {
            if (!inv.paypalId) continue;
            try {
              const remote = await paypal.getInvoice(inv.paypalId);
              if (remote && remote.status && remote.status !== inv.status) {
                inv.status = remote.status;
                if (["PAID", "MARKED_AS_PAID"].includes(remote.status)) inv.paidAt = new Date().toISOString();
              }
            } catch (e) {}
          }
          save();
          const view = db.invoices.map(i => ({ ...i, ageDays: ["PAID", "MARKED_AS_PAID"].includes(i.status) ? 0 : ageDays(i) }));
          return json(res, 200, { invoices: view });
        }

        const m = url.pathname.match(/^\/api\/invoices\/(\d+)\/(send|remind|paid|reminder-drafts)$/);
        if (m) {
          const inv = db.invoices.find(i => i.id === Number(m[1]));
          if (!inv) return json(res, 404, { error: "not_found" });
          const action = m[2];

          if (req.method === "GET" && action === "reminder-drafts") {
            const d = reminderDrafts(inv);
            if (!d.ok) return json(res, 422, d);
            let aiNote = null;
            if (gemini.available()) {
              try {
                aiNote = await gemini.generateText(
                  "Polish this payment reminder so it is warm, professional and at most 2 sentences. " +
                  "Keep the exact amount, currency and description unchanged. Do not claim the invoice is due, overdue, or late: its due date has not been verified. Language: English. Text: " +
                  JSON.stringify(url.searchParams.get("tone") === "firm" ? d.drafts.firm_en : d.drafts.gentle_en));
              } catch (e) { aiNote = null; }
            }
            return json(res, 200, { ...d, ai_polished: aiNote });
          }
          if (req.method === "POST" && action === "send") {
            if (inv.status !== "DRAFT") return json(res, 422, { error: "not_in_draft", status: inv.status });
            await paypal.sendInvoice(inv.paypalId);
            inv.status = "SENT"; inv.sentAt = new Date().toISOString(); save();
            return json(res, 200, { invoice: inv });
          }
          if (req.method === "POST" && action === "remind") {
            // the worker must approve wording first; the approved text is sent as the reminder note
            const note = String(data.note || "").slice(0, 500);
            if (!note) return json(res, 422, { error: "note_required" });
            await paypal.sendReminder(inv.paypalId, note);
            inv.reminders.push({ note, at: new Date().toISOString() }); save();
            return json(res, 200, { invoice: inv });
          }
          if (req.method === "POST" && action === "paid") {
            await paypal.recordPayment(inv.paypalId, inv.amount, inv.currency);
            const remote = await paypal.getInvoice(inv.paypalId);
            inv.status = remote.status; inv.paidAt = ["PAID", "MARKED_AS_PAID"].includes(remote.status) ? new Date().toISOString() : null; save();
            return json(res, 200, { invoice: inv });
          }
        }

        json(res, 404, { error: "unknown_route" });
      } catch (e) {
        json(res, e.status || 500, { error: e.message, detail: e.detail || undefined });
      }
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log("Kural Cash on http://localhost:" + PORT + " (PayPal: " + paypal.BASE + ", AI: " + (gemini.available() ? gemini.MODEL : "off") + ")"));
