use super::*;

struct Repo(PathBuf);
impl Drop for Repo { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn run(repo: &Path, args: &[&str]) -> String { git_text(repo, args, "history test").unwrap() }
fn setup() -> Repo {
	let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
	let path = std::env::temp_dir().join(format!("skiff-history-{nonce}"));
	fs::create_dir_all(&path).unwrap();
	let repo = Repo(fs::canonicalize(path).unwrap());
	run(&repo.0, &["init", "-q", "-b", "main"]);
	run(&repo.0, &["config", "user.email", "test@example.invalid"]);
	run(&repo.0, &["config", "user.name", "History Test"]);
	repo
}
fn commit(repo: &Path, message: &str) -> String {
	run(repo, &["add", "-A"]); run(repo, &["commit", "-q", "-m", message]);
	current_head(repo).unwrap().unwrap()
}

#[test]
fn history_preserves_merges_refs_pagination_and_detached_head() {
	let fixture = setup(); let repo = &fixture.0;
	assert!(history(repo, None, 100).unwrap().commits.is_empty());
	assert!(history(repo, Some("HEAD"), 100).unwrap().commits.is_empty());
	fs::write(repo.join("base.txt"), "base\n").unwrap();
	let base = commit(repo, "初始提交");
	run(repo, &["tag", "-a", "v1", "-m", "release"]);
	run(repo, &["checkout", "-q", "-b", "feature/tree"]);
	fs::write(repo.join("feature.txt"), "feature\n").unwrap();
	let feature = commit(repo, "分支提交");
	run(repo, &["checkout", "-q", "main"]);
	fs::write(repo.join("main.txt"), "main\n").unwrap();
	let main = commit(repo, "主线提交");
	run(repo, &["merge", "--no-ff", "feature/tree", "-m", "合并分支"]);
	let merge = current_head(repo).unwrap().unwrap();
	run(repo, &["update-ref", "refs/remotes/origin/main", &merge]);
	let result = history(repo, None, 2).unwrap();
	assert!(result.has_more); assert_eq!(result.commits.len(), 2);
	assert_eq!(result.commits[0].hash, merge);
	assert_eq!(result.commits[0].parents, vec![main, feature.clone()]);
	assert_eq!(result.commits[0].subject, "合并分支");
	assert!(result.refs.iter().any(|item| item.kind == "tag" && item.hash == base));
	assert!(result.refs.iter().any(|item| item.name == "refs/remotes/origin/main"));
	assert_eq!(history(repo, Some("refs/heads/feature/tree"), 100).unwrap().commits.len(), 2);
	assert_eq!(history(repo, Some("refs/tags/v1"), 100).unwrap().commits[0].hash, base);
	let details = commit_detail(repo, &merge).unwrap();
	assert_eq!(details.files.len(), 1); assert_eq!(details.files[0].path, "feature.txt");
	assert!(commit_diff(repo, &merge, "feature.txt").unwrap().content.unwrap().contains("+feature"));
	run(repo, &["checkout", "-q", "--detach", &feature]);
	let detached = history(repo, Some("HEAD"), 100).unwrap();
	assert!(detached.branch.is_empty()); assert_eq!(detached.head, Some(feature));
	assert!(history(repo, Some("--all"), 100).is_err());
	assert!(history(repo, Some("refs/heads/missing"), 100).is_err());
}

#[test]
fn historical_diff_handles_root_rename_delete_binary_and_scope_without_writing() {
	let fixture = setup(); let repo = &fixture.0;
	fs::create_dir(repo.join("src")).unwrap();
	fs::write(repo.join("src/[draft] 中文.txt"), "first\nsecond\n").unwrap();
	fs::write(repo.join("outside.txt"), "outside\n").unwrap();
	let initial = commit(repo, "初始\n\n详细说明");
	assert_eq!(commit_detail(repo, &initial).unwrap().files.len(), 2);
	assert!(commit_diff(repo, &initial, "src/[draft] 中文.txt").unwrap().content.unwrap().contains("+first"));
	run(repo, &["mv", "src/[draft] 中文.txt", "src/renamed.txt"]);
	let renamed = commit(repo, "rename");
	let detail = commit_detail(repo, &renamed).unwrap();
	assert_eq!(detail.files[0].old_path.as_deref(), Some("src/[draft] 中文.txt"));
	assert!(commit_diff(repo, &renamed, "src/renamed.txt").unwrap().content.unwrap().contains("rename from"));
	fs::remove_file(repo.join("src/renamed.txt")).unwrap();
	fs::write(repo.join("src/image.bin"), [0, 1, 2, 3]).unwrap();
	let deleted = commit(repo, "delete and binary");
	assert!(commit_diff(repo, &deleted, "src/renamed.txt").unwrap().content.unwrap().contains("-first"));
	assert_eq!(commit_diff(repo, &deleted, "src/image.bin").unwrap().kind, "binary");
	let scoped = fs::canonicalize(repo.join("src")).unwrap();
	assert_eq!(commit_detail(&scoped, &initial).unwrap().files[0].path, "[draft] 中文.txt");
	assert!(commit_diff(&scoped, &initial, "[draft] 中文.txt").unwrap().content.unwrap().contains("+first"));
	assert!(commit_diff(&scoped, &initial, "../outside.txt").is_err());
	assert!(commit_diff(repo, &initial, ":(glob)**").is_err());
	assert!(commit_detail(repo, "HEAD").is_err());
	fs::write(repo.join("outside.txt"), "staged change\n").unwrap();
	run(repo, &["add", "outside.txt"]);
	fs::write(repo.join("outside.txt"), "working change\n").unwrap();
	let before_index = fs::read(git_dir(repo).unwrap().join("index")).unwrap();
	let before_head = current_head(repo).unwrap();
	history(repo, None, 100).unwrap(); commit_detail(repo, &initial).unwrap(); commit_diff(repo, &initial, "outside.txt").unwrap();
	assert_eq!(before_head, current_head(repo).unwrap());
	assert_eq!(before_index, fs::read(git_dir(repo).unwrap().join("index")).unwrap());
	assert_eq!(fs::read_to_string(repo.join("outside.txt")).unwrap(), "working change\n");
}
