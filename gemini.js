// Minimal Gemini (Google AI Studio) client - free-tier key, no dependencies.
// Used ONLY for: (1) fallback field extraction when the deterministic parser finds no
// amount, and (2) polishing/translation of reminder text the worker already approved.
// Money-critical fields are re-validated by parser.js after every AI call.
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

function available() { return !!process.env.GEMINI_API_KEY; }

async function post(url, payload) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no_key");
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(url, {
        method: "POST", signal: ac.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload)
      });
      clearTimeout(timer);
      if (!res.ok) { last = new Error("gemini_http_" + res.status); if (res.status === 503 || res.status === 429) continue; throw last; }
      return await res.json();
    } catch (e) { clearTimeout(timer); last = e; }
  }
  throw last;
}

async function generateJSON(prompt) {
  const data = await post("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent", {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
  });
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join("");
  if (!text) throw new Error("gemini_empty");
  return JSON.parse(text);
}

async function generateText(prompt) {
  const data = await post("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent", {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 }
  });
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join("");
  if (!text) throw new Error("gemini_empty");
  return text.trim();
}

module.exports = { available, generateJSON, generateText, MODEL };
