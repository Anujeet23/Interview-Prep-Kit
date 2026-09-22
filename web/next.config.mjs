/**
 * The browser only ever talks to this Next.js origin. /api/* is proxied to the Express
 * backend, so the session cookie is first-party (no third-party-cookie problems on Safari)
 * and the backend URL never has to be exposed to the client.
 */
const backend = process.env.BACKEND_URL || 'http://localhost:4000';

export default {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};
