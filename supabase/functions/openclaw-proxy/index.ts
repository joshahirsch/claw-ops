const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-openclaw-base-url, x-openclaw-auth-mode, x-openclaw-auth-token, x-openclaw-auth-header-name, x-openclaw-auth-header-prefix, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type ErrorStage = 'proxy_fetch' | 'upstream_fetch' | 'response_parse';
type ErrorType = 'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'scope_limited' | 'not_found' | 'invalid_path' | 'server_error' | 'exception';

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
  upstreamBody?: string;
  status?: number;
  diagnostics: Record<string, unknown>;
  rawErrorObject?: unknown;
  failureCategory?: string;
}) {
  return jsonResponse(
    {
      ok: false,
      stage: args.stage,
      errorType: args.errorType,
      message: args.message,
      upstreamUrl: args.upstreamUrl,
      upstreamStatus: args.upstreamStatus,
      upstreamBody: args.upstreamBody,
      rawErrorObject: args.rawErrorObject,
      diagnostics: args.diagnostics,
      failureCategory: args.failureCategory,
    },
    args.status ?? 500,
  );
}

function classifyUpstreamError(status: number, body: string): { errorType: ErrorType; message: string; failureCategory: string } {
  const lowered = body.toLowerCase();

  if (status === 401) {
    return { errorType: 'unauthorized', message: '401 Unauthorized — token rejected by gateway', failureCategory: 'token-rejected' };
  }
  if (status === 403) {
    if (lowered.includes('scope') || lowered.includes('operator.read') || lowered.includes('permission')) {
      // Extract the actual scope error message
      let scopeDetail = '403 Forbidden — missing required scope';
      try {
        const parsed = JSON.parse(body);
        if (parsed.error) scopeDetail = `403 Forbidden — ${parsed.error}`;
        if (parsed.message) scopeDetail = `403 Forbidden — ${parsed.message}`;
      } catch { /* use default */ }
      return { errorType: 'scope_limited', message: scopeDetail, failureCategory: 'token-accepted-missing-scope' };
    }
    return { errorType: 'forbidden', message: '403 Forbidden', failureCategory: 'token-rejected' };
  }
  if (status === 404) return { errorType: 'not_found', message: '404 Not Found — endpoint may not exist', failureCategory: 'wrong-endpoint-or-protocol' };
  if (status === 405) return { errorType: 'invalid_path', message: '405 Method Not Allowed — wrong HTTP method for this endpoint', failureCategory: 'wrong-endpoint-or-protocol' };
  if (status === 422) return { errorType: 'invalid_path', message: '422 Invalid session key/path', failureCategory: 'wrong-endpoint-or-protocol' };
  if (status >= 500) return { errorType: 'server_error', message: `${status} Server error`, failureCategory: 'gateway-unreachable' };
  return { errorType: 'exception', message: `${status} Upstream error`, failureCategory: 'unknown' };
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
    return jsonResponse(
      {
        ok: true,
        function: 'openclaw-proxy',
        method: 'OPTIONS',
        optionsHit: true,
      },
      200,
    );
  }

  try {
    const requestBody = await parseBody(req, baseDiagnostics);
    const probeType = (asOptionalString(requestBody.probe) || url.searchParams.get('probe') || undefined) as ProbeType | undefined;

    if (probeType === 'health') {
      return jsonResponse({ ok: true, function: 'openclaw-proxy', method: req.method }, 200);
    }

    const sessionKey = asOptionalString(requestBody.sessionKey) || url.searchParams.get('sessionKey') || undefined;
    const follow = asOptionalString(requestBody.follow) || url.searchParams.get('follow') || undefined;
    const limit = asOptionalString(requestBody.limit) || url.searchParams.get('limit') || undefined;
    const cursor = asOptionalString(requestBody.cursor) || url.searchParams.get('cursor') || undefined;
    const includeTools = parseBooleanParam(requestBody.includeTools) || url.searchParams.get('includeTools') === '1';

    // Support custom endpoint path (default: /sessions/{key}/history)
    const endpointPath = asOptionalString(requestBody.endpointPath) || url.searchParams.get('endpointPath') || undefined;

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
      endpointPath,
    };

    console.log('[openclaw-proxy] Config:', JSON.stringify(baseDiagnostics.incomingConfig));

    if (probeType === 'echo') {
      return jsonResponse(
        {
          ok: true,
          function: 'openclaw-proxy',
          probe: 'echo',
          method: req.method,
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
        failureCategory: 'config-invalid',
      });
    }

    if (!sessionKey && !endpointPath) {
      return buildErrorResponse({
        stage: 'proxy_fetch',
        errorType: 'invalid_path',
        message: 'Missing session key and no custom endpoint path',
        status: 400,
        diagnostics: baseDiagnostics,
        failureCategory: 'config-invalid',
      });
    }

    const baseUrl = openclawBaseUrl.replace(/\/+$/, '');
    const encodedSessionKey = sessionKey ? encodeURIComponent(sessionKey) : '';
    const params = new URLSearchParams();
    const isSSEProbe = probeType === 'sse';

    if (isSSEProbe || follow === '1') params.set('follow', '1');
    if (!probeType || probeType !== 'basic') {
      if (limit) params.set('limit', limit);
      if (cursor) params.set('cursor', cursor);
      if (includeTools) params.set('includeTools', '1');
    }

    const queryString = params.toString();

    // Use custom endpoint path if provided, otherwise default to session history
    const resolvedPath = endpointPath
      ? endpointPath
      : `/sessions/${encodedSessionKey}/history`;

    const targetUrl = `${baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ''}`;

    baseDiagnostics.upstreamUrl = targetUrl;
    baseDiagnostics.failurePoint = isSSEProbe ? 'sse_follow_probe' : 'session_history_fetch';

    console.log('[openclaw-proxy] Upstream URL:', targetUrl);

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

    const fetchStartedAt = Date.now();

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

      return buildErrorResponse({
        stage: 'proxy_fetch',
        errorType,
        message,
        upstreamUrl: targetUrl,
        status: 502,
        diagnostics: baseDiagnostics,
        rawErrorObject: { message, stack },
        failureCategory: lowered.includes('dns') || lowered.includes('enotfound') ? 'dns-or-tunnel' : 'gateway-unreachable',
      });
    }

    const latencyMs = Date.now() - fetchStartedAt;
    baseDiagnostics.upstreamStatus = upstreamResponse.status;
    baseDiagnostics.statusText = upstreamResponse.statusText;
    baseDiagnostics.latencyMs = latencyMs;

    // SSE passthrough for live follow mode
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
    const bodySnippet = responseText.slice(0, 1000);
    baseDiagnostics.bodySnippet = bodySnippet;

    let parsedBody: unknown = null;
    try {
      parsedBody = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      if (!probeType) {
        return buildErrorResponse({
          stage: 'response_parse',
          errorType: 'exception',
          message: 'Failed to parse upstream JSON response',
          upstreamUrl: targetUrl,
          upstreamStatus: upstreamResponse.status,
          upstreamBody: bodySnippet,
          status: 502,
          diagnostics: baseDiagnostics,
        });
      }
    }

    if (!upstreamResponse.ok) {
      const classified = classifyUpstreamError(upstreamResponse.status, responseText);

      if (probeType) {
        return jsonResponse(
          {
            ok: false,
            stage: 'upstream_fetch',
            errorType: classified.errorType,
            message: classified.message,
            failureCategory: classified.failureCategory,
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

      return buildErrorResponse({
        stage: 'upstream_fetch',
        errorType: classified.errorType,
        message: classified.message,
        upstreamUrl: targetUrl,
        upstreamStatus: upstreamResponse.status,
        upstreamBody: bodySnippet,
        status: upstreamResponse.status,
        diagnostics: { ...baseDiagnostics, parsedBody },
        failureCategory: classified.failureCategory,
      });
    }

    // Probe success response
    if (probeType) {
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

    // Standard success passthrough
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
