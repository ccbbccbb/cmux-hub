use std::{path::Path, process::Stdio};

use anyhow::{anyhow, Context};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct RepoStatus {
    pub branch: String,
    pub has_changes: bool,
    pub changed_files: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone)]
pub struct WorkspaceFingerprint {
    pub head: String,
    pub status_porcelain: String,
}

impl WorkspaceFingerprint {
    pub fn key(&self) -> String {
        format!("{}:{}", self.head.trim(), self.status_porcelain)
    }
}

pub async fn status(repo: &Path) -> anyhow::Result<RepoStatus> {
    let branch = run_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    let porcelain = run_git(repo, ["status", "--porcelain"]).await?;
    let changed_files = porcelain.lines().count();

    Ok(RepoStatus {
        branch: branch.trim().to_owned(),
        has_changes: changed_files > 0,
        changed_files,
    })
}

pub async fn fingerprint(repo: &Path) -> anyhow::Result<WorkspaceFingerprint> {
    let head = run_git(repo, ["rev-parse", "HEAD"]).await?;
    let status_porcelain = run_git(repo, ["status", "--porcelain"]).await?;
    Ok(WorkspaceFingerprint {
        head,
        status_porcelain,
    })
}

pub async fn auto_diff(repo: &Path) -> anyhow::Result<String> {
    run_git(repo, ["diff", "--patch", "--minimal", "HEAD"]).await
}

pub async fn commits(repo: &Path, limit: usize) -> anyhow::Result<Vec<Commit>> {
    let format = "%H%x09%s%x09%an%x09%aI";
    let out = run_git(
        repo,
        [
            "log",
            "--max-count",
            &limit.to_string(),
            &format!("--pretty=format:{format}"),
        ],
    )
    .await?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            Some(Commit {
                hash: parts.next()?.to_owned(),
                subject: parts.next()?.to_owned(),
                author: parts.next()?.to_owned(),
                date: parts.next()?.to_owned(),
            })
        })
        .collect())
}

async fn run_git<'a, I, S>(repo: &Path, args: I) -> anyhow::Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str> + 'a,
{
    let mut cmd = Command::new("git");
    cmd.current_dir(repo)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

    for arg in args {
        cmd.arg(arg.as_ref());
    }

    let output = cmd.output().await.context("failed to spawn git")?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("git command failed: {err}"));
    }

    String::from_utf8(output.stdout).context("git output was not utf-8")
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::*;

    async fn init_repo(path: &Path) {
        tokio::process::Command::new("git")
            .arg("init")
            .current_dir(path)
            .output()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(path)
            .output()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(path)
            .output()
            .await
            .unwrap();

        fs::write(path.join("README.md"), "hello\n").unwrap();
        tokio::process::Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(path)
            .output()
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn status_and_commits_work() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;

        let s = status(dir.path()).await.unwrap();
        assert_eq!(s.changed_files, 0);

        let commits = commits(dir.path(), 5).await.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "init");
    }

    #[tokio::test]
    async fn diff_detects_workspace_change() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;

        fs::write(dir.path().join("README.md"), "hello\nworld\n").unwrap();
        let diff = auto_diff(dir.path()).await.unwrap();
        assert!(diff.contains("+world"));

        let fp = fingerprint(dir.path()).await.unwrap();
        assert!(fp.key().contains("M README.md") || fp.key().contains(" M README.md"));
    }
}
