//! Commit selected files and push only that commit to the configured upstream.
use super::*;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq)]
struct PushTarget {
	branch: String,
	remote: String,
	reference: String,
}

fn target(repo: &Path) -> Result<PushTarget, String> {
	let branch = git_text(repo, &["symbolic-ref", "--quiet", "HEAD"], "当前处于 detached HEAD，请先切换到本地分支")?;
	let raw = git_text(repo, &["for-each-ref", "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)", &branch], "读取推送目标")?;
	let fields = raw.lines().find_map(|line| {
		let fields = line.split('\0').collect::<Vec<_>>();
		(fields.len() == 3 && fields[0] == branch).then_some(fields)
	}).ok_or("当前分支尚无提交，请先使用 Commit 创建提交并配置上游")?;
	if fields[1].is_empty() || fields[1] == "." || !fields[2].starts_with("refs/heads/") {
		return Err("当前分支没有配置远程上游，请先配置 upstream，或使用 Commit 仅创建本地提交".into());
	}
	Ok(PushTarget { branch, remote: fields[1].into(), reference: fields[2].into() })
}

fn push_commit(repo: &Path, destination: &PushTarget, commit: &str) -> Result<(), String> {
	if target(repo)? != *destination { return Err("推送前分支或上游配置发生变化，已停止推送".into()); }
	let mut command = git_command(repo);
	command.env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "Never")
		.args(["-c", "credential.interactive=false", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=30",
			"-c", &format!("remote.{}.mirror=false", destination.remote), "push", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--",
			&destination.remote, &format!("{commit}:{}", destination.reference)])
		.stdout(Stdio::null()).stderr(Stdio::null());
	// Transport stderr may include credential-bearing URLs. Return safe messages.
	let mut child = command.spawn().map_err(|_| "无法启动 Git 推送，请检查 Git 安装".to_string())?;
	let start = Instant::now();
	loop {
		match child.try_wait() {
			Ok(Some(status)) => return if status.success() { Ok(()) } else { Err("推送失败，请检查网络、Git 凭据或远程分支是否有新提交；处理后可使用 git push 重试".into()) },
			Ok(None) if start.elapsed() < Duration::from_secs(120) => std::thread::sleep(Duration::from_millis(100)),
			_ => {
				#[cfg(windows)]
				{
					use std::os::windows::process::CommandExt;
					let _ = Command::new("taskkill").creation_flags(0x08000000).args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
				}
				let _ = child.kill(); let _ = child.wait();
				return Err("推送超时或中断，请检查远程分支状态后重试".into());
			}
		}
	}
}

pub(super) fn commit_and_push(root: &Path, paths: &[String], message: &str, expected: &str) -> Result<GitWriteResult, String> {
	let repo = repository_for(root)?;
	let destination = target(&repo)?;
	let mut result = commit_selected(root, paths, message, expected)?;
	// A push failure must not turn a successful local commit into a generic failure.
	let pushed = current_head(&repo).and_then(|head| {
		let head = head.ok_or("无法读取已创建的本地提交")?;
		if !head.starts_with(result.commit.as_deref().unwrap_or("missing")) { return Err("提交后 HEAD 已变化，已停止推送".into()); }
		push_commit(&repo, &destination, &head)
	});
	match pushed { Ok(()) => result.pushed = true, Err(error) => result.push_error = Some(error) }
	Ok(result)
}

#[cfg(test)]
mod tests {
	use super::*;
	use super::super::tests::{temporary_repo, commit_all};

	#[test]
	fn commit_push_preserves_selection_and_reports_remote_rejection() {
		let repo = temporary_repo("commit-push");
		fs::write(repo.join("selected.txt"), "base\n").unwrap();
		fs::write(repo.join("other.txt"), "base\n").unwrap();
		commit_all(&repo, "base");
		let remote = repo.parent().unwrap().join(format!("{}-remote.git", repo.file_name().unwrap().to_string_lossy()));
		let mut clone = git_command(&repo); clone.args(["clone", "--bare", "."]).arg(display_path(&remote)); checked(clone, "clone").unwrap();
		let branch = git_text(&repo, &["branch", "--show-current"], "branch").unwrap();
		let mut add = git_command(&repo); add.args(["remote", "add", "origin"]).arg(display_path(&remote)); checked(add, "remote").unwrap();
		let mut upstream = git_command(&repo); upstream.args(["push", "-u", "origin", &branch]); checked(upstream, "upstream").unwrap();
		fs::write(repo.join("selected.txt"), "changed\n").unwrap();
		fs::write(repo.join("other.txt"), "unrelated staged\n").unwrap();
		let mut stage = git_command(&repo); stage.args(["add", "other.txt"]); checked(stage, "stage").unwrap();
		let result = commit_and_push(&repo, &["selected.txt".into()], "selected only", &read_status(&repo).unwrap().version).unwrap();
		assert!(result.pushed);
		assert!(result.push_error.is_none());
		assert_eq!(current_head(&repo).unwrap(), current_head(&remote).unwrap());
		assert_eq!(git_text(&repo, &["diff", "--cached", "--name-only"], "staged").unwrap(), "other.txt");
		assert_eq!(git_text(&remote, &["show", "HEAD:other.txt"], "other").unwrap(), "base");
		let mut deny = git_command(&remote); deny.args(["config", "receive.denyNonFastForwards", "true"]); checked(deny, "deny").unwrap();
		let mut reset = git_command(&repo); reset.args(["reset", "--soft", "HEAD~1"]); checked(reset, "reset").unwrap();
		fs::write(repo.join("selected.txt"), "divergent\n").unwrap();
		let remote_head = current_head(&remote).unwrap();
		let result = commit_and_push(&repo, &["selected.txt".into()], "divergent", &read_status(&repo).unwrap().version).unwrap();
		assert!(!result.pushed);
		assert!(result.push_error.unwrap().contains("推送失败"));
		assert_eq!(remote_head, current_head(&remote).unwrap());
		assert_eq!(git_text(&repo, &["log", "-1", "--format=%s"], "message").unwrap(), "divergent");
		fs::remove_dir_all(repo).unwrap(); fs::remove_dir_all(remote).unwrap();
	}

	#[test]
	fn missing_upstream_does_not_create_commit() {
		let repo = temporary_repo("commit-push-no-upstream");
		fs::write(repo.join("file.txt"), "base\n").unwrap(); commit_all(&repo, "base");
		let head = current_head(&repo).unwrap();
		fs::write(repo.join("file.txt"), "changed\n").unwrap();
		let error = commit_and_push(&repo, &["file.txt".into()], "must not commit", &read_status(&repo).unwrap().version).unwrap_err();
		assert!(error.contains("upstream")); assert_eq!(head, current_head(&repo).unwrap());
		fs::remove_dir_all(repo).unwrap();
	}
}
