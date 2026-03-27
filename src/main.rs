use std::{path::PathBuf, sync::Arc};

use clap::Parser;
use cmux_hub::{actions, server};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser, Debug)]
#[command(author, version, about = "cmux-hub rewritten in Rust")]
struct Cli {
    /// Server port (default: random)
    #[arg(short, long)]
    port: Option<u16>,

    /// Toolbar actions JSON file (use - for stdin)
    #[arg(short, long)]
    actions: Option<String>,

    /// Enable debug logging
    #[arg(long)]
    debug: bool,

    /// Target git repository path
    #[arg(default_value = ".")]
    repo_path: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(if cli.debug {
            "cmux_hub=debug,tower_http=debug"
        } else {
            "cmux_hub=info,tower_http=info"
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let actions = actions::load_actions(cli.actions.as_deref()).await?;
    let state = Arc::new(server::AppState::new(cli.repo_path, actions).await?);
    server::serve(state, cli.port).await
}
