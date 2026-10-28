use serde::Serialize;
use std::{
	collections::hash_map::DefaultHasher,
	fs,
	hash::{Hash, Hasher},
	path::{Component, Path, PathBuf},
	process::{Command, Output, Stdio},
	sync::{Arc, Mutex},
	time::{SystemTime, UNIX_EPOCH},
};

const DIRECTORY_LIMIT: usize = 500;
const TEXT_LIMIT: u64 = 2 * 1024 * 1024;
const DIFF_LIMIT: usize = 2 * 1024 * 1024;

pub struct WorkbenchState {
	write_lock: Arc<Mutex<()>>,
}

impl Default for WorkbenchState {
	fn default() -> Self { Self { write_lock: Arc::new(Mutex::new(())) } }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
	name: String,
	path: String,
	kind: &'static str,
	size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
	path: String,
	entries: Vec<DirectoryEntry>,
	truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
	path: String,
	kind: &'static str,
	content: Option<String>,
	size: u64,
	modified_ms: Option<u64>,
	version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
	path: String,
	old_path: Option<String>,
	kind: String,
	index_status: String,
	worktree_status: String,
	selectable: bool,
	rollbackable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
	repository_root: String,
	scope: String,
	branch: String,
	head: Option<String>,
	operation: Option<String>,
	version: String,
	entries: Vec<GitEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPreview {
	path: String,
	kind: &'static str,
	content: Option<String>,
	truncated: bool,
	version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWriteResult {
	repository_root: String,
	commit: Option<String>,
	changed_paths: Vec<String>,
	version: String,
}

fn display_path(path: &Path) -> String {
	let mut value = path.to_string_lossy().to_string();
	#[cfg(windows)]
	{
		if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
			value = format!("\\\\{unc}");
		} else if let Some(local) = value.strip_prefix("\\\\?\\") {
			value = local.to_string();
		}
	}
	value
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
	let root = PathBuf::from(root);
	if !root.is_absolute() || !root.is_dir() {
		return Err("项目目录不存在或不是绝对路径".to_string());
	}
	fs::canonicalize(root).map_err(|error| format!("无法访问项目目录：{error}"))
}

fn clean_relative(value: &str, allow_empty: bool) -> Result<PathBuf, String> {
	let path = Path::new(value);
	if path.is_absolute() || (!allow_empty && value.trim().is_empty()) {
		return Err("路径必须是项目内的相对路径".to_string());
	}
	let mut clean = PathBuf::new();
	for component in path.components() {
		match component {
			Component::Normal(part) => clean.push(part),
			Component::CurDir => {}
			_ => return Err("路径不能离开项目目录".to_string()),
		}
	}
	if !allow_empty && clean.as_os_str().is_empty() {
		return Err("路径不能为空".to_string());
	}
	Ok(clean)
}

fn project_path(root: &Path, relative: &str, must_exist: bool) -> Result<(PathBuf, PathBuf), String> {
	let relative = clean_relative(relative, true)?;
	let candidate = root.join(&relative);
	if must_exist {
		let canonical = fs::canonicalize(&candidate).map_err(|error| format!("路径不可用：{error}"))?;
		if !canonical.starts_with(root) {
			return Err("路径越过项目边界".to_string());
		}
		Ok((canonical, relative))
	} else {
		// Deleted Git paths cannot be canonicalized. Canonicalize their nearest
		// existing parent so junctions and directory symlinks still cannot escape.
		let mut parent = candidate.as_path();
		while !parent.exists() {
			parent = parent.parent().ok_or_else(|| "路径越过项目边界".to_string())?;
		}
		let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
		if !canonical_parent.starts_with(root) {
			return Err("路径越过项目边界".to_string());
		}
		Ok((candidate, relative))
	}
}

fn normalized_relative(path: &Path) -> String {
	path.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

#[tauri::command]
pub async fn list_project_directory(root: String, path: String) -> Result<DirectoryPage, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let root = canonical_root(&root)?;
		let (directory, relative) = project_path(&root, &path, true)?;
		if !directory.is_dir() {
			return Err("所选路径不是文件夹".to_string());
		}
		let mut entries = Vec::new();
		for result in fs::read_dir(&directory).map_err(|error| format!("无法读取目录：{error}"))? {
			let item = result.map_err(|error| format!("无法读取目录项：{error}"))?;
			let name = item.file_name().to_string_lossy().to_string();
			if name == ".git" { continue; }
			let metadata = fs::symlink_metadata(item.path()).map_err(|error| error.to_string())?;
			let file_type = metadata.file_type();
			let kind = if file_type.is_symlink() { "link" } else if file_type.is_dir() { "directory" } else { "file" };
			entries.push(DirectoryEntry {
				name,
				path: normalized_relative(&relative.join(item.file_name())),
				kind,
				size: file_type.is_file().then_some(metadata.len()),
			});
		}
		entries.sort_by(|a, b| (a.kind != "directory").cmp(&(b.kind != "directory")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())).then_with(|| a.name.cmp(&b.name)));
		let truncated = entries.len() > DIRECTORY_LIMIT;
		entries.truncate(DIRECTORY_LIMIT);
		Ok(DirectoryPage { path: normalized_relative(&relative), entries, truncated })
	}).await.map_err(|error| error.to_string())?
}

