const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-openclaw-base-url, x-openclaw-auth-mode, x-openclaw-auth-token, x-openclaw-auth-header-name, x-openclaw-auth-header-prefix, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type ErrorStage = 'proxy_fetch' | 'upstream_fetch' | 'response_parse';
type ErrorType = 'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_path' | 'server_error' | 'exception';

type ProbeType = 'health' | 'basic' | 'sse' | 'echo';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function redactValue(key: string, value: string) {
  return /authorization|auth-token|apikey/i.test(key) ? '[redacted]' : value;
}

function headersToObject(headers: Headers) {
  return Object.fromEntries(Array.from(headers.entries()).map(([key, value]) => [key, redactValue(key, value)]));
}

function sanitizePayload(payload: Record<string, unknown>) {
  const clone = { ...payload };
  if (typeof clone.authToken === 'string' && clone.authToken.length > 0) {
    clone.authToken = '[redacted]';
  }
  return clone;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseBooleanParam(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true;
}

function buildErrorResponse(args: {
  stage: ErrorStage;
  errorType: ErrorType;
  message: string;
  upstreamUrl?: string;
  upstreamStatus?: number;
  status?: number;
  diagnostics: Record<string, unknown>;
  rawErrorObject?: unknown;
}) {
  return jsonResponse(
    {
      ok: false,
      stage: args.stage,
      errorType: args.errorType,
      message: args.message,
      upstreamUrl: args.upstreamUrl,
      upstreamStatus: args.upstreamStatus,
      rawErrorObject: args.rawErrorObject,
      diagnostics: args.diagnostics,
    },
    args.status ?? 500,
  );
}

function classifyUpstreamError(status: number): { errorType: ErrorType; message: string } {
  if (status === 401) return { errorType: 'unauthorized', message: '401 Unauthorized' };
  if (status === 403) return { errorType: 'forbidden', message: '403 Forbidden' };
  if (status === 404) return { errorType: 'not_found', message: '404 Not Found' };
  if (status === 422) return { errorType: 'invalid_path', message: '422 Invalid session key/path' };
  if (status >= 500) return { errorType: 'server_error', message: '5xx Proxy or upstream error' };
  return { errorType: 'exception', message: `${status} Upstream error` };
}

async function parseBody(req: Request, diagnostics: Record<string, unknown>) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return {} as Record<string, unknown>;
  }

  const rawText = await req.text();
  diagnostics.requestBodySnippet = rawText.slice(0, 500);

  if (!rawText) return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    diagnostics.requestBodyReceived = sanitizePayload(parsed);
    return parsed;
  } catch (error) {
    diagnostics.requestBodyParseError = error instanceof Error ? error.message : String(error);
    return {} as Record<string, unknown>;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const baseDiagnostics: Record<string, unknown> = {
    proxyTimestamp: new Date().toISOString(),
    method: req.method,
    functionUrl: req.url,
    proxyRouteInvoked: `${url.pathname}${url.search}`,
    queryParamsReceived: queryParams,
    headersReceived: headersToObject(req.headers),
  };

  if (req.method === 'OPTIONS') {
    console.log('[openclaw-proxy] OPTIONS:', JSON.stringify(baseDiagnostics));
    return jsonResponse(
      {
        ok: true,
        function: 'openclaw-proxy',
        method: 'OPTIONS',
        optionsHit: true,
        headersReceived: baseDiagnostics.headersReceived,
        queryParamsReceived: queryParams,
      },
      200,
    );
  }

  try {
    const requestBody = await parseBody(req, baseDiagnostics);
    const probeType = (asOptionalString(requestBody.probe) || url.searchParams.get('probe') || undefined) as ProbeType | undefined;

    if (probeType === 'health') {
      console.log('[openclaw-proxy] Health probe hit');
      return jsonResponse({ ok: true, function: 'openclaw-proxy', method: req.method, optionsHit: false }, 200);
    }

    const sessionKey = asOptionalString(requestBody.sessionKey) || url.searchParams.get('sessionKey') || undefined;
    const follow = asOptionalString(requestBody.follow) || url.searchParams.get('follow') || undefined;
    const limit = asOptionalString(requestBody.limit) || url.searchParams.get('limit') || undefined;
    const cursor = asOptionalString(requestBody.cursor) || url.searchParams.get('cursor') || undefined;
    const includeTools = parseBooleanParam(requestBody.includeTools) || url.searchParams.get('includeTools') === '1';

    const openclawBaseUrl =
      asOptionalString(requestBody.baseUrl) ||
      asOptionalString(requestBody.openclawBaseUrl) ||
      url.searchParams.get('baseUrl') ||
      req.headers.get('x-openclaw-base-url') ||
      '';

    const authMode =
      asOptionalString(requestBody.authMode) ||
      url.searchParams.get('authMode') ||
      req.headers.get('x-openclaw-auth-mode') ||
      'none';

    const authToken =
      asString(requestBody.authToken) ||
      req.headers.get('x-openclaw-auth-token') ||
      '';

    const authHeaderName =
      asOptionalString(requestBody.authHeaderName) ||
      url.searchParams.get('authHeaderName') ||
      req.headers.get('x-openclaw-auth-header-name') ||
      'Authorization';

    const authHeaderPrefix =
      asOptionalString(requestBody.authHeaderPrefix) ||
      url.searchParams.get('authHeaderPrefix') ||
      req.headers.get('x-openclaw-auth-header-prefix') ||
      'Bearer ';

    baseDiagnostics.incomingConfig = {
      probeType: probeType || 'none',
      baseUrl: openclawBaseUrl,
      sessionKeyRaw: sessionKey,
      authMode,
      authHeaderName,
      authHeaderPrefix,
      hasAuthToken: Boolean(authToken),
      follow,
      limit,
      cursor,
      includeTools,
    };

    console.log('[openclaw-proxy] Incoming query params:', JSON.stringify(queryParams));
    console.log('[openclaw-proxy] Incoming config summary:', JSON.stringify(baseDiagnostics.incomingConfig));

    if (probeType === 'echo') {
      return jsonResponse(
        {
          ok: true,
          function: 'openclaw-proxy',
          probe: 'echo',
          method: req.method,
          optionsHit: false,
          headersReceived: baseDiagnostics.headersReceived,
          queryParamsReceived: queryParams,
          requestBodyReceived: baseDiagnostics.requestBodyReceived,
          proxyRouteInvoked: baseDiagnostics.proxyRouteInvoked,
          diagnostics: baseDiagnostics,
        },
        200,
      );
    }

    if (!openclawBaseUrl) {
      return buildErrorResponse({
        stage: 'proxy_fetch',
        errorType: 'exception',
        message: 'Missing OpenClaw base URL',
        status: 400,
        diagnostics: baseDiagnostics,
      });
    }

    if (!sessionKey) {
      return buildErrorResponse({
        stage: 'proxy_fetch',
        errorType: 'invalid_path',
        message: 'Missing session key',
        status: 400,
        diagnostics: baseDiagnostics,
      });
    }

    const baseUrl = openclawBaseUrl.replace(/\/+$/, '');
    const encodedSessionKey = encodeURIComponent(sessionKey);
    const params = new URLSearchParams();
    const isSSEProbe = probeType === 'sse';

    if (isSSEProbe || follow === '1') params.set('follow', '1');
    if (!probeType || probeType !== 'basic') {
      if (limit) params.set('limit', limit);
      if (cursor) params.set('cursor', cursor);
      if (includeTools) params.set('includeTools', '1');
    }

    const queryString = params.toString();
    const targetUrl = `${baseUrl}/sessions/${encodedSessionKey}/history${queryString ? `?${queryString}` : ''}`;

    baseDiagnostics.upstreamUrl = targetUrl;
    baseDiagnostics.encodedPath = `/sessions/${encodedSessionKey}/history`;
    baseDiagnostics.failurePoint = isSSEProbe ? 'sse_follow_probe' : 'session_history_fetch';

    console.log('[openclaw-proxy] Resolved upstream URL:', targetUrl);

    const upstreamHeaders: Record<string, string> = {
      Accept: 'application/json',
    };
    let authApplied = false;

    if (authMode === 'bearer' && authToken) {
      upstreamHeaders.Authorization = `Bearer ${authToken}`;
      authApplied = true;
    } else if (authMode === 'custom' && authToken && authHeaderName) {
      upstreamHeaders[authHeaderName] = authHeaderPrefix ? `${authHeaderPrefix}${authToken}` : authToken;
      authApplied = true;
    }

    baseDiagnostics.authMode = authMode;
    baseDiagnostics.authApplied = authApplied;
    console.log('[openclaw-proxy] Auth mode used:', authMode);
    console.log('[openclaw-proxy] Auth header attached:', String(authApplied));

    const fetchStartedAt = Date.now();
    baseDiagnostics.fetchStart = new Date(fetchStartedAt).toISOString();
    console.log('[openclaw-proxy] Fetch start:', baseDiagnostics.fetchStart);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(isSSEProbe ? 12000 : 10000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const lowered = message.toLowerCase();
      const errorType: ErrorType = lowered.includes('timeout') || lowered.includes('abort') ? 'timeout' : 'network';

      baseDiagnostics.caughtException = { message, stack };
      console.error('[openclaw-proxy] Caught exception:', message, stack);

      return buildErrorResponse({
        stage: 'proxy_fetch',
        errorType,
        message,
        upstreamUrl: targetUrl,
        status: 502,
        diagnostics: baseDiagnostics,
        rawErrorObject: { message, stack },
      });
    }

    const latencyMs = Date.now() - fetchStartedAt;
    baseDiagnostics.upstreamStatus = upstreamResponse.status;
    baseDiagnostics.statusText = upstreamResponse.statusText;
    baseDiagnostics.latencyMs = latencyMs;
    console.log('[openclaw-proxy] Fetch response status:', upstreamResponse.status);

    if (follow === '1' && !probeType && upstreamResponse.ok && upstreamResponse.body) {
      return new Response(upstreamResponse.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    const responseText = await upstreamResponse.text();
    const bodySnippet = responseText.slice(0, 500);
    baseDiagnostics.bodySnippet = bodySnippet;
    console.log('[openclaw-proxy] First 500 chars of upstream body:', bodySnippet);

    let parsedBody: unknown = null;
    try {
      parsedBody = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      if (probeType) {
        baseDiagnostics.responseParseWarning = error instanceof Error ? error.message : String(error);
      } else {
        baseDiagnostics.caughtException = {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        };
        console.error('[openclaw-proxy] Caught exception:', baseDiagnostics.caughtException);
        return buildErrorResponse({
          stage: 'response_parse',
          errorType: 'exception',
          message: 'Failed to parse upstream JSON response',
          upstreamUrl: targetUrl,
          upstreamStatus: upstreamResponse.status,
          status: 502,
          diagnostics: baseDiagnostics,
          rawErrorObject: baseDiagnostics.caughtException,
        });
      }
    }

    if (probeType) {
      if (!upstreamResponse.ok) {
        const classified = classifyUpstreamError(upstreamResponse.status);
        return jsonResponse(
          {
            ok: false,
            stage: 'upstream_fetch',
            errorType: classified.errorType,
            message: classified.message,
            proxyRouteInvoked: baseDiagnostics.proxyRouteInvoked,
            upstreamUrl: targetUrl,
            sessionKeyRaw: sessionKey,
            sessionKeyEncoded: encodedSessionKey,
            authMode,
            authApplied,
            proxyHttpStatus: 200,
            upstreamStatus: upstreamResponse.status,
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            latencyMs,
            failurePoint: baseDiagnostics.failurePoint,
            bodySnippet,
            parsedBody,
            diagnostics: baseDiagnostics,
          },
          200,
        );
      }

      return jsonResponse(
        {
          ok: true,
          stage: 'upstream_fetch',
          proxyRouteInvoked: baseDiagnostics.proxyRouteInvoked,
          upstreamUrl: targetUrl,
          sessionKeyRaw: sessionKey,
          sessionKeyEncoded: encodedSessionKey,
          authMode,
          authApplied,
          proxyHttpStatus: 200,
          upstreamStatus: upstreamResponse.status,
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          latencyMs,
          failurePoint: baseDiagnostics.failurePoint,
          bodySnippet,
          parsedBody,
          diagnostics: baseDiagnostics,
        },
        200,
      );
    }

    if (!upstreamResponse.ok) {
      const classified = classifyUpstreamError(upstreamResponse.status);
      return buildErrorResponse({
        stage: 'upstream_fetch',
        errorType: classified.errorType,
        message: classified.message,
        upstreamUrl: targetUrl,
        upstreamStatus: upstreamResponse.status,
        status: upstreamResponse.status,
        diagnostics: {
          ...baseDiagnostics,
          parsedBody,
        },
      });
    }

    return new Response(responseText, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    baseDiagnostics.caughtException = { message, stack };
    console.error('[openclaw-proxy] Caught exception:', message, stack);

    return buildErrorResponse({
      stage: 'proxy_fetch',
      errorType: 'exception',
      message,
      status: 500,
      diagnostics: baseDiagnostics,
      rawErrorObject: { message, stack },
    });
  }
});
