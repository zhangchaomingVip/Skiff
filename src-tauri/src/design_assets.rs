//! Design asset storage: imported media that survives reloads, plus one-way
//! publishing into a Code project.
//!
//! Design deliberately keeps no mirror of project files: nothing here scans a
//! repository, so images produced by Code never appear in the design gallery.
use std::{fs, io::Read, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use super::project_workbench::{canonical_root, project_path};

const MEDIA_LIMIT: u64 = 256 * 1024 * 1024;
const IMPORT_IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const IMPORT_VIDEO_LIMIT: usize = 100 * 1024 * 1024;

/// Imported media record. Files live in the same assets directory as generated
/// works so both can be published into a Code project.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignAssetRecord {
	id: String,
	kind: String,
	name: String,
	mime: String,
	path: String,
	size: u64,
	#[serde(default)] canvas_id: Option<String>,
	#[serde(default)] removed: bool,
	created_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInput { kind: String, name: String, mime: String, data_url: String, canvas_id: Option<String> }

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn record_dir(dir: &Path) -> PathBuf { dir.join("design-assets") }

fn media_dir(dir: &Path) -> PathBuf { dir.join("assets") }

fn valid_id(id: &str) -> Result<(), String> { uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "资产 ID 无效".into()) }

fn record_path(dir: &Path, id: &str) -> Result<PathBuf, String> { valid_id(id)?; Ok(dir.join(format!("{id}.json"))) }

fn read_record(dir: &Path, id: &str) -> Result<DesignAssetRecord, String> {
	serde_json::from_slice(&fs::read(record_path(dir, id)?).map_err(|_| "无法读取导入作品")?).map_err(|_| "导入作品记录损坏".into())
}

fn read_records(dir: &Path) -> Vec<DesignAssetRecord> {
	let mut records = vec![];
	let Ok(entries) = fs::read_dir(dir) else { return records; };
	for entry in entries.flatten() {
		let path = entry.path();
		if path.extension().and_then(|value| value.to_str()) != Some("json") { continue; }
		if let Ok(bytes) = fs::read(&path) { if let Ok(record) = serde_json::from_slice::<DesignAssetRecord>(&bytes) { records.push(record); } }
	}
	records
}

fn write_record(dir: &Path, record: &DesignAssetRecord) -> Result<(), String> {
	fs::create_dir_all(dir).map_err(|_| "无法创建导入作品目录")?;
	super::providers::atomic_write(&record_path(dir, &record.id)?, &serde_json::to_value(record).map_err(|_| "无法编码导入作品")?).map_err(|_| "无法保存导入作品记录")?;
	Ok(())
}

fn media_extension(mime: &str) -> Result<&'static str, String> {
	match mime {
		"image/png" => Ok("png"), "image/jpeg" => Ok("jpg"), "image/webp" => Ok("webp"), "image/gif" => Ok("gif"),
		"video/mp4" => Ok("mp4"), "video/webm" => Ok("webm"), "video/ogg" => Ok("ogv"), "video/quicktime" => Ok("mov"),
		_ => Err("仅支持常见图片或视频格式".into()),
	}
}

fn clean_name(raw: &str) -> String {
	let name: String = raw.rsplit(['/', '\\']).next().unwrap_or("导入作品").chars().filter(|c| !c.is_control()).take(200).collect();
	let name = name.trim();
	if name.is_empty() { "导入作品".into() } else { name.into() }
}

