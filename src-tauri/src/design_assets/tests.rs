use super::*;
use std::path::PathBuf;

struct TestDir(PathBuf);
impl TestDir {
	fn new() -> Self { let path = std::env::temp_dir().join(format!("skiff-design-test-{}", uuid::Uuid::new_v4())); fs::create_dir_all(&path).unwrap(); Self(path) }
}
impl Drop for TestDir {
	fn drop(&mut self) { assert!(self.0.starts_with(std::env::temp_dir()) && self.0.file_name().unwrap().to_string_lossy().starts_with("skiff-design-test-")); let _ = fs::remove_dir_all(&self.0); }
}
fn png(color: u8) -> Vec<u8> {
	let image = image::RgbaImage::from_pixel(4, 3, image::Rgba([color, 100, 200, 255]));
	let mut bytes = std::io::Cursor::new(vec![]); image.write_to(&mut bytes, image::ImageFormat::Png).unwrap(); bytes.into_inner()
}
#[test]
fn saves_images_and_videos_to_project_without_overwriting_or_reading_outside_library() {
	let dir = TestDir::new(); let root = TestDir::new(); let root = fs::canonicalize(&root.0).unwrap();
	fs::create_dir_all(dir.0.join("assets")).unwrap();
	let original = png(40); let source = dir.0.join("assets/source.png"); fs::write(&source, &original).unwrap();
	assert_eq!(save_to_project(&dir.0, &root, &source, "picture.png").unwrap(), "assets/picture.png");
	assert_eq!(save_to_project(&dir.0, &root, &source, "picture.png").unwrap(), "assets/picture-1.png");
	assert_eq!(fs::read(root.join("assets/picture.png")).unwrap(), original);
	let outside = dir.0.join("outside.png"); fs::write(&outside, &original).unwrap();
	assert!(save_to_project(&dir.0, &root, &outside, "outside.png").is_err());
	let video = dir.0.join("assets/video.mp4"); fs::write(&video, b"mock mp4 bytes").unwrap();
	assert_eq!(save_to_project(&dir.0, &root, &video, "clip.mp4").unwrap(), "assets/clip.mp4");
	assert!(project_path(&root, "../escape", false).is_err());
}
fn data_url(mime: &str, bytes: &[u8]) -> String { format!("data:{mime};base64,{}", STANDARD.encode(bytes)) }
fn input(name: &str, mime: &str, bytes: &[u8]) -> ImportInput {
	ImportInput { kind: if mime.starts_with("video/") { "video".into() } else { "image".into() }, name: name.into(), mime: mime.into(), data_url: data_url(mime, bytes), canvas_id: None }
}

#[test]
fn imports_media_into_the_shared_assets_directory_and_tracks_canvas() {
	let dir = TestDir::new();
	let bytes = png(60);
	let record = import_asset(&dir.0, ImportInput { canvas_id: Some("canvas-a".into()), ..input("../../窗边的花.png", "image/png", &bytes) }).unwrap();
	assert_eq!(record.name, "窗边的花.png", "Path segments never leak into the display name");
	assert_eq!(record.size as usize, bytes.len());
	assert!(Path::new(&record.path).is_file());
	assert_eq!(Path::new(&record.path).parent(), Some(dir.0.join("assets").as_path()), "Imports share the generated asset root");
	assert_eq!(record.canvas_id.as_deref(), Some("canvas-a"));
	assert_eq!(list_assets(&dir.0).len(), 1);

	let moved = set_canvas(&dir.0, &record.id, Some("canvas-b".into())).unwrap();
	assert_eq!(moved.canvas_id.as_deref(), Some("canvas-b"));
	assert_eq!(set_canvas(&dir.0, &record.id, None).unwrap().canvas_id, None);
	let removed = set_removed(&dir.0, &record.id, true).unwrap();
	assert!(removed.removed);
	assert!(list_assets(&dir.0)[0].removed, "Removal survives a fresh read");
	assert!(set_canvas(&dir.0, "not-a-uuid", None).is_err());
}

#[test]
fn refuses_foreign_prefixes_mismatched_media_and_wrong_kinds() {
	let dir = TestDir::new();
	let bytes = png(70);
	assert!(import_asset(&dir.0, input("a.png", "image/png", &bytes)).is_ok());
	let mut wrong_prefix = input("b.png", "image/jpeg", &bytes);
	wrong_prefix.data_url = data_url("image/png", &bytes);
	assert!(import_asset(&dir.0, wrong_prefix).is_err(), "The data URL prefix must match the declared mime");
	let mut wrong_content = input("c.png", "image/png", &bytes);
	wrong_content.mime = "image/jpeg".into();
	wrong_content.data_url = data_url("image/jpeg", &bytes);
	assert!(import_asset(&dir.0, wrong_content).is_err(), "PNG bytes cannot claim to be JPEG");
	let mut wrong_kind = input("d.png", "image/png", &bytes);
	wrong_kind.kind = "video".into();
	assert!(import_asset(&dir.0, wrong_kind).is_err(), "An image cannot be stored as a video");
	assert_eq!(list_assets(&dir.0).len(), 1, "Rejected imports never leave records behind");
}

#[cfg(unix)]
#[test]
fn refuses_assets_directory_symlinks_leaving_the_project() {
	let dir = TestDir::new(); let root = TestDir::new(); let outside = TestDir::new();
	fs::create_dir_all(dir.0.join("assets")).unwrap(); let source = dir.0.join("assets/source.png"); fs::write(&source, png(50)).unwrap();
	std::os::unix::fs::symlink(&outside.0, root.0.join("assets")).unwrap();
	assert!(save_to_project(&dir.0, &fs::canonicalize(&root.0).unwrap(), &source, "picture.png").is_err());
	assert!(!outside.0.join("picture.png").exists());
}
