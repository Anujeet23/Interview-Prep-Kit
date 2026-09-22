/**
 * Deterministic link ranking. The model never chooses what we fetch: a page can
 * contain "please visit http://169.254.169.254" and it will simply score zero.
 *
 * Each link gets a score for two intents — "hiring" (how they hire) and "about"
 * (what they do) — from its URL path words and its anchor text.
 */

const SIGNALS = {
  hiring: [
    [/\binterview(s|ing)?\b|hiring[- ]process|how[- ]we[- ]hire|recruit(ing|ment)?[- ]process|our[- ]process/, 14],
    [/\bhiring\b|\brecruit(ing|ment)?\b/, 10],
    [/\bcareers?\b|\bjobs?\b|join[- ]?(us|the[- ]team)?\b|work[- ]with[- ]us|open[- ](roles|positions)|vacanc|positions|talent/, 8],
    [/\bhandbook\b|\bpeople\b|\bcandidates?\b|\bonboarding\b/, 4],
    [/\bengineering\b|\bculture\b|\bvalues\b|\bteam\b/, 2],
  ],
  about: [
    [/\babout([- ]us)?\b|\bcompany\b|who[- ]we[- ]are|our[- ]story|\bmission\b/, 12],
    [/\bproducts?\b|\bplatform\b|\bsolutions?\b|what[- ]we[- ]do|\bcustomers?\b|\bservices\b|how[- ]it[- ]works/, 7],
    [/\bvalues\b|\bculture\b|\bteam\b|\bleadership\b/, 5],
    [/\bblog\b|\bpress\b|\bnews(room)?\b|\bengineering\b/, 2],
  ],
};

const NEGATIVE = /\b(login|log-in|signin|sign-in|signup|sign-up|register|privacy|terms|cookie|legal|gdpr|cart|checkout|account|password|status|cdn-cgi|wp-admin|feed|rss|tag|author|page\/\d+)\b/;
const BINARY = /\.(pdf|png|jpe?g|gif|webp|svg|ico|zip|gz|mp4|mp3|webm|css|js|json|woff2?|ttf|xml)$/i;

function wordsOf(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname + ' ' + u.search).toLowerCase().replace(/[/_.?=&]+/g, ' ').replace(/-/g, '-');
  } catch {
    return '';
  }
}

function scoreFor(intent, pathWords, anchor) {
  let score = 0;
  for (const [re, weight] of SIGNALS[intent]) {
    if (re.test(pathWords)) score += weight;
    if (re.test(anchor)) score += Math.round(weight * 0.8);
  }
  return score;
}

/**
 * The crawl scope is the path the user gave us ("http://host/acme/" -> "/acme/"),
 * so a multi-company host doesn't leak one company's pages into another's kit.
 * A bare locale segment ("/en/") widens the scope to the whole host.
 */
export function scopeOf(baseUrl) {
  const u = new URL(baseUrl);
  let path = u.pathname;
  if (!path.endsWith('/')) {
    const last = path.split('/').pop();
    path = last.includes('.') ? path.slice(0, path.lastIndexOf('/') + 1) : `${path}/`;
  }
  if (/^\/[a-z]{2}(-[a-z]{2})?\/$/i.test(path)) path = '/';
  return { origin: u.origin, host: u.host.replace(/^www\./, ''), path };
}

export function inScope(url, scope) {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '') === scope.host && u.pathname.startsWith(scope.path);
  } catch {
    return false;
  }
}

export function canonical(url) {
  const u = new URL(url);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/.test(k)) u.searchParams.delete(k);
  let s = u.href;
  if (s.endsWith('/index.html')) s = s.slice(0, -'index.html'.length);
  return s.replace(/\/$/, '');
}

/**
 * Rank candidate links. Returns [{url, text, hiring, about, score, intent}] best-first,
 * with zero-scoring links dropped.
 */
export function rankLinks(links, scope, { bonus = 0 } = {}) {
  const best = new Map();
  for (const l of links) {
    if (!inScope(l.url, scope) || BINARY.test(new URL(l.url).pathname)) continue;
    const pathWords = wordsOf(l.url);
    const anchor = (l.text || '').toLowerCase();
    if (NEGATIVE.test(pathWords) || NEGATIVE.test(anchor)) continue;
    const hiring = scoreFor('hiring', pathWords, anchor);
    const about = scoreFor('about', pathWords, anchor);
    if (hiring + about === 0) continue;
    const depth = new URL(l.url).pathname.split('/').filter(Boolean).length;
    const score = Math.max(hiring, about) + Math.min(hiring, about) * 0.25 + bonus - Math.max(0, depth - 3);
    const key = canonical(l.url);
    const prev = best.get(key);
    if (!prev || prev.score < score) best.set(key, { url: l.url, text: l.text, hiring, about, score, intent: hiring >= about ? 'hiring' : 'about' });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Content-based classification once a page has been fetched. */
const HIRING_TERMS = /\b(interview(s|ing)?|take[- ]home|onsite|on-site|system design|pair(ing| programming)|technical screen|phone screen|recruiter|hiring (process|manager)|coding (challenge|exercise|test)|offer stage|stages?|assessment|reference check)\b/gi;
const ABOUT_TERMS = /\b(our mission|we (build|make|help|are)|founded|customers|platform|products?|headquartered|our team|company)\b/gi;

export function classifyPage(page) {
  const text = `${page.title}\n${page.headings.join('\n')}\n${page.text}`.slice(0, 20_000);
  const hiringHits = (text.match(HIRING_TERMS) || []).length;
  const aboutHits = (text.match(ABOUT_TERMS) || []).length;
  const hasInterview = /\binterview/i.test(text);
  return {
    hiringScore: hiringHits,
    aboutScore: aboutHits,
    // A page counts as a hiring-process page only if it actually talks about interviews,
    // not merely because it lists open jobs.
    isHiring: hasInterview && hiringHits >= 3,
    isAbout: aboutHits >= 2,
  };
}
