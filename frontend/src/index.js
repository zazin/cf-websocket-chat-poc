export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws' || pathname === '/health') return env.BACKEND.fetch(request);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  },
};