fn import_asset(dir: &Path, input: ImportInput) -> Result<DesignAssetRecord, String> {
	let kind = if input.kind == "video" { "video" } else { "image" };
	let extension = media_extension(&input.mime)?;
	if (kind == "video") != input.mime.starts_with("video/") { return Err("文件类型与作品类型不匹配".into()); }
	let prefix = format!("data:{};base64,", input.mime);
	let encoded = input.data_url.strip_prefix(&prefix).ok_or("导入内容与文件格式不匹配")?;
	let limit = if kind == "video" { IMPORT_VIDEO_LIMIT } else { IMPORT_IMAGE_LIMIT };
	if encoded.len() > limit * 4 / 3 + 4 { return Err(format!("文件超过 {} MB 导入上限", limit / (1024 * 1024))); }
	let bytes = STANDARD.decode(encoded).map_err(|_| "导入内容编码无效")?;
	if bytes.is_empty() || bytes.len() > limit { return Err(format!("文件为空或超过 {} MB 导入上限", limit / (1024 * 1024))); }
	if kind == "image" {
		let format = image::guess_format(&bytes).map_err(|_| "无法识别导入的图片格式")?;
		if format.to_mime_type() != input.mime { return Err("图片格式与文件内容不符".into()); }
		let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format).into_dimensions().map_err(|_| "导入图片尺寸无效")?;
		if width == 0 || height == 0 || width > 8192 || height > 8192 { return Err("图片尺寸无效或超过 8192 像素".into()); }
	}
	// Files join generated works so "保存至当前项目" can publish either source.
	let media = media_dir(dir);
	fs::create_dir_all(&media).map_err(|_| "无法创建资产目录")?;
	let id = uuid::Uuid::new_v4().to_string();
	let path = media.join(format!("{id}.{extension}"));
	fs::write(&path, &bytes).map_err(|_| "无法写入导入文件，请检查磁盘空间")?;
	let record = DesignAssetRecord {
		id, kind: kind.into(), name: clean_name(&input.name), mime: input.mime,
		path: path.to_string_lossy().into_owned(), size: bytes.len() as u64,
		canvas_id: input.canvas_id.filter(|value| !value.trim().is_empty()), removed: false, created_at: now_ms(),
	};
	if let Err(error) = write_record(&record_dir(dir), &record) { let _ = fs::remove_file(&path); return Err(error); }
	Ok(record)
}

fn list_assets(dir: &Path) -> Vec<DesignAssetRecord> {
	let mut records = read_records(&record_dir(dir));
	records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
	records
}

#[tauri::command]
pub async fn import_design_asset(app: AppHandle, input: ImportInput) -> Result<DesignAssetRecord, String> {
	let dir = super::generation::data_dir(&app)?;
	tauri::async_runtime::spawn_blocking(move || import_asset(&dir, input)).await.map_err(|_| "无法导入作品")?
}

#[tauri::command]
pub fn list_design_assets(app: AppHandle) -> Result<Vec<DesignAssetRecord>, String> { Ok(list_assets(&super::generation::data_dir(&app)?)) }

fn set_removed(dir: &Path, id: &str, removed: bool) -> Result<DesignAssetRecord, String> {
	let dir = record_dir(dir);
	let mut record = read_record(&dir, id)?;
	record.removed = removed;
	write_record(&dir, &record)?;
	Ok(record)
}

fn set_canvas(dir: &Path, id: &str, canvas_id: Option<String>) -> Result<DesignAssetRecord, String> {
	let dir = record_dir(dir);
	let mut record = read_record(&dir, id)?;
	record.canvas_id = canvas_id.filter(|value| !value.trim().is_empty());
	write_record(&dir, &record)?;
	Ok(record)
}

#[tauri::command]
pub fn set_design_asset_removed(app: AppHandle, id: String, removed: bool) -> Result<DesignAssetRecord, String> {
	set_removed(&super::generation::data_dir(&app)?, &id, removed)
}

#[tauri::command]
pub fn set_design_asset_canvas(app: AppHandle, id: String, canvas_id: Option<String>) -> Result<DesignAssetRecord, String> {
	set_canvas(&super::generation::data_dir(&app)?, &id, canvas_id)
}

fn extension(path: &Path) -> String { path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase() }

fn save_to_project(dir: &Path, root: &Path, source: &Path, name: &str) -> Result<String, String> {
	let allowed = fs::canonicalize(dir.join("assets")).map_err(|_| "生成资产目录不可用")?;
	let source = fs::canonicalize(source).map_err(|_| "资产文件已不存在")?;
	if source.parent() != Some(allowed.as_path()) || !matches!(extension(&source).as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "mp4" | "webm" | "ogv" | "mov") { return Err("只能保存设计资产库中的图片或视频".into()); }
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
