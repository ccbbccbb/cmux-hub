use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Request, State,
    },
    middleware,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tokio::{
    sync::{mpsc, watch, Mutex, RwLock},
    time::{sleep_until, Instant},
};
use tower_http::{services::ServeDir, trace::TraceLayer};

use crate::{actions::ActionItem, git, security};

const COMMIT_LIMIT: usize = 50;
const WATCH_DEBOUNCE_MS: u64 = 300;

#[derive(Clone)]
pub struct AppState {
    actions: Vec<ActionItem>,
    monitor: RepoMonitor,
}

#[derive(Clone)]
struct RepoMonitor {
    inner: Arc<RepoMonitorInner>,
}

struct RepoMonitorInner {
    repo_path: PathBuf,
    current: RwLock<Option<RepoSnapshot>>,
    refresh_lock: Mutex<()>,
    updates: watch::Sender<MonitorEvent>,
    trigger_tx: mpsc::UnboundedSender<MonitorMessage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RepoSnapshot {
    key: String,
    status: git::RepoStatus,
    diff: String,
    commits: Vec<git::Commit>,
}

#[derive(Clone)]
enum MonitorEvent {
    Idle,
    Update(WsUpdate),
    Error(String),
}

#[derive(Clone)]
enum MonitorMessage {
    Refresh,
    Paths(Vec<PathBuf>),
}

#[derive(Clone, Serialize)]
struct WsUpdate {
    r#type: &'static str,
    status: git::RepoStatus,
    key: String,
    diff: Option<String>,
}

#[derive(Serialize)]
struct WsError<'a> {
    r#type: &'static str,
    message: &'a str,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    service: &'static str,
}

#[derive(Serialize)]
struct AppSnapshot {
    status: git::RepoStatus,
    diff: String,
    commits: Vec<git::Commit>,
    actions: Vec<ActionItem>,
}

impl AppState {
    pub async fn new(repo_path: PathBuf, actions: Vec<ActionItem>) -> anyhow::Result<Self> {
        Ok(Self {
            actions,
            monitor: RepoMonitor::start(repo_path).await?,
        })
    }
}

impl RepoMonitor {
    async fn start(repo_path: PathBuf) -> anyhow::Result<Self> {
        let (updates, _) = watch::channel(MonitorEvent::Idle);
        let (trigger_tx, trigger_rx) = mpsc::unbounded_channel();
        let inner = Arc::new(RepoMonitorInner {
            repo_path: repo_path.clone(),
            current: RwLock::new(None),
            refresh_lock: Mutex::new(()),
            updates,
            trigger_tx,
        });

        inner.refresh().await?;

        let watchers = build_watchers(&repo_path, inner.trigger_tx.clone()).await?;
        tokio::spawn(run_monitor_loop(
            inner.clone(),
            trigger_rx,
            watchers,
            repo_path,
        ));

        Ok(Self { inner })
    }

    async fn snapshot(&self) -> anyhow::Result<RepoSnapshot> {
        if let Some(snapshot) = self.inner.current.read().await.clone() {
            return Ok(snapshot);
        }

        self.inner.refresh().await?;
        self.inner
            .current
            .read()
            .await
            .clone()
            .ok_or_else(|| anyhow::anyhow!("repository snapshot unavailable"))
    }

    fn subscribe(&self) -> watch::Receiver<MonitorEvent> {
        self.inner.updates.subscribe()
    }

    #[cfg(test)]
    async fn refresh_now(&self) -> anyhow::Result<()> {
        let result = self.inner.refresh().await;
        if let Err(err) = &result {
            let _ = self
                .inner
                .updates
                .send(MonitorEvent::Error(err.to_string()));
        }
        result
    }

    #[cfg(test)]
    fn request_refresh(&self) {
        let _ = self.inner.trigger_tx.send(MonitorMessage::Refresh);
    }
}

