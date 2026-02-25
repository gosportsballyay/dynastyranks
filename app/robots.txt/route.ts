export function GET() {
  const body = `User-agent: *
Allow: /
Allow: /terms
Allow: /privacy
Disallow: /dashboard
Disallow: /league
Disallow: /admin
Disallow: /debug
Disallow: /api

Sitemap: https://dynastyranks.com/sitemap.xml
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
