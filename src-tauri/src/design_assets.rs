//! One-way publishing from the design studio into a Code project.
//!
//! Design deliberately keeps no mirror of project files: nothing here scans a
//! repository, so images produced by Code never appear in the design gallery.
use std::{fs, io::Read, path::Path};
use tauri::AppHandle;
use super::project_workbench::{canonical_root, project_path};

const MEDIA_LIMIT: u64 = 256 * 1024 * 1024;

fn extension(path: &Path) -> String { path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase() }

fn save_to_project(dir: &Path, root: &Path, source: &Path, name: &str) -> Result<String, String> {
	let allowed = fs::canonicalize(dir.join("assets")).map_err(|_| "生成资产目录不可用")?;
	let source = fs::canonicalize(source).map_err(|_| "资产文件已不存在")?;
	if source.parent() != Some(allowed.as_path()) || !matches!(extension(&source).as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "mp4") { return Err("只能保存设计资产库中的图片或视频".into()); }
	let mut original = fs::File::open(&source).map_err(|_| "无法读取资产文件")?;
	if original.metadata().map_err(|_| "无法读取资产信息")?.len() > MEDIA_LIMIT { return Err("资产超过 256 MB 保存上限".into()); }
	let (folder, _) = project_path(root, "assets", false)?;
	fs::create_dir_all(&folder).map_err(|_| "无法创建项目 assets 目录")?;
	let (folder, _) = project_path(root, "assets", true)?;
	if !folder.is_dir() { return Err("项目 assets 不是文件夹".into()); }
	let base = Path::new(name).file_stem().and_then(|value| value.to_str()).unwrap_or("design");
	let stem: String = base.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)).take(100).collect();
	let stem = stem.trim_matches([' ', '.']); let stem = if stem.is_empty() { "design" } else { stem };
	for index in 0..1000 {
		let name = format!("{stem}{}.{}", if index == 0 { String::new() } else { format!("-{index}") }, extension(&source));
		let target = folder.join(&name);
		match fs::OpenOptions::new().write(true).create_new(true).open(&target) {
			Ok(mut file) => {
				let copied = std::io::copy(&mut (&mut original).take(MEDIA_LIMIT + 1), &mut file);
				if !matches!(copied, Ok(size) if size > 0 && size <= MEDIA_LIMIT) || file.sync_all().is_err() { drop(file); let _ = fs::remove_file(&target); return Err("无法保存项目资产，文件为空、过大或磁盘不可写".into()); }
				return Ok(format!("assets/{name}"));
			}
			Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
			Err(_) => return Err("无法写入项目 assets 目录".into()),
		}
	}
	Err("同名资产过多，请更换文件名".into())
}

#[tauri::command]
pub async fn save_design_asset_to_project(app: AppHandle, root: String, source: String, name: String) -> Result<String, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let root = canonical_root(&root)?;
		save_to_project(&super::generation::data_dir(&app)?, &root, Path::new(&source), &name)
	}).await.map_err(|_| "无法保存项目资产")?
}

#[cfg(test)]
mod tests;