impl RepoMonitorInner {
    async fn refresh(&self) -> anyhow::Result<()> {
        let _guard = self.refresh_lock.lock().await;

        let workspace = git::inspect_workspace(&self.repo_path).await?;
        let diff = git::auto_diff(&self.repo_path, &workspace.fingerprint).await?;
        let commits = git::commits(&self.repo_path, COMMIT_LIMIT).await?;
        let snapshot = RepoSnapshot {
            key: workspace.fingerprint.key(),
            status: workspace.status,
            diff,
            commits,
        };

        let mut current = self.current.write().await;
        let changed = current.as_ref() != Some(&snapshot);
        *current = Some(snapshot.clone());
        drop(current);

        if changed {
            let _ = self.updates.send(MonitorEvent::Update(WsUpdate {
                r#type: "update",
                status: snapshot.status.clone(),
                key: snapshot.key.clone(),
                diff: Some(snapshot.diff.clone()),
            }));
        }

        Ok(())
    }
}

pub fn build_app(state: Arc<AppState>, port: u16) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/diff/auto", get(diff_auto))
        .route("/api/commits", get(commits))
        .route("/api/actions", get(actions))
        .route("/api/state", get(snapshot))
        .route("/ws", get(ws))
        .with_state(state)
        .layer(middleware::from_fn(move |req: Request, next| {
            security::validate_http(req, next, port)
        }))
        .fallback_service(ServeDir::new("web").append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
}

pub async fn serve(state: Arc<AppState>, port: Option<u16>) -> anyhow::Result<()> {
    let bind = SocketAddr::from(([127, 0, 0, 1], port.unwrap_or(0)));
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let local = listener.local_addr()?;
    let app = build_app(state, local.port());
    tracing::info!(url = %format!("http://{}", local), "cmux-hub rust server started");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<Health> {
    Json(Health {
        ok: true,
        service: "cmux-hub-rust",
    })
}

async fn actions(State(state): State<Arc<AppState>>) -> Json<Vec<ActionItem>> {
    Json(state.actions.clone())
}

async fn status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.monitor.snapshot().await {
        Ok(snapshot) => Json(snapshot.status).into_response(),
        Err(err) => error_response(err),
    }
}

async fn diff_auto(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.monitor.snapshot().await {
        Ok(snapshot) => Json(serde_json::json!({ "diff": snapshot.diff })).into_response(),
        Err(err) => error_response(err),
    }
}

async fn commits(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.monitor.snapshot().await {
        Ok(snapshot) => Json(snapshot.commits).into_response(),
        Err(err) => error_response(err),
    }
}

async fn snapshot(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.monitor.snapshot().await {
        Ok(snapshot) => Json(AppSnapshot {
            status: snapshot.status,
            diff: snapshot.diff,
            commits: snapshot.commits,
            actions: state.actions.clone(),
        })
        .into_response(),
        Err(err) => error_response(err),
    }
}

async fn ws(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, state))
}

