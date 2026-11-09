#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
	io::{Read, Write},
	net::TcpListener,
	process::{Command, Stdio},
	sync::{
		atomic::{AtomicBool, Ordering},
		Arc,
	},
	time::Duration,
};
use tauri::Manager;

fn bridge() {
	let listener = TcpListener::bind("127.0.0.1:0").unwrap();
	let token = std::env::var("SPIKE_TOKEN").unwrap();
	std::fs::write(
		std::env::var("SPIKE_BRIDGE_INFO").unwrap(),
		serde_json::json!({"url":format!("http://{}",listener.local_addr().unwrap())}).to_string(),
	)
	.unwrap();
	let active = Arc::new(AtomicBool::new(false));
	let cancelled = Arc::new(AtomicBool::new(false));
	for connection in listener.incoming() {
		let mut socket = connection.unwrap();
		let token = token.clone();
		let active = active.clone();
		let cancelled = cancelled.clone();
		std::thread::spawn(move || {
			socket
				.set_read_timeout(Some(Duration::from_secs(5)))
				.unwrap();
			let mut request = Vec::new();
			let mut buffer = [0; 2048];
			while request.len() < 8192 {
				match socket.read(&mut buffer) {
					Ok(0) | Err(_) => return,
					Ok(n) => request.extend_from_slice(&buffer[..n]),
				};
				if request.windows(4).any(|w| w == b"\r\n\r\n") {
					break;
				}
			}
			let text = String::from_utf8_lossy(&request);
			let valid = text.lines().any(|line| {
				line.to_ascii_lowercase()
					.starts_with("authorization: bearer ")
					&& line
						.split_once(": ")
						.map(|(_, value)| value == format!("Bearer {token}"))
						.unwrap_or(false)
			});
			let (status, body) = if !valid {
				("401 Unauthorized", "{}".to_string())
			} else if text.starts_with("GET /state ") {
				(
					"200 OK",
					serde_json::json!({"active":active.load(Ordering::SeqCst)}).to_string(),
				)
			} else if text.starts_with("POST /cancel ") {
				cancelled.store(true, Ordering::SeqCst);
				("200 OK", "{}".to_string())
			} else if text.starts_with("POST /snapshot ") {
				let mut command = Command::new(std::env::var("SPIKE_BIN").unwrap());
				let args: Vec<String> =
					serde_json::from_str(&std::env::var("SPIKE_ARGS").unwrap()).unwrap();
				command.args(args).args(["snapshot"]);
				#[cfg(windows)]
				{
					use std::os::windows::process::CommandExt;
					command.creation_flags(0x08000000);
				}
				let output = command.output().unwrap();
				(
					"200 OK",
					String::from_utf8_lossy(&output.stdout).into_owned(),
				)
			} else if text.starts_with("POST /command ") {
				cancelled.store(false, Ordering::SeqCst);
				active.store(true, Ordering::SeqCst);
				let mut command = Command::new(std::env::var("SPIKE_BIN").unwrap());
				let args: Vec<String> =
					serde_json::from_str(&std::env::var("SPIKE_ARGS").unwrap()).unwrap();
				command
					.args(args)
					.args(["wait", "10000"])
					.stdout(Stdio::null())
					.stderr(Stdio::null());
				#[cfg(windows)]
				{
					use std::os::windows::process::CommandExt;
					command.creation_flags(0x08000000);
				}
				let mut child = command.spawn().unwrap();
				loop {
					if cancelled.load(Ordering::SeqCst) {
						let _ = child.kill();
						let _ = child.wait();
						break;
					}
					if child.try_wait().unwrap().is_some() {
						break;
					}
					std::thread::sleep(Duration::from_millis(20));
				}
				active.store(false, Ordering::SeqCst);
				("200 OK", "{\"finished\":true}".to_string())
			} else {
				("404 Not Found", "{}".to_string())
			};
			let _ = write!(socket,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
		});
	}
}
fn main() {
	std::thread::spawn(bridge);
	tauri::Builder::default()
		.setup(|app| {
			let port = std::env::var("SPIKE_STREAM_PORT").unwrap();
			let script =
				format!("addEventListener('DOMContentLoaded',()=>window.connectStream({port}));");
			tauri::WebviewWindowBuilder::new(
				app,
				"main",
				tauri::WebviewUrl::App("index.html".into()),
			)
			.title("Skiff Browser Spike · isolated release probe")
			.inner_size(1000.0, 700.0)
			.initialization_script(&script)
			.build()?;
			let _ = app.path().app_data_dir();
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("probe failed");
}
