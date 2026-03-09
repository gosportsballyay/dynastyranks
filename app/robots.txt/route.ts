export function GET() {
  const body = `User-agent: *
Allow: /
Allow: /terms
Allow: /privacy
Allow: /idp-trends
Disallow: /dashboard
Disallow: /league
Disallow: /admin
Disallow: /debug
Disallow: /api

Sitemap: https://mydynastyvalues.com/sitemap.xml
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
