// Get-paid agent: aging + worker-approved reminder drafts. Fail-closed like the invoice path:
// a reminder is never drafted when currency is unresolved or the recipient is unknown,
// and amounts/currency are inserted ONLY from the stored invoice record - never re-parsed or invented.
const TONES = {
  gentle: {
    en: (v) => `Hi ${v.client}, just a gentle note that the invoice for "${v.description}" (${v.amount} ${v.currency}) is still open. No rush - thank you!`,
    ta: (v) => `வணக்கம் ${v.client}, "${v.description}" இன்வாய்ஸ் (${v.amount} ${v.currency}) இன்னும் நிலுவையில் உளது. அவசரமில்லை - நன்றி!`
  },
  firm: {
    en: (v) => v.ageDays > 0 ? `Hello ${v.client}, the invoice for "${v.description}" (${v.amount} ${v.currency}) is ${v.ageDays} day(s) overdue. Please arrange payment this week. Thank you.` : `Hello ${v.client}, the invoice for "${v.description}" (${v.amount} ${v.currency}) is now due. Please arrange payment this week. Thank you.`,
    ta: (v) => v.ageDays > 0 ? `வணக்கம் ${v.client}, "${v.description}" இன்வாய்ஸ் (${v.amount} ${v.currency}) ${v.ageDays} நாட்கள் தாமதமாகி உளது. இந்த வாரம் செலுத்த ஏற்பாடு செய்யவும். நன்றி.` : `வணக்கம் ${v.client}, "${v.description}" இன்வாய்ஸ் (${v.amount} ${v.currency}) இப்போது செலுத்த வேண்டியது. இந்த வாரம் ஏற்பாடு செய்யவும். நன்றி.`
  }
};
function ageDays(invoice, now) {
  const t0 = new Date(invoice.paidAt || invoice.sentAt || invoice.createdAt).getTime();
  return Math.max(0, Math.floor(((now || Date.now()) - t0) / 86400000));
}
function reminderDrafts(invoice, now) {
  if (!invoice.currencyResolved) return { ok: false, error: "currency_unresolved", id: invoice.id };
  if (!invoice.email) return { ok: false, error: "recipient_email_required", id: invoice.id };
  const v = { client: invoice.client, description: invoice.description, amount: invoice.amount, currency: invoice.currency, ageDays: ageDays(invoice, now) };
  return {
    ok: true, id: invoice.id, to: invoice.email, ageDays: v.ageDays,
    drafts: { gentle_en: TONES.gentle.en(v), firm_en: TONES.firm.en(v), gentle_ta: TONES.gentle.ta(v), firm_ta: TONES.firm.ta(v) }
  };
}
module.exports = { reminderDrafts, ageDays };
