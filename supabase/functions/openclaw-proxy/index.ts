const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const sessionKey = url.searchParams.get('sessionKey');
    const follow = url.searchParams.get('follow');
    const limit = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor');
    const includeTools = url.searchParams.get('includeTools');
    const testOnly = url.searchParams.get('test') === '1';

    // Auth and base URL are passed from the frontend in the request body for POST,
    // or as custom headers for GET requests
    const openclawBaseUrl = req.headers.get('x-openclaw-base-url') || '';
    const authMode = req.headers.get('x-openclaw-auth-mode') || 'none';
    const authToken = req.headers.get('x-openclaw-auth-token') || '';
    const authHeaderName = req.headers.get('x-openclaw-auth-header-name') || 'Authorization';
    const authHeaderPrefix = req.headers.get('x-openclaw-auth-header-prefix') || 'Bearer ';

    if (!openclawBaseUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing x-openclaw-base-url header' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionKey && !testOnly) {
      return new Response(
        JSON.stringify({ error: 'sessionKey query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build upstream URL
    const baseUrl = openclawBaseUrl.replace(/\/+$/, '');
    const targetSessionKey = sessionKey || 'test';
    const params = new URLSearchParams();
    if (follow === '1') params.set('follow', '1');
    if (limit) params.set('limit', limit);
    if (cursor) params.set('cursor', cursor);
    if (includeTools) params.set('includeTools', includeTools);
    if (testOnly) params.set('limit', '0');

    const targetUrl = `${baseUrl}/sessions/${targetSessionKey}/history?${params}`;

    // Build headers with auth
    const upstreamHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (authMode === 'bearer' && authToken) {
      upstreamHeaders['Authorization'] = `Bearer ${authToken}`;
    } else if (authMode === 'custom' && authToken && authHeaderName) {
      const prefix = authHeaderPrefix || '';
      upstreamHeaders[authHeaderName] = prefix ? `${prefix}${authToken}` : authToken;
    }

    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(follow === '1' ? 60000 : 10000),
    });

    // For SSE streaming (follow=1), pipe the response
    if (follow === '1' && upstreamRes.ok && upstreamRes.body) {
      return new Response(upstreamRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Build detailed response for test mode or regular requests
    const responseBody = await upstreamRes.text();
    const result: Record<string, unknown> = {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      endpoint: targetUrl,
      authApplied: authMode !== 'none',
      authMode,
    };

    if (testOnly) {
      // Return diagnostic info
      result.bodySnippet = responseBody.slice(0, 500);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!upstreamRes.ok) {
      const errorDetail =
        upstreamRes.status === 401 ? 'Unauthorized — check your auth token and mode' :
        upstreamRes.status === 403 ? 'Forbidden — insufficient permissions' :
        upstreamRes.status === 404 ? 'Not Found — session key may be invalid' :
        `Upstream error: ${upstreamRes.statusText}`;

      return new Response(
        JSON.stringify({
          error: errorDetail,
          status: upstreamRes.status,
          endpoint: targetUrl,
          bodySnippet: responseBody.slice(0, 300),
        }),
        {
          status: upstreamRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Return the upstream JSON response
    return new Response(responseBody, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown proxy error';
    const isTimeout = message.includes('timeout') || message.includes('abort');
    const isNetwork = message.includes('error sending request') || message.includes('connection');

    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'Request timed out — is the OpenClaw instance reachable?'
          : isNetwork
            ? 'Network error — could not connect to the OpenClaw endpoint'
            : `Proxy error: ${message}`,
        type: isTimeout ? 'timeout' : isNetwork ? 'network' : 'unknown',
      }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
