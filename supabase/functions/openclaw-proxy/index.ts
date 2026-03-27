const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-openclaw-base-url, x-openclaw-auth-mode, x-openclaw-auth-token, x-openclaw-auth-header-name, x-openclaw-auth-header-prefix, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const diagnostics: Record<string, unknown> = {
    proxyTimestamp: new Date().toISOString(),
  };

  try {
    const url = new URL(req.url);
    const probeType = url.searchParams.get('probe'); // 'health' | 'basic' | 'sse' | 'test'

    // Health probe — does not require any config
    if (probeType === 'health') {
      console.log('[openclaw-proxy] Health probe hit');
      return new Response(
        JSON.stringify({ ok: true, function: 'openclaw-proxy', timestamp: new Date().toISOString() }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessionKey = url.searchParams.get('sessionKey');
    const follow = url.searchParams.get('follow');
    const limit = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor');
    const includeTools = url.searchParams.get('includeTools');

    const openclawBaseUrl = req.headers.get('x-openclaw-base-url') || '';
    const authMode = req.headers.get('x-openclaw-auth-mode') || 'none';
    const authToken = req.headers.get('x-openclaw-auth-token') || '';
    const authHeaderName = req.headers.get('x-openclaw-auth-header-name') || 'Authorization';
    const authHeaderPrefix = req.headers.get('x-openclaw-auth-header-prefix') || 'Bearer ';

    // Log incoming config (no secrets)
    diagnostics.incomingConfig = {
      baseUrl: openclawBaseUrl,
      authMode,
      authHeaderName,
      authHeaderPrefix,
      hasToken: !!authToken,
      sessionKeyRaw: sessionKey,
      sessionKeyEncoded: sessionKey ? encodeURIComponent(sessionKey) : null,
      follow,
      probeType: probeType || 'none',
    };

    console.log('[openclaw-proxy] Request:', JSON.stringify(diagnostics.incomingConfig));

    if (!openclawBaseUrl) {
      diagnostics.error = 'Missing x-openclaw-base-url header';
      return new Response(
        JSON.stringify({ error: 'Missing x-openclaw-base-url header', diagnostics }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionKey && !probeType) {
      diagnostics.error = 'sessionKey query parameter is required';
      return new Response(
        JSON.stringify({ error: 'sessionKey query parameter is required', diagnostics }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build upstream URL with proper encoding
    const baseUrl = openclawBaseUrl.replace(/\/+$/, '');
    const encodedSessionKey = encodeURIComponent(sessionKey || 'test');
    const params = new URLSearchParams();

    const isSSEProbe = probeType === 'sse' || follow === '1';
    const isBasicProbe = probeType === 'basic' || probeType === 'test';

    if (isSSEProbe && probeType !== 'test') params.set('follow', '1');
    if (limit) params.set('limit', limit);
    if (cursor) params.set('cursor', cursor);
    if (includeTools) params.set('includeTools', includeTools);
    if (isBasicProbe && !limit) params.set('limit', '1');

    const queryString = params.toString();
    const targetUrl = `${baseUrl}/sessions/${encodedSessionKey}/history${queryString ? '?' + queryString : ''}`;

    diagnostics.upstreamUrl = targetUrl;
    diagnostics.encodedPath = `/sessions/${encodedSessionKey}/history`;

    console.log('[openclaw-proxy] Upstream URL:', targetUrl);

    // Build headers with auth
    const upstreamHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };
    let authApplied = false;

    if (authMode === 'bearer' && authToken) {
      upstreamHeaders['Authorization'] = `Bearer ${authToken}`;
      authApplied = true;
    } else if (authMode === 'custom' && authToken && authHeaderName) {
      const prefix = authHeaderPrefix || '';
      upstreamHeaders[authHeaderName] = prefix ? `${prefix}${authToken}` : authToken;
      authApplied = true;
    }

    diagnostics.authApplied = authApplied;
    diagnostics.authMode = authMode;

    const startTime = Date.now();
    let upstreamRes: Response;

    try {
      upstreamRes = await fetch(targetUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(isSSEProbe ? 10000 : 10000),
      });
    } catch (fetchErr) {
      const elapsed = Date.now() - startTime;
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const stack = fetchErr instanceof Error ? fetchErr.stack : undefined;
      const isTimeout = message.includes('timeout') || message.includes('abort');
      const isNetwork = message.includes('error sending request') || message.includes('connection');

      diagnostics.fetchError = { message, stack, isTimeout, isNetwork, elapsed };
      console.error('[openclaw-proxy] Fetch error:', JSON.stringify(diagnostics.fetchError));

      return new Response(
        JSON.stringify({
          error: isTimeout
            ? 'Request timed out — is the OpenClaw instance reachable?'
            : isNetwork
              ? 'Network error — could not connect to the OpenClaw endpoint'
              : `Proxy fetch error: ${message}`,
          errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'fetch_error',
          failurePoint: isSSEProbe ? 'sse_stream_init' : 'session_history_fetch',
          diagnostics,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const elapsed = Date.now() - startTime;
    diagnostics.upstreamStatus = upstreamRes.status;
    diagnostics.upstreamStatusText = upstreamRes.statusText;
    diagnostics.latencyMs = elapsed;

    console.log('[openclaw-proxy] Upstream response:', upstreamRes.status, upstreamRes.statusText, `${elapsed}ms`);

    // For SSE follow mode (non-probe), pipe the stream
    if (follow === '1' && !probeType && upstreamRes.ok && upstreamRes.body) {
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

    // Read response body
    const responseBody = await upstreamRes.text();
    const bodySnippet = responseBody.slice(0, 500);
    diagnostics.bodySnippet = bodySnippet;

    console.log('[openclaw-proxy] Response body (first 500):', bodySnippet);

    // Try to parse as JSON for structured error surfacing
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      // not JSON
    }

    // Classify error
    const errorLabel = !upstreamRes.ok ? (
      upstreamRes.status === 401 ? '401 Unauthorized' :
      upstreamRes.status === 403 ? '403 Forbidden' :
      upstreamRes.status === 404 ? '404 Not Found' :
      upstreamRes.status === 422 ? '422 Invalid session key/path' :
      upstreamRes.status >= 500 ? `${upstreamRes.status} Proxy or upstream error` :
      `${upstreamRes.status} ${upstreamRes.statusText}`
    ) : null;

    diagnostics.errorLabel = errorLabel;
    diagnostics.failurePoint = probeType === 'sse' ? 'sse_probe' : probeType === 'basic' ? 'basic_probe' : 'session_history_fetch';

    // For probes, always return diagnostics
    if (probeType) {
      return new Response(
        JSON.stringify({
          ok: upstreamRes.ok,
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          errorLabel,
          endpoint: targetUrl,
          encodedPath: `/sessions/${encodedSessionKey}/history`,
          authApplied,
          authMode,
          latencyMs: elapsed,
          failurePoint: diagnostics.failurePoint,
          bodySnippet,
          parsedBody: parsedBody,
          diagnostics,
        }),
        {
          status: 200, // always 200 for probes so the client can read the full diagnostic
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!upstreamRes.ok) {
      return new Response(
        JSON.stringify({
          error: errorLabel,
          errorType: upstreamRes.status === 401 ? 'unauthorized' :
            upstreamRes.status === 403 ? 'forbidden' :
            upstreamRes.status === 404 ? 'not_found' :
            upstreamRes.status === 422 ? 'invalid_path' :
            upstreamRes.status >= 500 ? 'server_error' : 'http_error',
          status: upstreamRes.status,
          endpoint: targetUrl,
          bodySnippet,
          parsedBody,
          diagnostics,
        }),
        {
          status: upstreamRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Success: return upstream JSON
    return new Response(responseBody, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown proxy error';
    const stack = e instanceof Error ? e.stack : undefined;
    diagnostics.caughtException = { message, stack };
    console.error('[openclaw-proxy] Unhandled error:', message, stack);

    return new Response(
      JSON.stringify({
        error: `Proxy error: ${message}`,
        errorType: 'proxy_error',
        diagnostics,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