fn fingerprint(metadata: &fs::Metadata) -> String {
	let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos()).unwrap_or_default();
	format!("{}:{modified}", metadata.len())
}

fn looks_binary(bytes: &[u8]) -> bool {
	bytes.iter().take(8192).any(|byte| *byte == 0)
}

#[tauri::command]
pub async fn read_project_file(root: String, path: String) -> Result<FilePreview, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let root = canonical_root(&root)?;
		let (file, relative) = project_path(&root, &path, true)?;
		let metadata = fs::metadata(&file).map_err(|error| error.to_string())?;
		if !metadata.is_file() { return Err("所选路径不是文件".to_string()); }
		let modified_ms = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_millis() as u64);
		let version = fingerprint(&metadata);
		if metadata.len() > TEXT_LIMIT {
			return Ok(FilePreview { path: normalized_relative(&relative), kind: "tooLarge", content: None, size: metadata.len(), modified_ms, version });
		}
		let bytes = fs::read(&file).map_err(|error| format!("无法读取文件：{error}"))?;
		if looks_binary(&bytes) {
			return Ok(FilePreview { path: normalized_relative(&relative), kind: "binary", content: None, size: metadata.len(), modified_ms, version });
		}
		let content = String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本，无法安全预览".to_string())?;
		Ok(FilePreview { path: normalized_relative(&relative), kind: "text", content: Some(content), size: metadata.len(), modified_ms, version })
	}).await.map_err(|error| error.to_string())?
}

fn git_command(repo: &Path) -> Command {
	let mut command = Command::new("git");
	command.current_dir(repo).stdin(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		command.creation_flags(0x08000000);
	}
	command
}

fn checked(mut command: Command, context: &str) -> Result<Output, String> {
	let output = command.output().map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { "未安装 Git，或 Git 不在 PATH 中".to_string() } else { format!("{context}：{error}") })?;
	if output.status.success() { return Ok(output); }
	let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
	Err(if message.is_empty() { format!("{context}失败") } else { format!("{context}：{message}") })
}

