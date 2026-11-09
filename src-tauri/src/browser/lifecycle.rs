use super::*;

impl Service {
	pub async fn retire_chat(&self, chat_id: &str, delete_profile: bool) -> Result<()> {
		if chat_id.is_empty() || chat_id.len() > 256 {
			return Err("无效聊天标识".into());
		}
		let _registration = self.registration.lock().await;
		self.retired.lock().unwrap().insert(chat_id.into());
		self.revoke_chat_agents(chat_id);
		let target = self
			.entries
			.lock()
			.unwrap()
			.get(chat_id)
			.map(|entry| entry.status().target);
		if let Some(target) = target {
			self.close_instance(&target).await?;
		}
		if delete_profile {
			self.delete_profile(chat_id)?;
		}
		self.entries.lock().unwrap().remove(chat_id);
		Ok(())
	}
	pub async fn restore_chat(&self, chat_id: &str) -> Result<()> {
		if chat_id.is_empty() || chat_id.len() > 256 {
			return Err("无效聊天标识".into());
		}
		let _registration = self.registration.lock().await;
		self.retired.lock().unwrap().remove(chat_id);
		Ok(())
	}
	fn delete_profile(&self, chat_id: &str) -> Result<()> {
		let profiles = self.root.join("profiles");
		let path = profiles.join(format!("{:x}", Sha256::digest(chat_id.as_bytes())));
		let parent = std::fs::symlink_metadata(&profiles).map_err(|_| "无法读取浏览器专用目录")?;
		if parent.file_type().is_symlink() || !parent.is_dir() {
			return Err("浏览器专用目录已被替换，未删除".into());
		}
		match std::fs::symlink_metadata(&path) {
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
			Err(_) => return Err("无法读取此聊天的浏览器登录数据".into()),
			Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
				return Err("聊天浏览器目录已被替换，未删除".into())
			}
			Ok(_) => {}
		}
		let parent = std::fs::canonicalize(&profiles).map_err(|_| "无法确认浏览器专用目录")?;
		let resolved = std::fs::canonicalize(&path).map_err(|_| "无法确认聊天浏览器目录")?;
		if resolved.parent() != Some(parent.as_path()) {
			return Err("浏览器登录数据目录归属不匹配".into());
		}
		std::fs::remove_dir_all(&path)
			.map_err(|_| "浏览器已关闭，但此聊天的登录数据删除失败，请重试".into())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use futures_util::FutureExt;
	#[tokio::test]
	async fn deleting_one_profile_is_confined_and_retirement_blocks_new_leases() {
		let root = std::env::temp_dir().join(format!("skiff-browser-delete-{}", opaque()));
		let service = Service::new(root.clone(), vec![]).await.unwrap();
		let profile = |id: &str| {
			root.join("profiles")
				.join(format!("{:x}", Sha256::digest(id.as_bytes())))
		};
		for id in ["../../outside", "other"] {
			std::fs::create_dir_all(profile(id)).unwrap();
			std::fs::write(profile(id).join("keep"), "fixture").unwrap();
		}
		std::fs::write(root.join("outside"), "untouched").unwrap();
		service.retire_chat("../../outside", true).await.unwrap();
		assert!(!profile("../../outside").exists());
		assert!(profile("other").join("keep").exists());
		assert!(root.join("outside").exists());
		assert!(service.start("../../outside".into()).await.is_err());
		service.restore_chat("../../outside").await.unwrap();
		assert!(
			service.entries.lock().unwrap().is_empty(),
			"Restore must be lazy"
		);
		// A file replacing a directory must be rejected; retain unrelated data and permit retry.
		std::fs::write(profile("replacement"), "do not delete").unwrap();
		assert!(service.retire_chat("replacement", true).await.is_err());
		assert!(profile("replacement").is_file());
		service.shutdown().await.unwrap();
		drop(service);
		let _ = std::fs::remove_dir_all(root);
	}

