/**
 * Security middleware for local server.
 * Ref: https://green.sapphi.red/blog/local-server-security-best-practices
 */

type SecurityConfig = {
  port: number;
  allowedHosts?: string[];
};

/**
 * Validate the Host header to prevent DNS rebinding attacks.
 */
export function isValidHost(hostHeader: string | null, config: SecurityConfig): boolean {
  if (!hostHeader) return false;

  const allowed = config.allowedHosts ?? [
    `localhost:${config.port}`,
    `127.0.0.1:${config.port}`,
    `[::1]:${config.port}`,
    // Without port (some browsers omit default ports)
    "localhost",
    "127.0.0.1",
    "[::1]",
  ];

  return allowed.includes(hostHeader);
}

/**
 * Validate the Origin header for CORS and CSWSH protection.
 */
export function isValidOrigin(origin: string | null, config: SecurityConfig): boolean {
  if (!origin) return true; // same-origin GET requests may not include Origin
  const allowed = [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`];
  return allowed.includes(origin);
}

const WRITE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Check Sec-Fetch-Site for write operations (CSRF protection).
 * Only allows same-origin requests for state-changing methods.
 */
export function isValidSecFetchSite(secFetchSite: string | null, method: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return true;

  // If the header is missing, we can't verify - allow for non-browser clients
  if (!secFetchSite) return true;

  return secFetchSite === "same-origin" || secFetchSite === "none";
}

/**
 * Build security headers for responses.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Validate an incoming request against all security checks.
 * Returns null if valid, or a Response with error if invalid.
 */
export function validateRequest(req: Request, config: SecurityConfig): Response | null {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const secFetchSite = req.headers.get("sec-fetch-site");

  // Host header validation (DNS rebinding)
  if (!isValidHost(host, config)) {
    return new Response("Forbidden: invalid host", { status: 403 });
  }

  // Origin validation (CORS/CSRF)
  // Reject null origin on write requests (blocks file:// and sandboxed iframe attacks)
  if (!origin && WRITE_METHODS.has(req.method.toUpperCase()) && secFetchSite) {
    return new Response("Forbidden: missing origin", { status: 403 });
  }
  if (!isValidOrigin(origin, config)) {
    return new Response("Forbidden: invalid origin", { status: 403 });
  }

  // Sec-Fetch-Site validation (CSRF for write operations)
  if (!isValidSecFetchSite(secFetchSite, req.method)) {
    return new Response("Forbidden: cross-origin write", { status: 403 });
  }

  return null;
}

/**
 * Build CORS headers for preflight and regular responses.
 */
export function corsHeaders(config: SecurityConfig): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": `http://localhost:${config.port}`,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/**
 * Validate WebSocket upgrade request origin.
 */
export function isValidWebSocketOrigin(req: Request, config: SecurityConfig): boolean {
  const origin = req.headers.get("origin");
  return isValidOrigin(origin, config);
}
