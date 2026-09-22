const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or our that the their this to we will with you your years year experience strong good knowledge ability able work working'.split(' ')
);

export const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9+#.'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very small suffix-stripping stemmer; enough to match "mentoring" with "mentor". */
export function stem(w) {
  return w.replace(/(ings|ing|ed|es|s|ment|ers|er|ly)$/i, '') || w;
}

export function tokens(s, { keepStop = false } = {}) {
  return normalize(s)
    .split(' ')
    .map((t) => t.replace(/^[.']+|[.']+$/g, ''))
    .filter((t) => t.length > 1 && (keepStop || !STOP.has(t)))
    .map(stem);
}

export function jaccard(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of `needle` tokens that appear in `hay` (0..1). */
export function containment(needle, hay) {
  const N = tokens(needle);
  if (!N.length) return 0;
  const H = new Set(tokens(hay));
  return N.filter((t) => H.has(t)).length / N.length;
}

export const truncate = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function toInt(v, fallback = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}
