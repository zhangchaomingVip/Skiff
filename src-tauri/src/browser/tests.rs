use super::*;

async fn killed_client_takeover(service: &Service, first: &BrowserStatus) -> BrowserStatus {
	let entry = service.entry(&first.target).unwrap();
	let mut client = entry
		.runtime
		.command(&["wait".into(), "2200".into()])
		.spawn()
		.unwrap();
	tokio::time::sleep(Duration::from_millis(450)).await;
	client.kill().await.unwrap();
	client.wait().await.unwrap();
	let started = std::time::Instant::now();
	let begun = service
		.begin_control(&first.target, ControlAction::TakeOver)
		.await
		.unwrap();
	assert_eq!(begun.control, Control::TakingOver);
	let human = service
		.complete_control(
			&first.target,
			ControlAction::TakeOver,
			begun.control_version,
		)
		.await
		.unwrap();
	assert_eq!(human.control, Control::Human);
	assert!(
		started.elapsed() >= Duration::from_millis(1200),
		"Drain must outlive the terminated CLI client"
	);
	let resumed = service
		.control(&first.target, ControlAction::Return)
		.await
		.unwrap();
	assert!(
		service
			.execute(
				resumed.target.clone(),
				opaque(),
				resumed.control_version,
				Action::Click {
					selector: "#submit".into()
				}
			)
			.await
			.is_err(),
		"Return cannot reuse stale references"
	);
	service
		.execute(
			resumed.target.clone(),
			opaque(),
			resumed.control_version,
			Action::Snapshot,
		)
		.await
		.unwrap();
	resumed
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires real agent-browser 0.41.2 and isolated Chrome"]
async fn takeover_drains_after_cli_client_exit() {
	let root = std::env::temp_dir().join(format!("skiff-browser-drain-{}", opaque()));
	let service = Service::new(root.clone(), vec![]).await.unwrap();
	let first = service.start("drain".into()).await.unwrap();
	let result = std::panic::AssertUnwindSafe(killed_client_takeover(&service, &first));
	use futures_util::FutureExt;
	let result = Box::pin(result.catch_unwind()).await;
	let cleanup = service.shutdown().await;
	drop(service);
	let _ = std::fs::remove_dir_all(root);
	assert!(cleanup.is_ok());
	if let Err(panic) = result {
		std::panic::resume_unwind(panic);
	}
}

#[test]
fn actions_are_arguments_not_shell_programs() {
	assert!(Action::Open {
		url: "file:///C:/secret".into()
	}
	.arguments()
	.is_err());
	assert!(Action::Click {
		selector: "--cdp=9222".into()
	}
	.arguments()
	.is_err());
	assert!(Action::Wait {
		milliseconds: 10001
	}
	.arguments()
	.is_err());
	let args = Action::Fill {
		selector: "#name".into(),
		text: "姓名 & $(echo bad) --profile C:\\user".into(),
	}
	.arguments()
	.unwrap();
	assert_eq!(args.len(), 3);
	assert_eq!(args[2], "姓名 & $(echo bad) --profile C:\\user");
}

#[test]
fn subprocess_fixture() {
	use std::io::Write;
	match std::env::var("SKIFF_BROWSER_TEST_HELPER").as_deref() {
		Ok("output") => {
			let _ = std::io::stdout().write_all(&vec![b'x'; 4 * 1024 * 1024 + 8192]);
		}
		Ok("wait") => std::thread::sleep(Duration::from_secs(10)),
		_ => {}
	}
}

#[tokio::test]
async fn native_output_and_execution_are_bounded() {
	let binary = std::env::current_exe().unwrap();
	for (mode, timeout) in [
		("output", Duration::from_secs(5)),
		("wait", Duration::from_millis(100)),
	] {
		let mut command = runtime::clean_command(&binary, &std::env::temp_dir());
		command
			.args([
				"--exact",
				"browser::tests::subprocess_fixture",
				"--nocapture",
			])
			.env("SKIFF_BROWSER_TEST_HELPER", mode);
		let error = runtime::run(command, timeout).await.unwrap_err();
		assert!(
			error.contains(if mode == "output" { "4 MiB" } else { "超时" }),
			"{error}"
		);
	}
}

#[cfg(windows)]
#[test]
fn process_recovery_rejects_recycled_identity() {
	let binary = std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
	assert!(OwnedDaemon::capture(std::process::id(), &binary, Some(0)).is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires Windows, agent-browser 0.41.2 and its installed Chrome; temporary profiles and loopback only"]
async fn real_browser_service_lifecycle_and_isolation() {
	use axum::{response::Html, routing::get, Router};
	use futures_util::FutureExt;
	use futures_util::{SinkExt, StreamExt};
	use tokio_tungstenite::{
		connect_async,
		tungstenite::{client::IntoClientRequest, Message},
	};
	let root = std::env::temp_dir().join(format!("skiff-browser-service-{}", opaque()));
	let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
	let base = format!("http://{}", listener.local_addr().unwrap());
	let fixture = Router::new().route("/{owner}", get(|axum::extract::Path(owner): axum::extract::Path<String>| async move {
		Html(format!(r#"<!doctype html><meta charset="utf-8"><label>姓名<input id="name" aria-label="姓名"></label><button id="submit" onclick="this.textContent='完成：'+document.querySelector('#name').value">提交</button><button id="cookie"></button><script>document.cookie='owner={owner}';document.querySelector('#cookie').textContent=document.cookie</script>"#))
	}));
	let fixture = tokio::spawn(async move {
		axum::serve(listener, fixture).await.unwrap();
	});
	let service = Service::new(root.clone(), vec!["http://tauri.localhost".into()])
		.await
		.unwrap();
	let result = std::panic::AssertUnwindSafe(async {
		let dependencies = service.dependencies().await;
		assert!(dependencies.ready, "{}", dependencies.message);
		assert!(service.configure(Settings { cli_path: Some("C:/no-such-browser.exe".into()), ..Settings::default() }).await.is_err());
		let (first, duplicate, second) = tokio::join!(service.start("chat/a".into()), service.start("chat/a".into()), service.start("chat/b".into()));
		let first = first.unwrap(); let second = second.unwrap();
		assert_eq!(first.target.generation, duplicate.unwrap().target.generation, "Concurrent start must deduplicate");
		assert_ne!(first.target.generation, second.target.generation);
		assert!(service.configure(Settings { cli_path: dependencies.cli_path.clone(), ..Settings::default() }).await.is_err(), "Do not change CLI path with live instances");
		let call = |status: &BrowserStatus, action| service.execute(status.target.clone(), opaque(), status.control_version, action);
		let (a, b) = tokio::join!(call(&first, Action::Open { url: format!("{base}/a") }), call(&second, Action::Open { url: format!("{base}/b") }));
		a.unwrap(); b.unwrap();
		call(&first, Action::Fill { selector: "#name".into(), text: "中文 & $(原样参数)".into() }).await.unwrap();
		call(&first, Action::Click { selector: "#submit".into() }).await.unwrap();
		let snapshot = call(&first, Action::Snapshot).await.unwrap().to_string();
		assert!(snapshot.contains("完成：中文 & $(原样参数)"), "{snapshot}");
		assert!(snapshot.contains("owner=a") && !snapshot.contains("owner=b"));
		call(&first, Action::Fill { selector: "#name".into(), text: "--headed".into() }).await.unwrap();
		assert!(call(&first,Action::Snapshot).await.unwrap().to_string().contains("--headed"),"Text matching CLI flags must stay text");
		assert!(call(&second, Action::Snapshot).await.unwrap().to_string().contains("owner=b"));
		let connection = service.connection(&first.target).unwrap();
		let client = reqwest::Client::new();
		let request = json!({"target":first.target,"requestId":"bridge-check","controlVersion":first.control_version,"action":{"type":"snapshot"}});
		assert_eq!(client.post(format!("{}/command",connection.bridge_url)).json(&request).send().await.unwrap().status(), 401);
		let response = client.post(format!("{}/command",connection.bridge_url)).bearer_auth(&connection.agent_token).json(&request).send().await.unwrap();
		assert!(response.status().is_success(), "{}", response.text().await.unwrap());
		let duplicate = client.post(format!("{}/command",connection.bridge_url)).bearer_auth(&connection.agent_token).json(&request).send().await.unwrap();
		assert_eq!(duplicate.status(), 409);
		let mut bad = request.clone(); bad["target"]["chatId"] = json!("chat/b"); bad["target"]["generation"] = json!(second.target.generation);
		assert_eq!(client.post(format!("{}/command",connection.bridge_url)).bearer_auth(&connection.agent_token).json(&bad).send().await.unwrap().status(),401);
		let mut ws_request = connection.stream_url.clone().into_client_request().unwrap();
		ws_request.headers_mut().insert("Origin", "http://evil.example".parse().unwrap());
		assert!(connect_async(ws_request).await.is_err());
		let mut ws_request = connection.stream_url.clone().into_client_request().unwrap();
		ws_request.headers_mut().insert("Origin", "http://tauri.localhost".parse().unwrap());
		let (mut viewer, _) = connect_async(ws_request).await.unwrap();
		let frame = tokio::time::timeout(Duration::from_secs(10), async {
			loop { let message = viewer.next().await.unwrap().unwrap(); if let Message::Text(text) = message { let value:Value=serde_json::from_str(&text).unwrap(); if value["type"] == "frame" { break value; } } }
		}).await.unwrap();
		viewer.send(Message::Text(json!({"type":"ack","seq":frame["seq"]}).to_string().into())).await.unwrap();
		let long_service = service.clone(); let target = first.target.clone(); let version = first.control_version;
		let slow = tokio::spawn(async move { long_service.execute(target, "slow".into(), version, Action::Wait { milliseconds: 1800 }).await });
		loop { if service.entry(&first.target).unwrap().data.lock().unwrap().active.is_some() { break; } tokio::time::sleep(Duration::from_millis(10)).await; }
		let queued_service = service.clone(); let target = first.target.clone();
		let queued = tokio::spawn(async move { queued_service.execute(target,"queued".into(),version,Action::Click { selector:"#submit".into() }).await });
		tokio::time::sleep(Duration::from_millis(100)).await;
		let started = std::time::Instant::now();
		let human = service.control(&first.target, ControlAction::TakeOver).await.unwrap();
		assert_eq!(human.control, Control::Human);
		assert!(started.elapsed() >= Duration::from_millis(1200), "Takeover must wait for real command completion");
		assert!(slow.await.unwrap().is_err()); assert!(queued.await.unwrap().is_err());
		assert!(call(&human,Action::Snapshot).await.is_err(), "AI cannot act during human control");
		let box_data = service.entry(&first.target).unwrap().runtime.call(vec!["get".into(),"box".into(),"#name".into()],Duration::from_secs(5)).await.unwrap();
		for event in ["mousePressed","mouseReleased"] {
			viewer.send(Message::Text(json!({"type":"input_mouse","eventType":event,"x":box_data["x"].as_f64().unwrap()+10.0,"y":box_data["y"].as_f64().unwrap()+10.0,"button":"left","clickCount":1,"controlVersion":human.control_version}).to_string().into())).await.unwrap();
		}
		viewer.send(Message::Text(json!({"type":"input_keyboard","eventType":"char","text":"中","controlVersion":human.control_version}).to_string().into())).await.unwrap();
		tokio::time::timeout(Duration::from_secs(5),async {
			loop {
				let value=service.entry(&first.target).unwrap().runtime.call(vec!["get".into(),"value".into(),"#name".into()],Duration::from_secs(2)).await.unwrap();
				if value.to_string().contains("中") { break; }
				tokio::time::sleep(Duration::from_millis(50)).await;
			}
		}).await.unwrap();
		let resumed = service.control(&first.target,ControlAction::Return).await.unwrap();
		assert!(call(&resumed,Action::Snapshot).await.is_ok());
		let request = json!({"target":resumed.target,"requestId":"cancel-me","controlVersion":resumed.control_version,"action":{"type":"wait","milliseconds":1800}});
		let command_url = format!("{}/command",connection.bridge_url); let token=connection.agent_token.clone(); let http=client.clone();
		let in_flight = tokio::spawn(async move { http.post(command_url).bearer_auth(token).json(&request).send().await.unwrap().status() });
		loop { if service.entry(&first.target).unwrap().data.lock().unwrap().active.is_some() { break; } tokio::time::sleep(Duration::from_millis(10)).await; }
		let started = std::time::Instant::now();
		let cancel = client.post(format!("{}/cancel",connection.bridge_url)).bearer_auth(&connection.agent_token).json(&json!({"target":first.target,"requestId":"cancel-me"})).send().await.unwrap();
		assert!(cancel.status().is_success()); assert!(started.elapsed() < Duration::from_secs(1), "Cancel channel must not queue behind operation");
		assert_eq!(in_flight.await.unwrap(),409);
		let end = tokio::time::Instant::now()+Duration::from_secs(5);
		loop { if service.status(&first.target).await.unwrap().control == Control::Stopped { break; } assert!(tokio::time::Instant::now()<end); tokio::time::sleep(Duration::from_millis(20)).await; }
		viewer.close(None).await.unwrap();
		service.close(&first.target).await.unwrap();
		assert!(call(&second, Action::Snapshot).await.is_ok(), "Closing a must preserve b");
		assert!(client.post(format!("{}/command",connection.bridge_url)).bearer_auth(&connection.agent_token).json(&json!({"target":first.target,"requestId":"late","controlVersion":version,"action":{"type":"snapshot"}})).send().await.unwrap().status()==401);
		let reopened = service.start("chat/a".into()).await.unwrap();
		assert_ne!(reopened.target.generation,first.target.generation);
		assert!(service.status(&first.target).await.is_err(),"Old generation must not address reopened instance");
		let idle = service.start_with_idle("idle".into(),1500).await.unwrap();
		tokio::time::sleep(Duration::from_millis(2300)).await;
		assert_eq!(service.status(&idle.target).await.unwrap().control,Control::Disconnected);
		assert!(call(&idle,Action::Snapshot).await.is_err(),"Never auto-launch default profile after idle exit");
		service.entry(&second.target).unwrap().data.lock().unwrap().daemon.as_ref().unwrap().terminate().unwrap();
		assert_eq!(service.status(&second.target).await.unwrap().control,Control::Disconnected);
		assert!(call(&reopened,Action::Snapshot).await.is_ok(),"Crash must stay isolated");
		let old_entry = service.entry(&reopened.target).unwrap();
		let cdp = old_entry.data.lock().unwrap().cdp_url.clone().unwrap();
		let (mut browser,_) = connect_async(&cdp).await.unwrap();
		browser.send(Message::Text(json!({"id":1,"method":"Browser.close"}).to_string().into())).await.unwrap();
		tokio::time::sleep(Duration::from_millis(200)).await;
		assert_eq!(service.status(&reopened.target).await.unwrap().control,Control::Disconnected,"Browser-only crash must be visible even if daemon survives");
		let reopened = service.start("chat/a".into()).await.unwrap();
		assert!(old_entry.data.lock().unwrap().daemon.is_none(),"Replacing a disconnected browser must reap its old daemon");
		// Simulate a prior app crash: a new service validates persisted process identity and reaps only its owned daemon.
		assert!(Service::new(root.clone(),vec![]).await.is_err(),"Do not reap browsers owned by another live app");
		service.root_lease.lock().unwrap().take(); // Simulate process death releasing the OS lease, without normal browser cleanup.
		let recovered = Service::new(root.clone(),vec!["http://tauri.localhost".into()]).await.unwrap();
		assert_eq!(service.status(&reopened.target).await.unwrap().control,Control::Disconnected);
		recovered.shutdown().await.unwrap();
	}).catch_unwind().await;
	let cleanup = service.shutdown().await;
	fixture.abort();
	let _ = tokio::fs::remove_dir_all(&root).await;
	assert!(cleanup.is_ok(), "{cleanup:?}");
	if let Err(panic) = result {
		std::panic::resume_unwind(panic);
	}
}
