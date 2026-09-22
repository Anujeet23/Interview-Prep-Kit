import robotsParser from 'robots-parser';

/**
 * Loads robots.txt once per origin. A missing or unreadable robots.txt means
 * "no restrictions" (the standard interpretation); a 401/403 means "stay out".
 */
export async function loadRobots(origin, { fetcher, userAgent }) {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetcher.get(robotsUrl, { accept: 'text/plain', types: ['text/plain', 'text/html', 'application/octet-stream'], retries: 0 });
    const parser = robotsParser(robotsUrl, res.body);
    const crawlDelay = parser.getCrawlDelay(userAgent);
    return {
      found: true,
      isAllowed: (url) => parser.isAllowed(url, userAgent) !== false,
      sitemaps: parser.getSitemaps(),
      crawlDelayMs: crawlDelay ? Math.min(5000, crawlDelay * 1000) : 0,
    };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return { found: true, isAllowed: () => false, sitemaps: [], crawlDelayMs: 0, note: `robots.txt returned ${e.status}; site treated as off-limits` };
    }
    return { found: false, isAllowed: () => true, sitemaps: [], crawlDelayMs: 0 };
  }
}
