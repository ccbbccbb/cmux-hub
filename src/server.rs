use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::{
    sync::RwLock,
    time::{interval, MissedTickBehavior},
};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};

use crate::{actions::ActionItem, git};

#[derive(Clone)]
pub struct AppState {
    repo_path: PathBuf,
    actions: Vec<ActionItem>,
    cache: Arc<RwLock<DiffCache>>,
}

#[derive(Clone, Default)]
struct DiffCache {
    key: String,
    diff: String,
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
    pub fn new(repo_path: PathBuf, actions: Vec<ActionItem>) -> Self {
        Self {
            repo_path,
            actions,
            cache: Arc::new(RwLock::new(DiffCache::default())),
        }
    }
}

pub async fn serve(state: Arc<AppState>, port: Option<u16>) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/diff/auto", get(diff_auto))
        .route("/api/commits", get(commits))
        .route("/api/actions", get(actions))
        .route("/api/state", get(snapshot))
        .route("/ws", get(ws))
        .with_state(state)
        .fallback_service(ServeDir::new("web").append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let bind = SocketAddr::from(([127, 0, 0, 1], port.unwrap_or(0)));
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let local = listener.local_addr()?;
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
    match git::status(&state.repo_path).await {
        Ok(status) => Json(status).into_response(),
        Err(err) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn diff_auto(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match git::fingerprint(&state.repo_path).await {
        Ok(fp) => match diff_with_cache_keyed(&state, fp.key()).await {
            Ok(diff) => Json(serde_json::json!({ "diff": diff })).into_response(),
            Err(err) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn commits(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match git::commits(&state.repo_path, 50).await {
        Ok(commits) => Json(commits).into_response(),
        Err(err) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn snapshot(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let status_fut = git::status(&state.repo_path);
    let commits_fut = git::commits(&state.repo_path, 50);
    let fp_fut = git::fingerprint(&state.repo_path);

    match tokio::try_join!(status_fut, commits_fut, fp_fut) {
        Ok((status, commits, fp)) => match diff_with_cache_keyed(&state, fp.key()).await {
            Ok(diff) => Json(AppSnapshot {
                status,
                diff,
                commits,
                actions: state.actions.clone(),
            })
            .into_response(),
            Err(err) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn ws(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, state))
}

async fn ws_loop(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut ticker = interval(Duration::from_millis(600));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_key = String::new();

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let status = git::status(&state.repo_path).await;
                let fingerprint = git::fingerprint(&state.repo_path).await;

                let payload = match (status, fingerprint) {
                    (Ok(status), Ok(fingerprint)) => {
                        let key = fingerprint.key();
                        let diff = if key != last_key {
                            match diff_with_cache_keyed(&state, key.clone()).await {
                                Ok(d) => Some(d),
                                Err(err) => {
                                    let error_payload = serde_json::json!({
                                        "type": "error",
                                        "message": err.to_string(),
                                    })
                                    .to_string();
                                    if sender.send(Message::Text(error_payload.into())).await.is_err() {
                                        break;
                                    }
                                    None
                                }
                            }
                        } else {
                            None
                        };

                        last_key = key.clone();
                        serde_json::json!({
                            "type": "update",
                            "status": status,
                            "key": key,
                            "diff": diff,
                        })
                        .to_string()
                    }
                    (Err(err), _) | (_, Err(err)) => serde_json::json!({
                        "type": "error",
                        "message": err.to_string(),
                    })
                    .to_string(),
                };

                if sender.send(Message::Text(payload.into())).await.is_err() {
                    break;
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

async fn diff_with_cache_keyed(state: &Arc<AppState>, key: String) -> anyhow::Result<String> {
    {
        let cache = state.cache.read().await;
        if cache.key == key {
            return Ok(cache.diff.clone());
        }
    }

    let diff = git::auto_diff(&state.repo_path).await?;
    let mut cache = state.cache.write().await;
    cache.key = key;
    cache.diff = diff.clone();
    Ok(diff)
}
