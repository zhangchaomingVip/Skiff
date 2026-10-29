//! Read-only history. Revisions are resolved to immutable commits before use;
//! paths are literal, project-relative, and never passed to an external diff driver.
use super::*;
#[cfg(test)]
#[path = "git_history_tests.rs"]
mod tests;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRef {
	name: String,
	label: String,
	kind: &'static str,
	hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
	hash: String,
	parents: Vec<String>,
	author: String,
	email: String,
	date: String,
	subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
	repository_root: String,
	scope: String,
	branch: String,
	head: Option<String>,
	refs: Vec<HistoryRef>,
	commits: Vec<HistoryCommit>,
	has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
	path: String,
	old_path: Option<String>,
	status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
	hash: String,
	parents: Vec<String>,
	message: String,
	files: Vec<CommitFile>,
}

fn resolve_commit(repo: &Path, revision: &str) -> Result<String, String> {
	git_text(repo, &["rev-parse", "--verify", "--end-of-options", &format!("{revision}^{{commit}}")], "提交不存在或已被移除")
}

fn checked_hash(repo: &Path, hash: &str) -> Result<String, String> {
	if ![40, 64].contains(&hash.len()) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
		return Err("提交标识必须是完整的 Git hash".into());
	}
	resolve_commit(repo, hash)
}

