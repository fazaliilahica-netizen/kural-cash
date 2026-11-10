# Kural Cash

**The get-paid agent for people who never had an accounts department.**

A bilingual (Tamil + English) voice-first invoicing agent built on the **PayPal Invoicing v2 API**
with explicit review of **the amount, currency and recipient before PayPal actions.**
An AI model (Google Gemini) helps it understand free-form speech in any language - but the
deterministic safety layer always has the final word on money.

Built for the **PayPal AI Hackathon** (submission deadline Nov 12, 2026).

## The problem

A newcomer freelancer can do the work in any language. Getting paid lives in English forms,
currency guesswork, and awkward chasing. The people who most need an accounts department
have never had one.

## What it does

The whole after-the-job money loop, in the worker's own language:

1. **Speak or type the invoice** - Tamil or English (or mixed). Voice input via the browser's
   SpeechRecognition, or type. Example: `ரமேஷ் அண்ணாக்கு வெப்சைட் வேலைக்கு ஆயிரத்து ஐநூறு ரூபாய்`
   ("1,500 rupees to Ramesh for the website work").
2. **Verify every field** - the agent shows exactly what it heard. Ambiguities stay unresolved:
   "rupee" could be INR or LKR, "dollar" could be CAD or USD - the worker picks. No recipient
   email heard? It asks instead of inventing one.
3. **Create + send on PayPal** - one tap creates a real invoice through PayPal Invoicing v2
   (this repo runs against the free **sandbox**, so demo money is fictional).
4. **Follow up on open invoices** - an aging "who owes me" view, with reminder drafts in four tones
   (gentle/firm x English/Tamil) plus an optional AI-polished variant. The worker approves the
   exact wording before anything goes out.
5. **Record payment** - when the money arrives, one tap records it on the invoice.

## The safety model (fail-closed by design)

| Rule | Enforced by |
| --- | --- |
| Currency is never guessed from words like "dollar"/"rupee" | `parser.js` + `tests.js` |
| Recipient email is never fabricated | `parser.js` + `tests.js` |
| Amounts must be well-formed positive decimals | `parser.js` + `tests.js` |
| AI output passes through the same validators - the model can only *propose*, the deterministic layer *decides* | `aiParseCommand` in `parser.js` |
| Reminders quote only stored invoice fields; the worker approves wording before sending | `reminder.js`, `server.js` |

AI-derived amounts are proposals, not proven interpretations. Review the amount against the original utterance. Currency and email are taken only from literal input or an explicit user selection. Invoice age does not establish a due date; reminder templates make no due/overdue claim.

Scope of these claims: verified under the repository's test suite (`npm test`), which is a
finite set of cases, not a guarantee for arbitrary input.

## Run it (5 minutes, zero cost)

Requires Node 22+ and a free PayPal Developer account.

```bash
# 1. Get free sandbox credentials:
#    https://developer.paypal.com/dashboard/applications/sandbox  (a "Default Application"
#    with a client ID + secret is auto-created for you)
# 2. Configure:
cp .env.example .env     # fill in your OWN sandbox client ID/secret (never commit .env)
# 3. Optional AI assist - free Gemini API key:
#    https://aistudio.google.com/api-keys  -> put it in .env as GEMINI_API_KEY
#    (without a key the app still works; the deterministic parser runs alone)
# 4. Go:
npm start                # -> http://localhost:8471
```

Run the safety test suite (no network, no credentials):

```bash
npm test                 # 30/30 fail-closed policy tests
```

Run the live sandbox loop (creates -> sends -> reminds -> records payment on a fictional
sandbox invoice):

```bash
npm run smoke
```

### Configuration (`.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | yes | your own **sandbox** REST app credentials |
| `GEMINI_API_KEY` | no | free-tier Gemini key for the AI assist |
| `GEMINI_MODEL` | no | defaults to `gemini-3-flash-preview` |
| `MERCHANT_EMAIL` | no | your sandbox business test identity (default: the demo seed) |
| `DEMO_RECIPIENT` | no | your sandbox personal test identity (default: the demo seed) |
| `PORT` | no | default 8471 |

All PayPal calls go to `api-m.sandbox.paypal.com`. Sandbox invoices go to fictional
`*.example.com` test identities that PayPal auto-creates; nothing real is ever emailed,
charged or owed.

## How the AI is used (hackathon disclosure)

- **Gemini (free tier)** does two jobs: (1) extract invoice fields from free-form utterances
  the deterministic parser cannot handle (e.g. numbers spoken as Tamil words), returning
  strict JSON that is then re-validated field by field; (2) polish/translate reminder wording
  that the worker then approves. Model: `gemini-3-flash-preview`.
- The deterministic bilingual parser remains the authority on every money-critical field.
- On the Gemini free tier, prompt content may be used by Google to improve its products;
  demo content is fictional.

## Architecture

Zero runtime dependencies - plain Node `http` + `fetch`:

```
index.html    single-page UI (voice input, field verification, aging view, chase flow)
server.js     JSON API + static host; all PayPal writes go through here
parser.js     bilingual tokenizer, validators, PayPal draft body builder (fail-closed)
gemini.js     minimal Gemini client (optional; graceful when no key)
paypal.js     OAuth + Invoicing v2: create / send / remind / record payment / sync
reminder.js   aging + four-tone reminder drafts from stored fields only
tests.js      30 fail-closed policy tests (no network)
scripts/sandbox-smoke.js   live end-to-end sandbox loop
```

## Demo video

(Link added at submission time.)

## License

MIT - see [LICENSE](LICENSE).
