import { parseHttpUrl } from './urlGuard.js';
import { retrievePage, parseSitemap } from './cleanPage.js';
import { loadRobots } from './robots.js';
import { rankLinks, scopeOf, inScope, canonical, classifyPage } from './linkRanker.js';

const MAX_TEXT = 12_000;

/**
 * Crawl a company site to find what it does and how it hires.
 *
 *  1. Validate the URL and read robots.txt (disallowed paths are never fetched).
 *  2. Fetch the homepage. If that fails the site is "unreachable" and we stop.
 *  3. Rank links from the homepage and the sitemap (if any) by hiring/about signals.
 *  4. Best-first crawl within a page budget. Pages that look like careers/hiring pages
 *     have their own links ranked too, with a bonus, because the interview-process page
 *     usually hangs off the careers page rather than the homepage.
 *
 * Never throws for a retrieval problem: every failed source is recorded in `failures`.
 */
export async function crawlCompany(companyUrl, { fetcher, userAgent, maxPages = 8, deadline = Infinity, onEvent = () => {} }) {
  const result = { input_url: companyUrl, base_url: null, reachable: false, pages: [], failures: [], notes: [], robots: null };

  let base;
  try {
    base = parseHttpUrl(companyUrl);
  } catch (e) {
    result.failures.push({ url: String(companyUrl), code: e.code || 'INVALID_URL', reason: e.message });
    result.notes.push(`The company URL could not be used: ${e.message}`);
    return result;
  }

  const robots = await loadRobots(base.origin, { fetcher, userAgent });
  result.robots = { found: robots.found, note: robots.note };

  if (!robots.isAllowed(base.href)) {
    result.failures.push({ url: base.href, code: 'ROBOTS_DISALLOWED', reason: 'robots.txt disallows fetching this page' });
    result.notes.push('robots.txt does not allow us to read this site, so nothing was fetched from it.');
    return result;
  }

  onEvent({ type: 'fetch', url: base.href });
  let home;
  try {
    home = await retrievePage(base.href, { fetcher, hostDelayMs: robots.crawlDelayMs });
  } catch (e) {
    result.failures.push({ url: base.href, code: e.code || 'FETCH_FAILED', reason: e.message, attempts: e.attempts });
    result.notes.push(`The company site could not be reached (${e.message}${e.attempts ? ` after ${e.attempts} attempts` : ''}).`);
    return result;
  }
  result.reachable = true;
  result.base_url = home.url;
  const scope = scopeOf(home.url);
  const seen = new Set([canonical(home.url), canonical(base.href)]);
  result.pages.push(finalise(home, 'home'));

  // Candidate queue from homepage links + sitemap entries.
  let queue = rankLinks(home.links, scope);
  const sitemapUrls = await readSitemaps({ robots, scope, fetcher, deadline });
  if (sitemapUrls.length) {
    queue = merge(queue, rankLinks(sitemapUrls.map((url) => ({ url, text: '' })), scope, { bonus: -1 }));
    result.notes.push(`Sitemap listed ${sitemapUrls.length} URLs in scope.`);
  }

  let hiringFound = false;
  let aboutCount = 0;
  while (queue.length && result.pages.length < maxPages && Date.now() < deadline) {
    // Once a real hiring page and some about content are in hand, stop spending the budget.
    if (hiringFound && aboutCount >= 2) break;
    const next = pickNext(queue, { needHiring: !hiringFound, needAbout: aboutCount < 2 });
    if (!next) break;
    queue = queue.filter((c) => c !== next);
    const key = canonical(next.url);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!robots.isAllowed(next.url)) {
      result.failures.push({ url: next.url, code: 'ROBOTS_DISALLOWED', reason: 'robots.txt disallows this path' });
      continue;
    }
    onEvent({ type: 'fetch', url: next.url });
    try {
      const page = await retrievePage(next.url, { fetcher, hostDelayMs: robots.crawlDelayMs });
      if (!inScope(page.url, scope) || seen.has(canonical(page.url)) && canonical(page.url) !== key) {
        // Redirected outside the site or onto a page we already have.
        if (!inScope(page.url, scope)) result.failures.push({ url: next.url, code: 'OUT_OF_SCOPE', reason: `redirected to ${page.url}` });
        continue;
      }
      seen.add(canonical(page.url));
      const kind = next.intent;
      const stored = finalise(page, kind, next);
      result.pages.push(stored);
      if (stored.is_hiring) hiringFound = true;
      if (stored.is_about || kind === 'about') aboutCount++;
      // Follow links from careers/hiring-ish pages: the process page is often one level down.
      if (next.hiring >= 8 || stored.is_hiring) {
        queue = merge(queue, rankLinks(page.links, scope, { bonus: 3 }).filter((c) => !seen.has(canonical(c.url))));
      }
    } catch (e) {
      result.failures.push({ url: next.url, code: e.code || 'FETCH_FAILED', reason: e.message, attempts: e.attempts });
    }
  }

  const hiring = result.pages.filter((p) => p.is_hiring);
  if (!hiring.length) result.notes.push('No page describing the interview or hiring process was found on the company site.');
  if (Date.now() >= deadline) result.notes.push('Crawl stopped early because the time budget ran out.');
  return result;
}

function finalise(page, intent, link) {
  const cls = classifyPage(page);
  return {
    url: page.url,
    title: page.title,
    description: page.description,
    site_name: page.siteName,
    intent,
    link_score: link?.score ?? null,
    is_hiring: cls.isHiring,
    is_about: cls.isAbout || intent === 'home',
    hiring_score: cls.hiringScore,
    about_score: cls.aboutScore,
    headings: page.headings.slice(0, 20),
    text: page.text.slice(0, MAX_TEXT),
  };
}

function merge(a, b) {
  const map = new Map(a.map((c) => [canonical(c.url), c]));
  for (const c of b) {
    const k = canonical(c.url);
    if (!map.has(k) || map.get(k).score < c.score) map.set(k, c);
  }
  return [...map.values()].sort((x, y) => y.score - x.score);
}

/** Alternate between intents so one about-page-heavy site can't starve the hiring search. */
function pickNext(queue, { needHiring, needAbout }) {
  const top = (key, min) => queue.filter((c) => c[key] >= min).sort((a, b) => b[key] - a[key])[0] || null;
  const h = needHiring ? top('hiring', 4) : null;
  const a = needAbout ? top('about', 1) : null;
  if (h && a) return h.hiring >= a.about ? h : a;
  return h || a || (needHiring ? top('hiring', 1) : null);
}

async function readSitemaps({ robots, scope, fetcher, deadline }) {
  const candidates = robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${scope.origin}${scope.path}sitemap.xml`];
  const out = [];
  for (const sm of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const res = await fetcher.get(sm, { accept: 'application/xml,text/xml', types: ['xml', 'text/plain'], retries: 0 });
      for (const u of parseSitemap(res.body)) if (inScope(u, scope)) out.push(u);
    } catch {
      /* a missing sitemap is normal */
    }
  }
  return out.slice(0, 500);
}
