import { normalize, containment } from '../lib/text.js';

/**
 * Deterministic checks that keep the model honest about the job description.
 * A requirement survives only if the posting actually contains it, and its must/nice
 * priority is read from the posting's own wording where the posting is explicit.
 */

const NICE_INLINE = /\b(nice[- ]to[- ]have|bonus( points)?|is a (big )?plus|are a plus|would be (a )?(plus|great|nice|bonus)|preferred|desirable|ideally|not required|optional|extra credit|good to have)\b/i;
const MUST_INLINE = /\b(required|must[- ]have|must|mandatory|essential|at least \d|minimum( of)? \d)\b/i;

const NICE_HEADER = /^(#+\s*)?(nice[- ]to[- ]haves?|bonus|bonus points|preferred( qualifications| skills)?|pluses|plus|extra credit|good to have|desirable|ideally|it'?s a plus|even better|nice if you have)\b/i;
const MUST_HEADER = /^(#+\s*)?(requirements?|required( qualifications| skills)?|must[- ]haves?|minimum qualifications|basic qualifications|qualifications|what you('ll)? need|what we('re| are) looking for|who you are|about you|you should have)\b|^(#+\s*)?(you have|you'll have|skills|experience|skills (and|&) experience)\s*:?$/i;
const OTHER_HEADER = /^(#+\s*)?(responsibilities|what you('ll)? do|the role|about (the role|us|the company|the team)|benefits|perks|why join|our stack|how to apply|compensation)\b/i;

export const splitLines = (jd) => String(jd).replace(/\r/g, '').split('\n');

function stripBullet(l) {
  return l.replace(/^\s*([-*•·▪◦‣–]|\d+[.)])\s*/, '').trim();
}

export function isHeadingLine(line) {
  const l = line.trim();
  if (!l) return false;
  if (/^#{1,6}\s/.test(l)) return true;
  if (/^[-*•·▪◦‣–]|^\d+[.)]\s/.test(l)) return false;
  const words = l.replace(/:$/, '').split(/\s+/).length;
  if (l.endsWith(':') && l.length <= 80) return true;
  return words <= 6 && (NICE_HEADER.test(l) || MUST_HEADER.test(l) || OTHER_HEADER.test(l));
}

/** Classify a heading line: 'nice' | 'must' | 'other' | null(not a heading). */
export function headingKind(line) {
  if (!isHeadingLine(line)) return null;
  const l = line.trim().replace(/:$/, '');
  if (NICE_HEADER.test(l) || NICE_INLINE.test(l)) return 'nice';
  if (MUST_HEADER.test(l) || MUST_INLINE.test(l)) return 'must';
  return 'other';
}

/**
 * Find the posting line that best supports a piece of evidence text.
 * Returns { line, score } where score is the share of evidence tokens found (0..1).
 */
export function locateEvidence(jd, evidence) {
  const lines = splitLines(jd);
  const ev = normalize(evidence);
  if (!ev) return { line: -1, score: 0 };
  let best = { line: -1, score: 0 };
  for (let i = 0; i < lines.length; i++) {
    const ln = normalize(lines[i]);
    if (!ln) continue;
    if (ln.includes(ev) || (ev.length > 12 && ev.includes(ln) && ln.length > 12)) return { line: i, score: 1 };
    const score = containment(evidence, lines[i]);
    if (score > best.score) best = { line: i, score };
  }
  // Evidence that spans two lines (e.g. wrapped bullet): try adjacent pairs.
  if (best.score < 0.6) {
    for (let i = 0; i + 1 < lines.length; i++) {
      const score = containment(evidence, `${lines[i]} ${lines[i + 1]}`);
      if (score > best.score) best = { line: i, score };
    }
  }
  return best;
}

/**
 * Priority from the posting's wording: first the line itself ("... is a plus"),
 * then the nearest section heading above it ("Nice to have:"). Returns null if the
 * posting doesn't say, in which case the caller keeps the model's reading.
 */
export function priorityFromPosting(jd, lineIdx) {
  const lines = splitLines(jd);
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const own = lines[lineIdx];
  const ownHeading = headingKind(own);
  if (ownHeading === null) {
    const nice = NICE_INLINE.test(own);
    const must = MUST_INLINE.test(own);
    if (nice && !must) return 'nice';
    if (must && !nice) return 'must';
  }
  for (let i = lineIdx - 1; i >= 0; i--) {
    const kind = headingKind(lines[i]);
    if (kind === 'nice' || kind === 'must') return kind;
    if (kind === 'other') return null;
  }
  return null;
}

export { stripBullet };
