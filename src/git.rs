use std::{
    path::{Path, PathBuf},
    process::{Output, Stdio},
};

use anyhow::{anyhow, Context};
use futures::future::try_join_all;
use serde::Serialize;
use tokio::process::Command;

const DEFAULT_BRANCH_PLACEHOLDER: &str = "(no commits)";
const NO_HEAD_KEY: &str = "NO_HEAD";
const CACHED_BASE: &str = "--cached";

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RepoStatus {
    pub branch: String,
    pub has_changes: bool,
    pub changed_files: usize,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceFingerprint {
    pub branch: String,
    pub head: Option<String>,
    pub status_porcelain: String,
    pub diff_base: String,
    pub include_untracked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceInfo {
    pub status: RepoStatus,
    pub fingerprint: WorkspaceFingerprint,
}

impl WorkspaceFingerprint {
    pub fn key(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}",
            self.branch.trim(),
            self.head.as_deref().map(str::trim).unwrap_or(NO_HEAD_KEY),
            self.diff_base.trim(),
            self.include_untracked,
            self.status_porcelain
        )
    }
}

pub async fn inspect_workspace(repo: &Path) -> anyhow::Result<WorkspaceInfo> {
    let branch = current_branch(repo).await?;
    let status_porcelain = run_git(repo, ["status", "--porcelain"]).await?;
    let changed_files = status_porcelain.lines().count();
    let head = maybe_run_git(repo, ["rev-parse", "--verify", "HEAD"]).await?;
    let (diff_base, include_untracked) = auto_diff_plan(repo, &branch, head.as_ref()).await?;

    Ok(WorkspaceInfo {
        status: RepoStatus {
            branch: branch.clone(),
            has_changes: changed_files > 0,
            changed_files,
        },
        fingerprint: WorkspaceFingerprint {
            branch,
            head,
            status_porcelain,
            diff_base,
            include_untracked,
        },
    })
}

pub async fn auto_diff(repo: &Path, fingerprint: &WorkspaceFingerprint) -> anyhow::Result<String> {
    let tracked = if fingerprint.diff_base == CACHED_BASE {
        run_git(repo, ["diff", "--patch", "--cached"]).await?
    } else {
        run_git(repo, ["diff", "--patch", &fingerprint.diff_base]).await?
    };

    let untracked = if fingerprint.include_untracked {
        untracked_diff(repo).await?
    } else {
        String::new()
    };

    let parts = [tracked, untracked]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.trim_end().to_owned())
        .collect::<Vec<_>>();

    Ok(parts.join("\n"))
}

pub async fn commits(repo: &Path, limit: usize) -> anyhow::Result<Vec<Commit>> {
    if !has_head(repo).await? {
        return Ok(Vec::new());
    }

    let format = "%H%x1f%s%x1f%an%x1f%aI%x1e";
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
        .split('\x1e')
        .filter(|record| !record.trim().is_empty())
        .filter_map(|record| {
            let mut parts = record.split('\x1f');
            Some(Commit {
                hash: parts.next()?.trim().to_owned(),
                subject: parts.next()?.to_owned(),
                author: parts.next()?.to_owned(),
                date: parts.next()?.trim().to_owned(),
            })
        })
        .collect())
}

pub async fn resolve_git_dir(repo: &Path) -> anyhow::Result<PathBuf> {
    let git_dir = run_git(repo, ["rev-parse", "--git-dir"]).await?;
    let git_dir = git_dir.trim();
    let path = PathBuf::from(git_dir);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(repo.join(path))
    }
}

async fn auto_diff_plan(
    repo: &Path,
    branch: &str,
    head: Option<&String>,
) -> anyhow::Result<(String, bool)> {
    if head.is_none() {
        return Ok((CACHED_BASE.to_owned(), true));
    }

    let default_branch = default_branch(repo).await?;
    let current_branch = branch.trim();

    let Some(default_branch) = default_branch else {
        return Ok(("HEAD".to_owned(), true));
    };

    if current_branch == default_branch.trim_start_matches("origin/") {
        return Ok(("HEAD".to_owned(), true));
    }

    if let Some(merge_base) = merge_base(repo, "HEAD", &default_branch).await? {
        return Ok((merge_base, false));
    }

    Ok(("HEAD".to_owned(), true))
}

async fn current_branch(repo: &Path) -> anyhow::Result<String> {
    match maybe_run_git(repo, ["symbolic-ref", "--short", "HEAD"]).await? {
        Some(branch) => Ok(branch.trim().to_owned()),
        None if has_head(repo).await? => Ok("HEAD".to_owned()),
        None => Ok(DEFAULT_BRANCH_PLACEHOLDER.to_owned()),
    }
}

async fn default_branch(repo: &Path) -> anyhow::Result<Option<String>> {
    if let Some(branch) = maybe_run_git(
        repo,
        ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    )
    .await?
    {
        return Ok(Some(branch.trim().to_owned()));
    }

    for candidate in ["origin/main", "origin/master"] {
        if maybe_run_git(repo, ["rev-parse", "--verify", candidate])
            .await?
            .is_some()
        {
            return Ok(Some(candidate.to_owned()));
        }
    }

    Ok(None)
}

async fn merge_base(repo: &Path, branch1: &str, branch2: &str) -> anyhow::Result<Option<String>> {
    Ok(maybe_run_git(repo, ["merge-base", branch1, branch2])
        .await?
        .map(|base| base.trim().to_owned()))
}

async fn has_head(repo: &Path) -> anyhow::Result<bool> {
    Ok(maybe_run_git(repo, ["rev-parse", "--verify", "HEAD"])
        .await?
        .is_some())
}

