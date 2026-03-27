use axum::{
    body::Body,
    http::{
        header::{
            ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
            ACCESS_CONTROL_ALLOW_ORIGIN, HOST, ORIGIN,
        },
        HeaderMap, HeaderValue, Method, Request, Response, StatusCode,
    },
    middleware::Next,
};

pub async fn validate_http(req: Request<Body>, next: Next, port: u16) -> Response<Body> {
    let request_origin = header_str(req.headers(), ORIGIN);

    if req.method() == Method::OPTIONS {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NO_CONTENT;
        apply_response_headers(response.headers_mut(), request_origin.as_deref(), port);
        return response;
    }

    if !is_valid_host(header_str(req.headers(), HOST).as_deref(), port) {
        return forbidden("Forbidden: invalid host", request_origin.as_deref(), port);
    }

    if !is_valid_origin(request_origin.as_deref()) {
        return forbidden("Forbidden: invalid origin", request_origin.as_deref(), port);
    }

    let mut response = next.run(req).await;
    apply_response_headers(response.headers_mut(), request_origin.as_deref(), port);
    response
}

pub fn is_valid_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else {
        return false;
    };

    [
        format!("localhost:{port}"),
        format!("127.0.0.1:{port}"),
        format!("[::1]:{port}"),
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
        "[::1]".to_owned(),
    ]
    .iter()
    .any(|allowed| allowed == host)
}

pub fn is_valid_origin(origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };

    let Ok(url) = url::Url::parse(origin) else {
        return false;
    };

    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    )
}

fn forbidden(message: &'static str, request_origin: Option<&str>, port: u16) -> Response<Body> {
    let mut response = Response::new(Body::from(message));
    *response.status_mut() = StatusCode::FORBIDDEN;
    apply_response_headers(response.headers_mut(), request_origin, port);
    response
}

fn apply_response_headers(headers: &mut HeaderMap, request_origin: Option<&str>, port: u16) {
    headers.insert(
        "Cross-Origin-Resource-Policy",
        HeaderValue::from_static("same-site"),
    );
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );

    let allow_origin = request_origin
        .filter(|origin| is_valid_origin(Some(origin)))
        .map(str::to_owned)
        .unwrap_or_else(|| format!("http://localhost:{port}"));

    if let Ok(header) = HeaderValue::from_str(&allow_origin) {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, header);
    }
}

fn header_str(headers: &HeaderMap, key: axum::http::header::HeaderName) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{is_valid_host, is_valid_origin};

    #[test]
    fn accepts_loopback_hosts() {
        assert!(is_valid_host(Some("localhost:4567"), 4567));
        assert!(is_valid_host(Some("127.0.0.1:4567"), 4567));
        assert!(is_valid_host(Some("[::1]:4567"), 4567));
    }

    #[test]
    fn rejects_non_loopback_hosts() {
        assert!(!is_valid_host(Some("evil.com:4567"), 4567));
        assert!(!is_valid_host(None, 4567));
    }

    #[test]
    fn validates_loopback_origins() {
        assert!(is_valid_origin(Some("http://localhost:4567")));
        assert!(is_valid_origin(Some("http://127.0.0.1:4567")));
        assert!(is_valid_origin(Some("http://[::1]:4567")));
        assert!(is_valid_origin(None));
        assert!(!is_valid_origin(Some("https://evil.com")));
    }
}
