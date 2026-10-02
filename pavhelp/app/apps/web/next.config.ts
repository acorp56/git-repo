import type { NextConfig } from 'next';

const api = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@pavhelp/core'],
  // API на том же домене: cookie сессии работает без CORS, а SameSite=Lax защищает от CSRF.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
