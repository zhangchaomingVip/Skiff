//! Update the checked-out branch only when its upstream can be fast-forwarded.
use super::*;
use std::time::{Duration, Instant};
#[cfg(test)]
#[path = "git_update_tests.rs"]
mod tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
	repository_root: String,
	branch: String,
	upstream: String,
	head: String,
	status: &'static str,
}

#[derive(PartialEq, Debug)]
struct Target {
	branch: String,
	head: String,
	remote: String,
	remote_ref: String,
	upstream: String,
}

fn target(repo: &Path) -> Result<Target, String> {
	let branch = git_text(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"], "当前处于 detached HEAD，先切换到本地分支再更新")?;
	let head = current_head(repo)?.ok_or("仓库还没有提交，请先完成初始配置")?;
	let full_ref = format!("refs/heads/{branch}");
	let raw = git_text(repo, &["for-each-ref", "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)", &full_ref], "读取跟踪分支")?;
	let fields = raw.lines().find_map(|line| {
		let fields = line.split('\0').collect::<Vec<_>>();
		(fields.len() == 4 && fields[0] == full_ref).then_some(fields)
	}).ok_or("无法读取当前分支")?;
	if fields[1].is_empty() || fields[2].is_empty() || fields[3].is_empty() {
		return Err("当前分支没有跟踪远程分支，请先在 Git 中配置 upstream 后重试".into());
	}
	if fields[1] == "." || !fields[2].starts_with("refs/heads/") || !fields[3].starts_with("refs/remotes/") {
		return Err("Update Project 需要当前分支跟踪一个远程分支".into());
	}
	Ok(Target { branch, head, remote: fields[1].into(), remote_ref: fields[2].into(), upstream: fields[3].into() })
}

fn ensure_clean(repo: &Path) -> Result<(), String> {
	if let Some(operation) = operation(repo)? { return Err(format!("仓库正在进行 {operation}，请先完成或取消该操作后再更新")); }
	if git_dir(repo)?.join("sequencer").exists() { return Err("仓库有未完成的 Git 操作，请先处理后再更新".into()); }
	// Check the entire repository even when the selected project is a subdirectory.
	if !status_bytes(repo, "")?.is_empty() { return Err("仓库存在未提交或未跟踪的改动，请先提交或自行保存改动后再更新；Skiff 不会自动暂存或丢弃文件".into()); }
	Ok(())
}

fn fetch_upstream(repo: &Path, target: &Target) -> Result<(), String> {
	let mut command = git_command(repo);
	command.env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "Never")
		.args(["-c", "credential.interactive=false", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=30", "fetch", "--no-tags", "--no-recurse-submodules", "--", &target.remote, &format!("+{}:{}", target.remote_ref, target.upstream)])
		.stdout(Stdio::null()).stderr(Stdio::null());
	// Do not return transport stderr: remote URLs can contain credentials.
	let mut child = command.spawn().map_err(|_| "无法启动 Git 获取远程代码，请检查 Git 安装".to_string())?;
	let start = Instant::now();
	loop {
		match child.try_wait() {
			Ok(Some(status)) => return if status.success() { Ok(()) } else { Err("获取远程代码失败，请检查网络、Git 凭据和远程分支是否存在；本地分支未更新".into()) },
			Ok(None) if start.elapsed() < Duration::from_secs(120) => std::thread::sleep(Duration::from_millis(100)),
			_ => {
				#[cfg(windows)]
				{
					use std::os::windows::process::CommandExt;
					let _ = Command::new("taskkill").creation_flags(0x08000000).args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
				}
				let _ = child.kill(); let _ = child.wait();
				return Err("获取远程代码超时或中断，请检查网络后重试；本地分支未更新".into());
			}
		}
	}
}

fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> Result<bool, String> {
	let mut command = git_command(repo);
	let status = command.args(["merge-base", "--is-ancestor", ancestor, descendant]).stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|_| "无法比较分支历史".to_string())?;
	match status.code() { Some(0) => Ok(true), Some(1) => Ok(false), _ => Err("无法比较分支历史，请检查仓库是否完整".into()) }
}

fn finish_update(repo: &Path, before: &Target) -> Result<UpdateResult, String> {
	if target(repo)? != *before { return Err("获取远程期间当前分支、HEAD 或跟踪配置发生变化，已停止更新，请重试".into()); }
	ensure_clean(repo)?;
	let upstream_head = git_text(repo, &["rev-parse", "--verify", &format!("{}^{{commit}}", before.upstream)], "无法读取远程提交")?;
	let status = if before.head == upstream_head { "upToDate" }
	else if is_ancestor(repo, &upstream_head, &before.head)? { "ahead" }
	else if !is_ancestor(repo, &before.head, &upstream_head)? { "diverged" }
	else {
		let mut command = git_command(repo);
		command.args(["-c", "merge.autoStash=false", "merge", "--ff-only", "--no-edit", "--no-autostash", "--no-overwrite-ignore", &upstream_head]);
		checked(command, "无法快进更新；请检查仓库状态后重试")?;
		"updated"
	};
	Ok(UpdateResult { repository_root: display_path(repo), branch: before.branch.clone(), upstream: before.upstream.strip_prefix("refs/remotes/").unwrap_or(&before.upstream).into(), head: current_head(repo)?.unwrap_or(before.head.clone()), status })
}

fn update(root: &Path) -> Result<UpdateResult, String> {
	let repo = repository_for(root)?;
	ensure_clean(&repo)?;
	let before = target(&repo)?;
	fetch_upstream(&repo, &before)?;
	finish_update(&repo, &before)
}

#[tauri::command]
pub async fn update_project_from_remote(state: tauri::State<'_, WorkbenchState>, root: String) -> Result<UpdateResult, String> {
	let lock = Arc::clone(&state.inner().write_lock);
	tauri::async_runtime::spawn_blocking(move || {
		let _guard = lock.lock().map_err(|_| "Git 写入锁不可用".to_string())?;
		update(&canonical_root(&root)?)
	}).await.map_err(|error| error.to_string())?
}