fn git_text(repo: &Path, args: &[&str], context: &str) -> Result<String, String> {
	let mut command = git_command(repo);
	command.args(args);
	let output = checked(command, context)?;
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn repository_for(root: &Path) -> Result<PathBuf, String> {
	let value = git_text(root, &["rev-parse", "--show-toplevel"], "无法识别 Git 仓库")?;
	let repo = fs::canonicalize(value).map_err(|error| format!("仓库目录不可访问：{error}"))?;
	if !root.starts_with(&repo) { return Err("项目目录不在识别出的仓库内".to_string()); }
	Ok(repo)
}

fn repo_scope(repo: &Path, root: &Path) -> Result<String, String> {
	root.strip_prefix(repo).map(normalized_relative).map_err(|_| "项目目录不在仓库内".to_string())
}

fn current_head(repo: &Path) -> Result<Option<String>, String> {
	let mut command = git_command(repo);
	command.args(["rev-parse", "--verify", "HEAD"]);
	let output = command.output().map_err(|error| error.to_string())?;
	if output.status.success() { Ok(Some(String::from_utf8_lossy(&output.stdout).trim().to_string())) } else { Ok(None) }
}

fn git_dir(repo: &Path) -> Result<PathBuf, String> {
	let value = git_text(repo, &["rev-parse", "--git-dir"], "无法读取 Git 元数据")?;
	let path = PathBuf::from(value);
	Ok(if path.is_absolute() { path } else { repo.join(path) })
}

fn operation(repo: &Path) -> Result<Option<String>, String> {
	let directory = git_dir(repo)?;
	for (name, label) in [("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")] {
		if directory.join(name).exists() { return Ok(Some(label.to_string())); }
	}
	Ok(None)
}

fn status_bytes(repo: &Path, scope: &str) -> Result<Vec<u8>, String> {
	let mut command = git_command(repo);
	command.args(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"]);
	if !scope.is_empty() { command.arg(scope); }
	Ok(checked(command, "读取 Git 状态")?.stdout)
}

fn path_in_head(repo: &Path, path: &str) -> bool {
	let spec = format!("HEAD:{path}");
	let mut command = git_command(repo);
	command.args(["cat-file", "-e", &spec]);
	command.status().map(|status| status.success()).unwrap_or(false)
}

fn parse_status(repo: &Path, bytes: &[u8]) -> Vec<GitEntry> {
	let records = bytes.split(|byte| *byte == 0).filter(|part| !part.is_empty()).collect::<Vec<_>>();
	let mut entries = Vec::new();
	let mut index = 0;
	while index < records.len() {
		let record = String::from_utf8_lossy(records[index]).to_string();
		index += 1;
		if record.len() < 4 { continue; }
		let x = record.chars().next().unwrap_or(' ');
		let y = record.chars().nth(1).unwrap_or(' ');
		let mut path = record[3..].to_string();
		let mut old_path = None;
		if x == 'R' || x == 'C' {
			if index < records.len() {
				old_path = Some(String::from_utf8_lossy(records[index]).to_string());
				index += 1;
			}
		}
		path = path.replace('\\', "/");
		old_path = old_path.map(|value| value.replace('\\', "/"));
		let kind = if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') { "conflict" }
		else if x == '?' && y == '?' { "untracked" }
		else if x == 'R' || y == 'R' { "renamed" }
		else if x == 'D' || y == 'D' { "deleted" }
		else if x == 'A' || y == 'A' { "added" }
		else { "modified" }.to_string();
		let rollbackable = kind != "untracked" && kind != "conflict" && path_in_head(repo, old_path.as_deref().unwrap_or(&path));
		entries.push(GitEntry { path, old_path, kind: kind.clone(), index_status: x.to_string(), worktree_status: y.to_string(), selectable: kind != "conflict", rollbackable });
	}
	entries
}

fn status_version(repo: &Path, head: &Option<String>, bytes: &[u8], entries: &[GitEntry]) -> String {
	let mut hash = DefaultHasher::new();
	head.hash(&mut hash);
	bytes.hash(&mut hash);
	for entry in entries {
		entry.path.hash(&mut hash);
		let mut index = git_command(repo);
		index.args(["ls-files", "-s", "--", &entry.path]);
		if let Ok(output) = index.output() { output.stdout.hash(&mut hash); }
		let absolute = repo.join(&entry.path);
		if absolute.is_file() {
			let mut worktree = git_command(repo);
			worktree.args(["hash-object", "--no-filters", "--", &entry.path]);
			if let Ok(output) = worktree.output() { output.stdout.hash(&mut hash); }
		} else {
			"missing".hash(&mut hash);
		}
	}
	format!("{:016x}", hash.finish())
}

fn read_status(root: &Path) -> Result<GitStatus, String> {
	let repo = repository_for(root)?;
	let scope = repo_scope(&repo, root)?;
	let bytes = status_bytes(&repo, &scope)?;
	let head = current_head(&repo)?;
	let branch = git_text(&repo, &["branch", "--show-current"], "读取分支")?;
	let mut entries = parse_status(&repo, &bytes);
	let version = status_version(&repo, &head, &bytes, &entries);
	if !scope.is_empty() {
		let prefix = format!("{}/", scope.trim_end_matches('/'));
		for entry in &mut entries {
			entry.path = entry.path.strip_prefix(&prefix).unwrap_or(&entry.path).to_string();
			entry.old_path = entry.old_path.as_ref().map(|path| path.strip_prefix(&prefix).unwrap_or(path).to_string());
		}
	}
	Ok(GitStatus {
		repository_root: display_path(&repo), scope, branch: if branch.is_empty() { "detached HEAD".to_string() } else { branch },
		operation: operation(&repo)?, version, entries, head,
	})
}

#[tauri::command]
pub async fn get_project_git_status(root: String) -> Result<GitStatus, String> {
	tauri::async_runtime::spawn_blocking(move || read_status(&canonical_root(&root)?)).await.map_err(|error| error.to_string())?
}

fn repo_path(root: &Path, repo: &Path, value: &str) -> Result<String, String> {
	let (_, relative) = project_path(root, value, false)?;
	let absolute = root.join(relative);
	let relative = absolute.strip_prefix(repo).map_err(|_| "路径不在仓库范围内".to_string())?;
	Ok(normalized_relative(relative))
}

fn validate_paths(root: &Path, repo: &Path, paths: &[String]) -> Result<Vec<String>, String> {
	if paths.is_empty() { return Err("请至少选择一个文件".to_string()); }
	let mut output = Vec::new();
	for path in paths {
		let value = repo_path(root, repo, path)?;
		if !output.contains(&value) { output.push(value); }
	}
	Ok(output)
}

#[tauri::command]
pub async fn get_project_git_diff(root: String, path: String) -> Result<DiffPreview, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let root = canonical_root(&root)?;
		let status = read_status(&root)?;
		let repo = repository_for(&root)?;
		let repo_path = repo_path(&root, &repo, &path)?;
		let entry = status.entries.iter().find(|entry| entry.path == repo_path || entry.path == path || entry.path.ends_with(&format!("/{path}")));
		let mut bytes = if entry.is_some_and(|entry| entry.kind == "untracked") {
			let (file, _) = project_path(&root, &path, true)?;
			let data = fs::read(file).map_err(|error| error.to_string())?;
			if looks_binary(&data) { return Ok(DiffPreview { path, kind: "binary", content: None, truncated: false, version: status.version }); }
			let content = String::from_utf8(data).map_err(|_| "文件不是 UTF-8 文本".to_string())?;
			format!("--- /dev/null\n+++ b/{repo_path}\n@@ -0,0 +1,{} @@\n{}", content.lines().count(), content.lines().map(|line| format!("+{line}\n")).collect::<String>()).into_bytes()
		} else {
			let mut command = git_command(&repo);
			if status.head.is_some() { command.args(["diff", "--no-ext-diff", "--binary", "HEAD", "--", &repo_path]); }
			else { command.args(["diff", "--cached", "--no-ext-diff", "--binary", "--", &repo_path]); }
			checked(command, "读取文件 Diff")?.stdout
		};
		if bytes.windows(b"GIT binary patch".len()).any(|part| part == b"GIT binary patch") || bytes.windows(b"Binary files differ".len()).any(|part| part == b"Binary files differ") {
			return Ok(DiffPreview { path, kind: "binary", content: None, truncated: false, version: status.version });
		}
		let truncated = bytes.len() > DIFF_LIMIT;
		bytes.truncate(DIFF_LIMIT);
		let content = String::from_utf8_lossy(&bytes).to_string();
		Ok(DiffPreview { path, kind: "text", content: Some(content), truncated, version: status.version })
	}).await.map_err(|error| error.to_string())?
}

