import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from '../lib/errors.js';

export class UrlError extends AppError {
  constructor(code, message) {
    super(code, message, { status: 400 });
  }
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (/^f[cd]/.test(l) || l.startsWith('fe80') || l.startsWith('ff')) return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not an IP at all: refuse to classify as public
}

/** Parse user input into an http(s) URL. Adds https:// when the scheme is missing. */
export function parseHttpUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) throw new UrlError('INVALID_URL', 'No company URL was given.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new UrlError('INVALID_URL', `"${raw}" is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UrlError('INVALID_URL', 'Only http and https URLs are supported.');
  if (u.username || u.password) throw new UrlError('INVALID_URL', 'URLs with embedded credentials are not allowed.');
  if (!u.hostname || (!u.hostname.includes('.') && u.hostname !== 'localhost' && !net.isIP(u.hostname.replace(/^\[|\]$/g, '')))) {
    throw new UrlError('INVALID_URL', `"${raw}" does not look like a website address.`);
  }
  u.hash = '';
  return u;
}

/**
 * Refuse to fetch anything that resolves to a private address unless explicitly allowed.
 * Called for every hop of a redirect chain, not just the first URL.
 */
export async function assertFetchable(url, { allowPrivate = false, lookup = dns.lookup } = {}) {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UrlError('PRIVATE_ADDRESS', `Refusing to fetch internal host ${host}.`);
  }
  let addresses;
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new UrlError('DNS_FAILED', `Could not resolve ${host}.`);
    }
  }
  if (!addresses.length || addresses.some(isPrivateIp)) {
    throw new UrlError('PRIVATE_ADDRESS', `Refusing to fetch ${host}: it resolves to a private or reserved address.`);
  }
}