	async fn cookie(service: &Service, status: &BrowserStatus, url: String) -> String {
		service
			.execute(
				status.target.clone(),
				opaque(),
				status.control_version,
				Action::Open { url },
			)
			.await
			.unwrap();
		service
			.execute(
				status.target.clone(),
				opaque(),
				status.control_version,
				Action::Snapshot,
			)
			.await
			.unwrap()
			.to_string()
	}
	async fn roundtrip(service: &Arc<Service>, base: &str) {
		let a = service.start("a".into()).await.unwrap();
		let b = service.start("b".into()).await.unwrap();
		cookie(service, &a, format!("{base}/set/a")).await;
		cookie(service, &b, format!("{base}/set/b")).await;
		assert!(cookie(service, &a, format!("{base}/read"))
			.await
			.contains("owner=a"));
		assert!(cookie(service, &b, format!("{base}/read"))
			.await
			.contains("owner=b"));
		let old = service.grant_agent("a".into()).unwrap().unwrap();
		service.retire_chat("a", false).await.unwrap();
		assert!(service.grant_agent("a".into()).is_err());
		assert!(service.status(&a.target).await.is_err());
		assert_eq!(
			service.status(&b.target).await.unwrap().control,
			Control::Ai
		);
		service.restore_chat("a").await.unwrap();
		assert!(!service.entries.lock().unwrap().contains_key("a"));
		let restored = service.start("a".into()).await.unwrap();
		assert_ne!(a.target.generation, restored.target.generation);
		assert!(
			cookie(service, &restored, format!("{base}/read"))
				.await
				.contains("owner=a"),
			"Persistent cookie survives archive/restore"
		);
		drop(old);
		// Close and reopen concurrently: registration must wait until previous profile owner exits.
		let close = service.close(&restored.target);
		let open = async {
			tokio::time::sleep(Duration::from_millis(20)).await;
			service.start("a".into()).await
		};
		let (closed, reopened) = tokio::join!(Box::pin(close), Box::pin(open));
		closed.unwrap();
		let reopened = reopened.unwrap();
		assert_ne!(restored.target.generation, reopened.target.generation);
		assert_eq!(reopened.control, Control::Ai);
		assert!(cookie(service, &reopened, format!("{base}/read"))
			.await
			.contains("owner=a"));
		service.retire_chat("a", true).await.unwrap();
		service.restore_chat("a").await.unwrap();
		let fresh = service.start("a".into()).await.unwrap();
		assert!(
			!cookie(service, &fresh, format!("{base}/read"))
				.await
				.contains("owner=a"),
			"Deletion removes only this login profile"
		);
		assert!(cookie(service, &b, format!("{base}/read"))
			.await
			.contains("owner=b"));
		Box::pin(startup_retirement(service)).await;
		Box::pin(crash_cookie_restore(service, base)).await;
	}
	async fn crash_cookie_restore(service: &Arc<Service>, base: &str) {
		let previous = service.entries.lock().unwrap().get("b").unwrap().status();
		service.close(&previous.target).await.unwrap();
		let persisted = service.start("b".into()).await.unwrap();
		assert!(cookie(service, &persisted, format!("{base}/read"))
			.await
			.contains("owner=b"));
		// Simulate process death releasing the lease; the new owner reaps verified old daemons.
		service.root_lease.lock().unwrap().take();
		let recovered = Service::new(service.root.clone(), vec![]).await.unwrap();
		let b = recovered.start("b".into()).await.unwrap();
		assert!(
			cookie(&recovered, &b, format!("{base}/read"))
				.await
				.contains("owner=b"),
			"Crash recovery keeps the persistent profile cookie"
		);
		let a = recovered.start("a".into()).await.unwrap();
		assert!(
			!cookie(&recovered, &a, format!("{base}/read"))
				.await
				.contains("owner=b"),
			"Recovered profiles remain isolated"
		);
		recovered.shutdown().await.unwrap();
	}
	async fn startup_retirement(service: &Arc<Service>) {
		let launched = service.clone();
		let start = tokio::spawn(async move { launched.start("starting".into()).await });
		tokio::time::timeout(Duration::from_secs(10), async {
			while !service.entries.lock().unwrap().contains_key("starting") {
				tokio::time::sleep(Duration::from_millis(5)).await;
			}
		})
		.await
		.unwrap();
		service.retire_chat("starting", false).await.unwrap();
		let _ = start.await.unwrap();
		assert!(
			!service.entries.lock().unwrap().contains_key("starting"),
			"Retirement must reap startup that finishes late"
		);
		assert!(service.start("starting".into()).await.is_err());
		service.restore_chat("starting").await.unwrap();
		assert!(!service.entries.lock().unwrap().contains_key("starting"));
	}
	#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
	#[ignore = "requires Windows, agent-browser 0.41.2 and isolated Chrome"]
	async fn real_profiles_archive_delete_and_fast_reopen() {
		use axum::{response::Html, routing::get, Router};
		let root = std::env::temp_dir().join(format!("skiff-browser-lifecycle-{}", opaque()));
		let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
		let base = format!("http://{}", listener.local_addr().unwrap());
		let site = tokio::spawn(async move {
			axum::serve(listener, Router::new().route("/{*path}", get(|axum::extract::Path(path): axum::extract::Path<String>| async move {
			Html(format!("<!doctype html><button id=cookie></button><script>{}document.querySelector('#cookie').textContent=document.cookie||'no cookie';</script>", if path.starts_with("set/") { format!("document.cookie='owner={}; Max-Age=86400; Path=/';", path.trim_start_matches("set/")) } else { String::new() }))
		}))).await.unwrap();
		});
		let service = Service::new(root.clone(), vec![]).await.unwrap();
		let mut settings = service.settings.lock().unwrap().clone();
		settings.enabled = true;
		service.configure(settings).await.unwrap();
		let result =
			Box::pin(std::panic::AssertUnwindSafe(roundtrip(&service, &base)).catch_unwind()).await;
		let cleanup = service.shutdown().await;
		site.abort();
		drop(service);
		let _ = std::fs::remove_dir_all(root);
		assert!(cleanup.is_ok(), "{cleanup:?}");
		if let Err(panic) = result {
			std::panic::resume_unwind(panic);
		}
	}
}