fn ensure_expected(status: &GitStatus, expected: &str) -> Result<(), String> {
	if status.version != expected { Err("文件、HEAD 或暂存区已变化，请刷新后重试".to_string()) }
	else if let Some(operation) = &status.operation { Err(format!("仓库正在进行 {operation}，当前不能执行写操作")) }
	else { Ok(()) }
}

fn unique_temp_index(repo: &Path) -> Result<PathBuf, String> {
	let git = git_dir(repo)?;
	let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
	let path = git.join(format!("skiff-index-{}-{nonce}", std::process::id()));
	// Git for Windows rejects the Win32 extended-length prefix in
	// GIT_INDEX_FILE even though std::fs and current_dir accept it.
	Ok(PathBuf::from(display_path(&path)))
}

fn append_paths(command: &mut Command, paths: &[String]) {
	command.arg("--");
	for path in paths { command.arg(path); }
}

fn run_with_index(repo: &Path, index: &Path, args: &[&str], paths: &[String], context: &str) -> Result<Output, String> {
	let mut command = git_command(repo);
	command.env("GIT_INDEX_FILE", index).args(args);
	append_paths(&mut command, paths);
	checked(command, context)
}

fn short_head(repo: &Path) -> Result<String, String> {
	git_text(repo, &["rev-parse", "--short", "HEAD"], "读取提交结果")
}