async fn untracked_diff(repo: &Path) -> anyhow::Result<String> {
    let files = run_git(repo, ["ls-files", "--others", "--exclude-standard"]).await?;
    let files = files
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();

    let repo = repo.to_path_buf();
    let diffs = try_join_all(
        files
            .into_iter()
            .map(|file| untracked_file_diff(repo.clone(), file)),
    )
    .await?;

    Ok(diffs
        .into_iter()
        .filter(|diff| !diff.trim().is_empty())
        .map(|diff| diff.trim_end().to_owned())
        .collect::<Vec<_>>()
        .join("\n"))
}

async fn untracked_file_diff(repo: PathBuf, file: String) -> anyhow::Result<String> {
    run_git_with_allowed_status(
        &repo,
        [
            "diff",
            "--no-index",
            "--patch",
            "--unified=3",
            "--",
            "/dev/null",
            &file,
        ],
        &[0, 1],
    )
    .await
}

async fn maybe_run_git<'a, I, S>(repo: &Path, args: I) -> anyhow::Result<Option<String>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str> + 'a,
{
    let output = run_git_output(repo, args).await?;
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .context("git output was not utf-8")
            .map(Some);
    }

    Ok(None)
}

async fn run_git<'a, I, S>(repo: &Path, args: I) -> anyhow::Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str> + 'a,
{
    let output = run_git_output(repo, args).await?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("git command failed: {err}"));
    }

    String::from_utf8(output.stdout).context("git output was not utf-8")
}

async fn run_git_with_allowed_status<'a, I, S>(
    repo: &Path,
    args: I,
    allowed_statuses: &[i32],
) -> anyhow::Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str> + 'a,
{
    let output = run_git_output(repo, args).await?;
    if output.status.success()
        || output
            .status
            .code()
            .is_some_and(|status| allowed_statuses.contains(&status))
    {
        return String::from_utf8(output.stdout).context("git output was not utf-8");
    }

    let err = String::from_utf8_lossy(&output.stderr);
    Err(anyhow!("git command failed: {err}"))
}

async fn run_git_output<'a, I, S>(repo: &Path, args: I) -> anyhow::Result<Output>
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

    cmd.output().await.context("failed to spawn git")
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::*;

    async fn run_ok(path: &Path, args: &[&str]) {
        let output = Command::new("git")
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
        run_ok(path, &["add", "."]).await;
        run_ok(path, &["commit", "-m", "init"]).await;
    }

    async fn configure_origin_main(path: &Path) {
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
    async fn status_and_commits_work() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;

        let workspace = inspect_workspace(dir.path()).await.unwrap();
        assert_eq!(workspace.status.changed_files, 0);
        assert_eq!(workspace.status.branch, "main");

        let commits = commits(dir.path(), 5).await.unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "init");
    }

    #[tokio::test]
    async fn default_branch_diff_includes_untracked_files() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        configure_origin_main(dir.path()).await;

        fs::write(dir.path().join("untracked.txt"), "new\n").unwrap();

        let workspace = inspect_workspace(dir.path()).await.unwrap();
        let diff = auto_diff(dir.path(), &workspace.fingerprint).await.unwrap();

        assert!(workspace.fingerprint.include_untracked);
        assert!(diff.contains("b/untracked.txt"));
    }

    #[tokio::test]
    async fn feature_branch_uses_merge_base_and_excludes_untracked_files() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;
        configure_origin_main(dir.path()).await;

        run_ok(dir.path(), &["checkout", "-b", "feature/test"]).await;
        fs::write(dir.path().join("README.md"), "hello\nworld\n").unwrap();
        fs::write(dir.path().join("untracked.txt"), "new\n").unwrap();

        let workspace = inspect_workspace(dir.path()).await.unwrap();
        let diff = auto_diff(dir.path(), &workspace.fingerprint).await.unwrap();

        assert!(!workspace.fingerprint.include_untracked);
        assert_ne!(workspace.fingerprint.diff_base, "HEAD");
        assert!(diff.contains("+world"));
        assert!(!diff.contains("untracked.txt"));
    }

    #[tokio::test]
    async fn unborn_repo_uses_cached_diff_and_untracked_files() {
        let dir = tempfile::tempdir().unwrap();
        run_ok(dir.path(), &["init", "-b", "main"]).await;
        run_ok(dir.path(), &["config", "user.email", "test@example.com"]).await;
        run_ok(dir.path(), &["config", "user.name", "Test User"]).await;

        fs::write(dir.path().join("README.md"), "hello\n").unwrap();
        run_ok(dir.path(), &["add", "README.md"]).await;
        fs::write(dir.path().join("scratch.txt"), "tmp\n").unwrap();

        let workspace = inspect_workspace(dir.path()).await.unwrap();
        let diff = auto_diff(dir.path(), &workspace.fingerprint).await.unwrap();
        let commits = commits(dir.path(), 5).await.unwrap();

        assert_eq!(workspace.status.branch, "main");
        assert_eq!(workspace.fingerprint.diff_base, CACHED_BASE);
        assert!(workspace.fingerprint.include_untracked);
        assert!(diff.contains("+++ b/README.md"));
        assert!(diff.contains("b/scratch.txt"));
        assert!(commits.is_empty());
    }

    #[tokio::test]
    async fn commit_subjects_with_tabs_are_parsed() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path()).await;

        fs::write(dir.path().join("notes.txt"), "tabs\n").unwrap();
        run_ok(dir.path(), &["add", "notes.txt"]).await;
        run_ok(dir.path(), &["commit", "-m", "feat:\tadd tabs"]).await;

        let commits = commits(dir.path(), 5).await.unwrap();
        assert_eq!(commits[0].subject, "feat:\tadd tabs");
    }
}
