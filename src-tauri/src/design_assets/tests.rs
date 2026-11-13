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
#[cfg(unix)]
#[test]
fn refuses_assets_directory_symlinks_leaving_the_project() {
	let dir = TestDir::new(); let root = TestDir::new(); let outside = TestDir::new();
	fs::create_dir_all(dir.0.join("assets")).unwrap(); let source = dir.0.join("assets/source.png"); fs::write(&source, png(50)).unwrap();
	std::os::unix::fs::symlink(&outside.0, root.0.join("assets")).unwrap();
	assert!(save_to_project(&dir.0, &fs::canonicalize(&root.0).unwrap(), &source, "picture.png").is_err());
	assert!(!outside.0.join("picture.png").exists());
}