fn history(root: &Path, reference: Option<&str>, limit: usize) -> Result<GitHistory, String> {
	let repo = repository_for(root)?;
	let scope = repo_scope(&repo, root)?;
	let head = current_head(&repo)?;
	let branch = git_text(&repo, &["branch", "--show-current"], "读取当前分支")?;
	let raw = git_text(&repo, &["for-each-ref", "--sort=refname", "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(symref)", "refs/heads", "refs/remotes", "refs/tags"], "读取分支与标签")?;
	let refs = raw.lines().filter_map(|line| {
		let fields = line.split('\0').collect::<Vec<_>>();
		if fields.len() != 4 || !fields[3].is_empty() { return None; }
		let (kind, label) = if let Some(label) = fields[0].strip_prefix("refs/heads/") { ("local", label) }
		else if let Some(label) = fields[0].strip_prefix("refs/remotes/") { ("remote", label) }
		else { ("tag", fields[0].strip_prefix("refs/tags/")?) };
		Some(HistoryRef { name: fields[0].into(), label: label.into(), kind, hash: if fields[2].is_empty() { fields[1] } else { fields[2] }.into() })
	}).collect::<Vec<_>>();
	let mut command = git_command(&repo);
	let limit = limit.clamp(1, 1000);
	command.args(["--literal-pathspecs", "log", "--topo-order", "--date-order", "--no-show-signature", "-z", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s", &format!("-{}", limit + 1)]);
	if let Some(reference) = reference.filter(|value| !value.is_empty()) {
		if reference != "HEAD" && !refs.iter().any(|item| item.name == reference) { return Err("分支或标签已不存在，请刷新后重试".into()); }
		if reference == "HEAD" && head.is_none() {
			return Ok(GitHistory { repository_root: display_path(&repo), scope, branch, head, refs, commits: vec![], has_more: false });
		}
		command.arg(resolve_commit(&repo, reference)?);
	} else {
		command.arg("--all");
		if let Some(hash) = &head { command.arg(hash); }
	}
	command.arg("--");
	if !scope.is_empty() { command.arg(&scope); }
	let bytes = checked(command, "读取提交历史")?.stdout;
	let fields = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
	let mut commits = fields.chunks_exact(6).map(|row| {
		let text = |index: usize| String::from_utf8_lossy(row[index]).into_owned();
		HistoryCommit { hash: text(0), parents: text(1).split_whitespace().map(String::from).collect(), author: text(2), email: text(3), date: text(4), subject: text(5) }
	}).collect::<Vec<_>>();
	let has_more = commits.len() > limit;
	commits.truncate(limit);
	Ok(GitHistory { repository_root: display_path(&repo), scope, branch, head, refs, commits, has_more })
}

fn commit_detail(root: &Path, hash: &str) -> Result<CommitDetail, String> {
	let repo = repository_for(root)?;
	let hash = checked_hash(&repo, hash)?;
	let parents = git_text(&repo, &["show", "-s", "--format=%P", &hash], "读取父提交")?.split_whitespace().map(String::from).collect::<Vec<_>>();
	let message = git_text(&repo, &["show", "-s", "--format=%B", &hash], "读取提交说明")?;
	let scope = repo_scope(&repo, root)?;
	let mut command = git_command(&repo);
	command.arg("--literal-pathspecs");
	if let Some(parent) = parents.first() { command.args(["diff", "--name-status", "-z", "-M", parent, &hash]); }
	else { command.args(["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "-M", &hash]); }
	command.arg("--");
	if !scope.is_empty() { command.arg(&scope); }
	let bytes = checked(command, "读取提交文件")?.stdout;
	let mut records = bytes.split(|byte| *byte == 0).filter(|part| !part.is_empty());
	let mut files = Vec::new();
	let relative = |bytes: &[u8]| {
		let path = String::from_utf8_lossy(bytes).into_owned();
		if scope.is_empty() { path } else { path.strip_prefix(&format!("{scope}/")).unwrap_or(&path).into() }
	};
	while let Some(status) = records.next() {
		let Some(first) = records.next() else { break; };
		let status = String::from_utf8_lossy(status).into_owned();
		let (path, old_path) = if status.starts_with('R') || status.starts_with('C') {
			let Some(next) = records.next() else { break; };
			(relative(next), Some(relative(first)))
		} else { (relative(first), None) };
		files.push(CommitFile { path, old_path, status });
	}
	Ok(CommitDetail { hash, parents, message, files })
}

fn commit_diff(root: &Path, hash: &str, path: &str) -> Result<DiffPreview, String> {
	clean_relative(path, false)?;
	let detail = commit_detail(root, hash)?;
	let file = detail.files.iter().find(|file| file.path == path).ok_or("该文件不在此提交的项目变更中")?;
	let repo = repository_for(root)?;
	let scope = repo_scope(&repo, root)?;
	let scoped = |path: &str| if scope.is_empty() { path.to_string() } else { format!("{scope}/{path}") };
	let mut command = git_command(&repo);
	command.arg("--literal-pathspecs");
	if let Some(parent) = detail.parents.first() { command.args(["diff", parent, &detail.hash]); }
	else { command.args(["diff-tree", "--root", "--no-commit-id", "-r", &detail.hash]); }
	command.args(["-p", "-M", "--no-ext-diff", "--no-textconv", "--no-color", "--", &scoped(path)]);
	if let Some(old_path) = &file.old_path { command.arg(scoped(old_path)); }
	let mut bytes = checked(command, "读取历史 Diff")?.stdout;
	let binary = bytes.windows(b"Binary files ".len()).any(|part| part == b"Binary files ");
	let truncated = bytes.len() > DIFF_LIMIT;
	bytes.truncate(DIFF_LIMIT);
	Ok(DiffPreview { path: path.into(), kind: if binary { "binary" } else { "text" }, content: (!binary).then(|| String::from_utf8_lossy(&bytes).into_owned()), truncated, version: detail.hash })
}

#[tauri::command]
pub async fn get_project_git_history(root: String, reference: Option<String>, limit: usize) -> Result<GitHistory, String> {
	tauri::async_runtime::spawn_blocking(move || history(&canonical_root(&root)?, reference.as_deref(), limit)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_project_git_commit(root: String, hash: String) -> Result<CommitDetail, String> {
	tauri::async_runtime::spawn_blocking(move || commit_detail(&canonical_root(&root)?, &hash)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_project_git_commit_diff(root: String, hash: String, path: String) -> Result<DiffPreview, String> {
	tauri::async_runtime::spawn_blocking(move || commit_diff(&canonical_root(&root)?, &hash, &path)).await.map_err(|error| error.to_string())?
}
