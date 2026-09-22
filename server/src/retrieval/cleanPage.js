import * as cheerio from 'cheerio';

const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,tr,blockquote,pre,section,article,div,br';
const HIDDEN =
  'script,style,noscript,svg,iframe,object,embed,form,template,canvas,[hidden],[aria-hidden="true"],' +
  '[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"]';

/**
 * Turns raw HTML into { title, description, headings, text, links }.
 * Hidden elements are removed before text extraction: invisible text is a common
 * place to hide prompt-injection payloads, and a human visitor would never see it.
 */
export function cleanHtml(html, baseUrl) {
  const $ = cheerio.load(html || '');
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || $('h1').first().text().replace(/\s+/g, ' ').trim();
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
  const siteName = ($('meta[property="og:site_name"]').attr('content') || '').trim();

  $(HIDDEN).remove();

  const links = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) return;
    try {
      const u = new URL(href, baseUrl);
      if (!['http:', 'https:'].includes(u.protocol)) return;
      u.hash = '';
      links.push({
        url: u.href,
        text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120) || ($(el).attr('title') || '').slice(0, 120),
        inNav: $(el).closest('nav,header,footer').length > 0,
      });
    } catch {
      /* ignore malformed hrefs */
    }
  });

  const headings = $('h1,h2,h3')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 40);

  // Page chrome is noise for the model; the links above were already collected from it.
  $('nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]').remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  root.find('li').each((_, el) => $(el).prepend('- '));
  root.find(BLOCK).each((_, el) => {
    $(el).prepend('\n');
    $(el).append('\n');
  });
  const text = root
    .text()
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return { title, description, siteName, headings, text, links };
}

export function cleanText(body) {
  return String(body || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Retrieve and clean one page. Returns a page object or throws a FetchError. */
export async function retrievePage(url, { fetcher }) {
  const res = await fetcher.get(url);
  const isHtml = /html|xml/.test(res.contentType) || /^\s*</.test(res.body);
  const parsed = isHtml ? cleanHtml(res.body, res.url) : { title: '', description: '', siteName: '', headings: [], text: cleanText(res.body), links: [] };
  return { url: res.url, requestedUrl: String(url), truncated: res.truncated, ...parsed };
}

/** Extract <loc> entries from a sitemap document (index or urlset). */
export function parseSitemap(xml) {
  const $ = cheerio.load(xml || '', { xmlMode: true });
  return $('loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((u) => /^https?:\/\//i.test(u));
}