async fn ws_loop(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut updates = state.monitor.subscribe();

    match state.monitor.snapshot().await {
        Ok(snapshot) => {
            if send_json(
                &mut sender,
                &WsUpdate {
                    r#type: "update",
                    status: snapshot.status,
                    key: snapshot.key,
                    diff: Some(snapshot.diff),
                },
            )
            .await
            .is_err()
            {
                return;
            }
        }
        Err(err) => {
            if send_json(
                &mut sender,
                &WsError {
                    r#type: "error",
                    message: &err.to_string(),
                },
            )
            .await
            .is_err()
            {
                return;
            }
        }
    }

    loop {
        tokio::select! {
            changed = updates.changed() => {
                if changed.is_err() {
                    break;
                }

                let event = updates.borrow().clone();
                match event {
                    MonitorEvent::Idle => {}
                    MonitorEvent::Update(update) => {
                        if send_json(&mut sender, &update).await.is_err() {
                            break;
                        }
                    }
                    MonitorEvent::Error(message) => {
                        let error = WsError {
                            r#type: "error",
                            message: &message,
                        };
                        if send_json(&mut sender, &error).await.is_err() {
                            break;
                        }
                    }
                }
            }
            maybe_msg = receiver.next() => {
                match maybe_msg {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

async fn send_json<T: Serialize>(
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
    value: &T,
) -> Result<(), ()> {
    let payload = serde_json::to_string(value).map_err(|_| ())?;
    sender
        .send(Message::Text(payload.into()))
        .await
        .map_err(|_| ())
}

async fn build_watchers(
    repo_path: &Path,
    trigger_tx: mpsc::UnboundedSender<MonitorMessage>,
) -> anyhow::Result<Vec<RecommendedWatcher>> {
    let mut watchers = vec![watch_path(repo_path, trigger_tx.clone())?];
    let git_dir = git::resolve_git_dir(repo_path).await?;
    if !git_dir.starts_with(repo_path) {
        watchers.push(watch_path(&git_dir, trigger_tx)?);
    }
    Ok(watchers)
}

fn watch_path(
    path: &Path,
    trigger_tx: mpsc::UnboundedSender<MonitorMessage>,
) -> anyhow::Result<RecommendedWatcher> {
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                let _ = trigger_tx.send(MonitorMessage::Paths(event.paths));
            }
            Err(err) => {
                tracing::warn!(error = %err, "repo watcher error");
                let _ = trigger_tx.send(MonitorMessage::Refresh);
            }
        })?;

    watcher.watch(path, RecursiveMode::Recursive)?;
    Ok(watcher)
}

async fn run_monitor_loop(
    inner: Arc<RepoMonitorInner>,
    mut trigger_rx: mpsc::UnboundedReceiver<MonitorMessage>,
    watchers: Vec<RecommendedWatcher>,
    repo_path: PathBuf,
) {
    let _watchers = watchers;
    let git_dir = git::resolve_git_dir(&repo_path).await.ok();

    while let Some(message) = trigger_rx.recv().await {
        let mut should_refresh =
            should_refresh_for_message(&repo_path, git_dir.as_deref(), message);
        let mut deadline = Instant::now() + Duration::from_millis(WATCH_DEBOUNCE_MS);

        loop {
            let sleeper = sleep_until(deadline);
            tokio::pin!(sleeper);

            tokio::select! {
                maybe_message = trigger_rx.recv() => {
                    match maybe_message {
                        Some(next_message) => {
                            should_refresh |= should_refresh_for_message(
                                &repo_path,
                                git_dir.as_deref(),
                                next_message,
                            );
                            deadline = Instant::now() + Duration::from_millis(WATCH_DEBOUNCE_MS);
                        }
                        None => return,
                    }
                }
                _ = &mut sleeper => {
                    if should_refresh {
                        if let Err(err) = inner.refresh().await {
                            tracing::warn!(error = %err, "failed to refresh repository snapshot");
                            let _ = inner.updates.send(MonitorEvent::Error(err.to_string()));
                        }
                    }
                    break;
                }
            }
        }
    }
}

fn should_refresh_for_message(
    repo_path: &Path,
    git_dir: Option<&Path>,
    message: MonitorMessage,
) -> bool {
    match message {
        MonitorMessage::Refresh => true,
        MonitorMessage::Paths(paths) => paths_are_relevant(repo_path, git_dir, paths),
    }
}

fn paths_are_relevant(repo_path: &Path, git_dir: Option<&Path>, paths: Vec<PathBuf>) -> bool {
    if paths.is_empty() {
        return true;
    }

    paths
        .into_iter()
        .any(|path| is_relevant_path(repo_path, git_dir, &path))
}

fn is_relevant_path(repo_path: &Path, git_dir: Option<&Path>, path: &Path) -> bool {
    if contains_component(path, "node_modules") {
        return false;
    }

    let repo_git_dir = repo_path.join(".git");
    if path.starts_with(&repo_git_dir) {
        return is_ref_change(path.strip_prefix(&repo_git_dir).unwrap_or(path));
    }

    if let Some(git_dir) = git_dir {
        if path.starts_with(git_dir) {
            return is_ref_change(path.strip_prefix(git_dir).unwrap_or(path));
        }
    }

    true
}

fn contains_component(path: &Path, needle: &str) -> bool {
    path.components()
        .any(|component| component.as_os_str() == needle)
}

fn is_ref_change(path: &Path) -> bool {
    let value = path.to_string_lossy();
    value.contains("/refs/")
        || value.contains("\\refs\\")
        || value.ends_with("HEAD")
        || value.ends_with("COMMIT_EDITMSG")
}

fn error_response(err: anyhow::Error) -> axum::response::Response {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": err.to_string() })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, sync::Arc, time::Duration};

    use axum::{
        body::{to_bytes, Body},
        http::{header::ORIGIN, Request, StatusCode},
    };
    use tower::util::ServiceExt;

    use super::{build_app, AppState, MonitorEvent};

    async fn run_ok(path: &Path, args: &[&str]) {
        let output = tokio::process::Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    async fn init_repo(path: &Path) {
        run_ok(path, &["init", "-b", "main"]).await;
        run_ok(path, &["config", "user.email", "test@example.com"]).await;
        run_ok(path, &["config", "user.name", "Test User"]).await;
        fs::write(path.join("README.md"), "hello\n").unwrap();
        run_ok(path, &["add", "README.md"]).await;
        run_ok(path, &["commit", "-m", "init"]).await;
        run_ok(path, &["update-ref", "refs/remotes/origin/main", "HEAD"]).await;
        run_ok(
            path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        )
        .await;
    }

    #[tokio::test]
    async fn rejects_invalid_host() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = Arc::new(
            AppState::new(dir.path().to_path_buf(), Vec::new())
                .await
                .unwrap(),
        );
        let app = build_app(state, 4567);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/status")
                    .header("host", "evil.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_invalid_origin() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = Arc::new(
            AppState::new(dir.path().to_path_buf(), Vec::new())
                .await
                .unwrap(),
        );
        let app = build_app(state, 4567);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/status")
                    .header("host", "localhost:4567")
                    .header(ORIGIN, "https://evil.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn state_endpoint_returns_cached_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        fs::write(dir.path().join("README.md"), "hello\nworld\n").unwrap();

        let state = Arc::new(
            AppState::new(dir.path().to_path_buf(), Vec::new())
                .await
                .unwrap(),
        );
        let app = build_app(state, 4567);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/state")
                    .header("host", "localhost:4567")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"]["branch"], "main");
        assert!(json["diff"].as_str().unwrap().contains("+world"));
    }

    #[tokio::test]
    async fn responses_include_security_headers() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = Arc::new(
            AppState::new(dir.path().to_path_buf(), Vec::new())
                .await
                .unwrap(),
        );
        let app = build_app(state, 4567);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/status")
                    .header("host", "localhost:4567")
                    .header(ORIGIN, "http://127.0.0.1:9999")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("cross-origin-resource-policy")
                .unwrap(),
            "same-site"
        );
        assert_eq!(
            response.headers().get("x-content-type-options").unwrap(),
            "nosniff"
        );
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "http://127.0.0.1:9999"
        );
    }

    #[tokio::test]
    async fn ws_route_rejects_invalid_origin() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = Arc::new(
            AppState::new(dir.path().to_path_buf(), Vec::new())
                .await
                .unwrap(),
        );
        let app = build_app(state, 4567);

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/ws")
                    .header("host", "localhost:4567")
                    .header(ORIGIN, "https://evil.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn file_change_publishes_monitor_update() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = AppState::new(dir.path().to_path_buf(), Vec::new())
            .await
            .unwrap();
        let mut receiver = state.monitor.subscribe();

        fs::write(dir.path().join("README.md"), "hello\nworld\n").unwrap();
        state.monitor.request_refresh();

        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                receiver.changed().await.unwrap();
                match receiver.borrow().clone() {
                    MonitorEvent::Update(update)
                        if update.diff.as_deref().unwrap_or("").contains("+world") =>
                    {
                        break
                    }
                    _ => {}
                }
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn refresh_error_keeps_last_good_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        let state = AppState::new(dir.path().to_path_buf(), Vec::new())
            .await
            .unwrap();
        let baseline = state.monitor.snapshot().await.unwrap();
        let mut receiver = state.monitor.subscribe();

        tokio::fs::remove_dir_all(dir.path().join(".git"))
            .await
            .unwrap();
        let err = state.monitor.refresh_now().await.unwrap_err();
        assert!(err.to_string().contains("git command failed"));

        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                receiver.changed().await.unwrap();
                if let MonitorEvent::Error(message) = receiver.borrow().clone() {
                    assert!(!message.is_empty());
                    break;
                }
            }
        })
        .await
        .unwrap();

        let cached = state.monitor.inner.current.read().await.clone().unwrap();
        assert_eq!(cached, baseline);
    }
}