fn commit_selected(root: &Path, paths: &[String], message: &str, expected: &str) -> Result<GitWriteResult, String> {
	if message.trim().is_empty() { return Err("提交信息不能为空".to_string()); }
	let before = read_status(root)?;
	ensure_expected(&before, expected)?;
	let repo = repository_for(root)?;
	let mut requested = paths.to_vec();
	for entry in &before.entries {
		if requested.contains(&entry.path) {
			if let Some(old_path) = &entry.old_path { requested.push(old_path.clone()); }
		}
	}
	let paths = validate_paths(root, &repo, &requested)?;
	let index = unique_temp_index(&repo)?;
	let result = (|| {
		let mut seed = git_command(&repo);
		seed.env("GIT_INDEX_FILE", &index);
		if before.head.is_some() { seed.args(["read-tree", "HEAD"]); } else { seed.args(["read-tree", "--empty"]); }
		checked(seed, "准备所选文件")?;
		run_with_index(&repo, &index, &["add", "-A"], &paths, "加入所选文件")?;
		let mut diff = git_command(&repo);
		diff.env("GIT_INDEX_FILE", &index).args(["diff", "--cached", "--quiet"]);
		if diff.status().map_err(|error| error.to_string())?.success() { return Err("所选文件没有可提交的改动".to_string()); }
		let mut commit = git_command(&repo);
		commit.env("GIT_INDEX_FILE", &index).args(["commit", "-m", message]);
		checked(commit, "创建本地提交")?;
		// The user's real index was never used for the commit. Rebase only the
		// committed paths onto the new HEAD; unrelated staged intent stays byte-for-
		// byte equivalent and cannot be swept into this commit.
		let mut reconcile = git_command(&repo);
		reconcile.args(["reset", "-q", "HEAD"]);
		append_paths(&mut reconcile, &paths);
		checked(reconcile, "协调提交后的暂存区")?;
		Ok(())
	})();
	let _ = fs::remove_file(&index);
	result?;
	let after = read_status(root)?;
	Ok(GitWriteResult { repository_root: after.repository_root, commit: Some(short_head(&repo)?), changed_paths: paths, version: after.version })
}

#[tauri::command]
pub async fn commit_project_files(state: tauri::State<'_, WorkbenchState>, root: String, paths: Vec<String>, message: String, expected_version: String) -> Result<GitWriteResult, String> {
	let lock = Arc::clone(&state.inner().write_lock);
	tauri::async_runtime::spawn_blocking(move || {
		let _guard = lock.lock().map_err(|_| "Git 写入锁不可用".to_string())?;
		commit_selected(&canonical_root(&root)?, &paths, &message, &expected_version)
	}).await.map_err(|error| error.to_string())?
}

fn rollback_selected(root: &Path, paths: &[String], expected: &str) -> Result<GitWriteResult, String> {
	let before = read_status(root)?;
	ensure_expected(&before, expected)?;
	let Some(_) = before.head else { return Err("仓库还没有 HEAD，无法恢复文件".to_string()); };
	let repo = repository_for(root)?;
	let paths = validate_paths(root, &repo, paths)?;
	for path in &paths {
		let renamed_destination = before.entries.iter().any(|entry| entry.kind == "renamed" && repo_path(root, &repo, &entry.path).ok().as_deref() == Some(path.as_str()) && entry.old_path.as_deref().is_some_and(|old| path_in_head(&repo, &repo_path(root, &repo, old).unwrap_or_default())));
		if !path_in_head(&repo, path) && !renamed_destination { return Err(format!("{path} 在 HEAD 中没有可恢复版本")); }
	}
	let mut command = git_command(&repo);
	command.args(["restore", "--source=HEAD", "--staged", "--worktree"]);
	append_paths(&mut command, &paths);
	checked(command, "恢复所选文件")?;
	let after = read_status(root)?;
	Ok(GitWriteResult { repository_root: after.repository_root, commit: None, changed_paths: paths, version: after.version })
}

