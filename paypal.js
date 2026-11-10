// PayPal Invoicing v2 sandbox client - no dependencies.
// ALL calls go to api-m.sandbox.paypal.com: fictional test identities only,
// nothing real is ever emailed, charged or owed.
const BASE = process.env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";
let cached = { token: null, exp: 0 };

async function token() {
  if (cached.token && Date.now() < cached.exp - 30000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("no_paypal_credentials");
  const res = await fetch(BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(id + ":" + sec).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error("paypal_auth_http_" + res.status + " " + (await res.text()).slice(0, 200));
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 300) * 1000 };
  return cached.token;
}

async function api(method, path, body) {
  const t = await token();
  const res = await fetch(BASE + path, {
    method,
    headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json", "Prefer": "return=representation" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error("paypal_http_" + res.status);
    err.status = res.status; err.detail = data;
    throw err;
  }
  return data;
}

const createDraft = (body) => api("POST", "/v2/invoicing/invoices", body);
const getInvoice = (id) => api("GET", "/v2/invoicing/invoices/" + encodeURIComponent(id));
const sendInvoice = (id) => api("POST", "/v2/invoicing/invoices/" + encodeURIComponent(id) + "/send", { send_to_invoicer: true });
const sendReminder = (id, note) => api("POST", "/v2/invoicing/invoices/" + encodeURIComponent(id) + "/remind", {
  subject: "Payment reminder", note: note || "A friendly reminder that this invoice is still open.", send_to_invoicer: true
});
const recordPayment = (id, amount, currency) => api("POST", "/v2/invoicing/invoices/" + encodeURIComponent(id) + "/payments", {
  payment_date: new Date().toISOString().slice(0, 10), method: "OTHER", amount: { currency_code: currency, value: amount }
});
const cancelSent = (id) => api("POST", "/v2/invoicing/invoices/" + encodeURIComponent(id) + "/cancel", {
  subject: "Invoice cancelled", note: "Cancelled by the sender.", send_to_invoicer: false, send_to_recipient: false
});

module.exports = { createDraft, getInvoice, sendInvoice, sendReminder, recordPayment, cancelSent, BASE };
