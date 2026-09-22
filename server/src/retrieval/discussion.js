import { collapse, truncate } from '../lib/text.js';

/**
 * Looks for public discussion of a company's interview process.
 *
 * Sources (no API key needed unless noted):
 *   - Hacker News via the public Algolia search API
 *   - Reddit's public search JSON (best effort; Reddit often rate-limits anonymous clients)
 *   - Tavily web search, only when TAVILY_API_KEY is set
 *
 * Results are filtered deterministically: a hit must mention the company (by name or
 * domain) AND an interview term. Name-only matches are marked low confidence because
 * company names collide ("Acme", "Notion", "Linear"...). Nothing here is ever treated as fact.
 */
const INTERVIEW = /\b(interview(ed|s|ing)?|hiring process|take[- ]home|onsite|recruiter|leetcode|system design round|offer)\b/i;

export async function searchDiscussion({ companyName, domain, fetcher, enabled = true, timeoutMs = 7000, tavilyKey = '' }) {
  const out = { status: 'searched', queries: [], sources_tried: [], results: [], failures: [] };
  if (!enabled) return { ...out, status: 'disabled' };
  const name = collapse(companyName);
  if (!name && !domain) return { ...out, status: 'skipped', note: 'No company name to search for.' };

  const query = `${name || domain} interview`;
  out.queries.push(query);

  const tasks = [
    ['hackernews', () => hackerNews(query, fetcher)],
    ['reddit', () => reddit(`"${name || domain}" interview process`, fetcher)],
  ];
  if (tavilyKey) tasks.push(['tavily', () => tavily(`${name || domain} interview process experience`, tavilyKey, timeoutMs)]);

  const settled = await Promise.all(
    tasks.map(async ([source, fn]) => {
      out.sources_tried.push(source);
      try {
        return await withTimeout(fn(), timeoutMs, source);
      } catch (e) {
        out.failures.push({ source, reason: e.message });
        return [];
      }
    })
  );

  const nameRe = name && name.length >= 3 ? new RegExp(`\\b${escapeRe(name)}\\b`, 'i') : null;
  const seen = new Set();
  for (const r of settled.flat()) {
    if (!r?.url || seen.has(r.url)) continue;
    const hay = `${r.title} ${r.snippet}`;
    const domainHit = domain && hay.toLowerCase().includes(domain.toLowerCase());
    const nameHit = nameRe?.test(hay);
    if (!(domainHit || nameHit) || !INTERVIEW.test(hay)) continue;
    seen.add(r.url);
    out.results.push({ ...r, confidence: domainHit ? 'medium' : 'low', snippet: truncate(collapse(r.snippet), 600) });
  }
  out.results = out.results.slice(0, 8);
  if (!out.results.length) out.status = out.failures.length === tasks.length ? 'unavailable' : 'nothing_found';
  return out;
}

async function hackerNews(query, fetcher) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=20`;
  const res = await fetcher.get(url, { accept: 'application/json', types: ['json'], retries: 1 });
  const data = JSON.parse(res.body);
  return (data.hits || []).map((h) => ({
    source: 'hackernews',
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: h.title || h.story_title || '',
    snippet: stripTags(h.comment_text || h.story_text || h.title || ''),
    date: h.created_at,
  }));
}

async function reddit(query, fetcher) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=15&sort=relevance`;
  const res = await fetcher.get(url, { accept: 'application/json', types: ['json'], retries: 0 });
  const data = JSON.parse(res.body);
  return (data?.data?.children || []).map(({ data: p }) => ({
    source: 'reddit',
    url: `https://www.reddit.com${p.permalink}`,
    title: p.title || '',
    snippet: p.selftext || p.title || '',
    date: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : undefined,
  }));
}

async function tavily(query, key, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((r) => ({ source: 'web', url: r.url, title: r.title || '', snippet: r.content || '' }));
  } finally {
    clearTimeout(t);
  }
}

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