#[tauri::command]
pub async fn rollback_project_files(state: tauri::State<'_, WorkbenchState>, root: String, paths: Vec<String>, expected_version: String) -> Result<GitWriteResult, String> {
	let lock = Arc::clone(&state.inner().write_lock);
	tauri::async_runtime::spawn_blocking(move || {
		let _guard = lock.lock().map_err(|_| "Git 写入锁不可用".to_string())?;
		rollback_selected(&canonical_root(&root)?, &paths, &expected_version)
	}).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temporary_repo(name: &str) -> PathBuf {
		let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
		let path = std::env::temp_dir().join(format!("skiff-{name}-{nonce}"));
		fs::create_dir_all(&path).unwrap();
		let mut init = git_command(&path); init.args(["init", "-q"]); checked(init, "init").unwrap();
		let mut email = git_command(&path); email.args(["config", "user.email", "skiff-test@example.invalid"]); checked(email, "email").unwrap();
		let mut user = git_command(&path); user.args(["config", "user.name", "Skiff Test"]); checked(user, "user").unwrap();
		fs::canonicalize(path).unwrap()
	}

	fn commit_all(repo: &Path, message: &str) {
		let mut add = git_command(repo); add.args(["add", "-A"]); checked(add, "add").unwrap();
		let mut commit = git_command(repo); commit.args(["commit", "-q", "-m", message]); checked(commit, "commit").unwrap();
	}

	#[test]
	fn selected_commit_preserves_unrelated_index_and_worktree() {
		let repo = temporary_repo("partial-commit");
		fs::write(repo.join("selected.txt"), "one\n").unwrap();
		fs::write(repo.join("other.txt"), "base\n").unwrap();
		commit_all(&repo, "base");
		fs::write(repo.join("selected.txt"), "two\n").unwrap();
		fs::write(repo.join("other.txt"), "staged\n").unwrap();
		let mut add = git_command(&repo); add.args(["add", "other.txt"]); checked(add, "stage other").unwrap();
		fs::write(repo.join("other.txt"), "worktree\n").unwrap();
		let status = read_status(&repo).unwrap();
		let result = commit_selected(&repo, &["selected.txt".into()], "selected only", &status.version).unwrap();
		assert!(result.commit.is_some());
		assert_eq!(git_text(&repo, &["show", "HEAD:selected.txt"], "show").unwrap(), "two");
		assert_eq!(git_text(&repo, &["show", "HEAD:other.txt"], "show").unwrap(), "base");
		assert_eq!(git_text(&repo, &["show", ":other.txt"], "show index").unwrap(), "staged");
		assert_eq!(fs::read_to_string(repo.join("other.txt")).unwrap(), "worktree\n");
		let _ = fs::remove_dir_all(repo);
	}

	#[test]
	fn path_validation_rejects_parent_components() {
		assert!(clean_relative("../outside", false).is_err());
		assert!(clean_relative("ok/../../outside", false).is_err());
	}

	#[test]
	fn initial_commit_handles_special_paths_and_detects_late_changes() {
		let repo = temporary_repo("initial-commit");
		let name = "中文 space.txt";
		fs::write(repo.join(name), "first\n").unwrap();
		let stale = read_status(&repo).unwrap();
		fs::write(repo.join(name), "second\n").unwrap();
		assert!(commit_selected(&repo, &[name.into()], "stale", &stale.version).unwrap_err().contains("已变化"));
		let current = read_status(&repo).unwrap();
		commit_selected(&repo, &[name.into()], "initial", &current.version).unwrap();
		assert_eq!(git_text(&repo, &["show", &format!("HEAD:{name}")], "show").unwrap(), "second");
		let _ = fs::remove_dir_all(repo);
	}

	#[test]
	fn rollback_restores_tracked_content_without_deleting_untracked_files() {
		let repo = temporary_repo("rollback");
		fs::write(repo.join("tracked.txt"), "base\n").unwrap();
		commit_all(&repo, "base");
		fs::write(repo.join("tracked.txt"), "changed\n").unwrap();
		let mut add = git_command(&repo); add.args(["add", "tracked.txt"]); checked(add, "stage").unwrap();
		fs::write(repo.join("untracked.txt"), "keep\n").unwrap();
		let status = read_status(&repo).unwrap();
		rollback_selected(&repo, &["tracked.txt".into()], &status.version).unwrap();
		assert_eq!(fs::read_to_string(repo.join("tracked.txt")).unwrap().replace("\r\n", "\n"), "base\n");
		assert_eq!(fs::read_to_string(repo.join("untracked.txt")).unwrap(), "keep\n");
		let _ = fs::remove_dir_all(repo);
	}
}
