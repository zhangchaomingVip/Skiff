use super::*;

struct Fixture { root: PathBuf, remote: PathBuf, local: PathBuf }
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }
fn run(repo: &Path, args: &[&str]) -> String { git_text(repo, args, "update test").unwrap() }
fn commit(repo: &Path, file: &str, content: &str) -> String {
	fs::write(repo.join(file), content).unwrap();
	run(repo, &["add", "--", file]); run(repo, &["commit", "-qm", file]);
	current_head(repo).unwrap().unwrap()
}
fn setup() -> Fixture {
	let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
	let root = std::env::temp_dir().join(format!("skiff-update-{nonce}"));
	let remote = root.join("remote"); let local = root.join("local");
	fs::create_dir_all(&remote).unwrap();
	run(&remote, &["init", "-q", "-b", "main"]);
	for repo in [&remote] { run(repo, &["config", "user.email", "test@example.invalid"]); run(repo, &["config", "user.name", "Update Test"]); }
	commit(&remote, "base.txt", "base\n");
	run(&root, &["clone", "-q", "remote", "local"]);
	run(&local, &["config", "user.email", "test@example.invalid"]); run(&local, &["config", "user.name", "Update Test"]);
	Fixture { root, remote: fs::canonicalize(remote).unwrap(), local: fs::canonicalize(local).unwrap() }
}

#[test]
fn updates_fast_forward_only_and_preserves_ahead_and_diverged_commits() {
	let fixture = setup(); let local = &fixture.local;
	assert_eq!(update(local).unwrap().status, "upToDate");
	let remote_head = commit(&fixture.remote, "base.txt", "remote update\n");
	let result = update(local).unwrap();
	assert_eq!(result.status, "updated"); assert_eq!(result.head, remote_head);
	assert_eq!(fs::read_to_string(local.join("base.txt")).unwrap().replace("\r\n", "\n"), "remote update\n");
	assert_eq!(run(local, &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 2, "Must not create a merge commit");
	let local_head = commit(local, "local.txt", "local only\n");
	assert_eq!(update(local).unwrap().status, "ahead");
	let remote_head = commit(&fixture.remote, "other.txt", "remote only\n");
	let index = fs::read(local.join(".git/index")).unwrap();
	let result = update(local).unwrap();
	assert_eq!(result.status, "diverged"); assert_eq!(result.head, local_head);
	assert_eq!(run(local, &["rev-parse", "origin/main"]), remote_head);
	assert_eq!(fs::read(local.join(".git/index")).unwrap(), index);
	assert!(!local.join("other.txt").exists());
	assert!(!local.join(".git/MERGE_HEAD").exists());
}

#[test]
fn refuses_dirty_untracked_in_progress_and_unconfigured_targets() {
	let fixture = setup(); let local = &fixture.local;
	let head = current_head(local).unwrap();
	commit(&fixture.remote, "base.txt", "incoming\n");
	fs::write(local.join("base.txt"), "keep local\n").unwrap();
	assert!(update(local).unwrap_err().contains("未提交"));
	run(local, &["add", "base.txt"]);
	assert!(update(local).unwrap_err().contains("未提交"));
	assert_eq!(current_head(local).unwrap(), head);
	assert_eq!(fs::read_to_string(local.join("base.txt")).unwrap(), "keep local\n");
	run(local, &["restore", "--source=HEAD", "--staged", "--worktree", "base.txt"]);
	fs::create_dir(local.join("nested")).unwrap();
	fs::write(local.join("untracked.txt"), "keep\n").unwrap();
	assert!(update(&fs::canonicalize(local.join("nested")).unwrap()).unwrap_err().contains("未跟踪"));
	fs::remove_file(local.join("untracked.txt")).unwrap();
	fs::write(local.join(".git/MERGE_HEAD"), head.as_ref().unwrap()).unwrap();
	assert!(update(local).unwrap_err().contains("merge"));
	fs::remove_file(local.join(".git/MERGE_HEAD")).unwrap();
	run(local, &["checkout", "-q", "--detach"]);
	assert!(update(local).unwrap_err().contains("detached HEAD"));
	run(local, &["checkout", "-q", "main"]);
	run(local, &["branch", "--unset-upstream"]);
	assert!(update(local).unwrap_err().contains("upstream"));
	assert_eq!(current_head(local).unwrap(), head);
}

#[test]
fn rechecks_after_fetch_and_never_overwrites_ignored_files() {
	let fixture = setup(); let local = &fixture.local;
	let before = target(local).unwrap();
	commit(&fixture.remote, "new.txt", "remote\n");
	fetch_upstream(local, &before).unwrap();
	fs::write(local.join("late.txt"), "arrived during fetch\n").unwrap();
	assert!(finish_update(local, &before).unwrap_err().contains("未提交"));
	fs::remove_file(local.join("late.txt")).unwrap();
	run(local, &["checkout", "-qb", "another"]);
	assert!(finish_update(local, &before).is_err());
	run(local, &["checkout", "-q", "main"]);
	fs::write(local.join(".git/info/exclude"), "new.txt\n").unwrap();
	fs::write(local.join("new.txt"), "ignored file to preserve\n").unwrap();
	assert!(finish_update(local, &before).is_err());
	assert_eq!(current_head(local).unwrap().unwrap(), before.head);
	assert_eq!(fs::read_to_string(local.join("new.txt")).unwrap(), "ignored file to preserve\n");
}

#[test]
fn failed_fetch_does_not_change_local_branch_or_expose_remote_url() {
	let fixture = setup(); let local = &fixture.local;
	let head = current_head(local).unwrap();
	run(local, &["remote", "set-url", "origin", "missing-private-remote"]);
	let error = update(local).unwrap_err();
	assert!(error.contains("获取远程代码失败"));
	assert!(!error.contains("missing-private-remote"));
	assert_eq!(current_head(local).unwrap(), head);
}
