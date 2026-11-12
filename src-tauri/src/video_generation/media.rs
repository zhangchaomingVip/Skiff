//! Bounded ISO BMFF metadata reader: skip mdat, inspect only the moov box.
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

pub struct Metadata { pub width: u32, pub height: u32, pub duration: f64, pub fps: Option<f64> }
fn u32_at(data: &[u8], offset: usize) -> Option<u32> { Some(u32::from_be_bytes(data.get(offset..offset + 4)?.try_into().ok()?)) }
fn u64_at(data: &[u8], offset: usize) -> Option<u64> { Some(u64::from_be_bytes(data.get(offset..offset + 8)?.try_into().ok()?)) }
fn boxes(mut data: &[u8]) -> Result<Vec<([u8; 4], &[u8])>, String> {
	let mut result = vec![];
	while !data.is_empty() {
		let size = u32_at(data, 0).ok_or("MP4 box 不完整")?;
		let kind = data.get(4..8).ok_or("MP4 box 无效")?.try_into().unwrap();
		let (size, header) = match size { 0 => (data.len(), 8), 1 => (usize::try_from(u64_at(data, 8).ok_or("MP4 box 不完整")?).map_err(|_| "MP4 box 过大")?, 16), value => (value as usize, 8) };
		if size < header || size > data.len() || result.len() >= 100_000 { return Err("MP4 box 大小无效".into()); }
		result.push((kind, &data[header..size])); data = &data[size..];
	}
	Ok(result)
}
fn child<'a>(data: &'a [u8], name: &[u8; 4]) -> Result<&'a [u8], String> { boxes(data)?.into_iter().find(|(kind, _)| kind == name).map(|(_, data)| data).ok_or_else(|| "MP4 缺少必要元数据".into()) }
fn duration(data: &[u8]) -> Option<f64> {
	let (scale, ticks) = match *data.first()? { 0 => (u32_at(data, 12)?, u32_at(data, 16)? as u64), 1 => (u32_at(data, 20)?, u64_at(data, 24)?), _ => return None };
	(scale > 0 && ticks > 0).then_some(ticks as f64 / scale as f64)
}
fn parse(data: &[u8]) -> Result<Metadata, String> {
	for (kind, track) in boxes(data)? {
		if &kind != b"trak" { continue; }
		let mdia = child(track, b"mdia")?;
		if child(mdia, b"hdlr")?.get(8..12) != Some(b"vide") { continue; }
		let tkhd = child(track, b"tkhd")?;
		let offset = match tkhd.first() { Some(0) => 76, Some(1) => 88, _ => return Err("MP4 轨道版本不支持".into()) };
		let width = u32_at(tkhd, offset).ok_or("MP4 缺少宽度")? >> 16;
		let height = u32_at(tkhd, offset + 4).ok_or("MP4 缺少高度")? >> 16;
		let duration = duration(child(mdia, b"mdhd")?).ok_or("MP4 时长无效")?;
		if width == 0 || height == 0 || width > 16384 || height > 16384 || !duration.is_finite() || duration > 3600.0 { return Err("MP4 尺寸或时长无效".into()); }
		let stbl = child(child(mdia, b"minf")?, b"stbl")?;
		let stts = child(stbl, b"stts")?;
		let count = u32_at(stts, 4).ok_or("MP4 帧时间表无效")? as usize;
		if count > 100_000 || 8 + count * 8 > stts.len() { return Err("MP4 帧时间表过大或不完整".into()); }
		let frames: u64 = (0..count).map(|i| u32_at(stts, 8 + i * 8).unwrap_or(0) as u64).sum();
		return Ok(Metadata { width, height, duration, fps: (frames > 0).then_some(frames as f64 / duration) });
	}
	Err("MP4 没有可预览的视频轨道".into())
}
pub fn inspect(path: &Path) -> Result<Metadata, String> {
	let mut file = File::open(path).map_err(|_| "无法读取视频元数据")?;
	let length = file.metadata().map_err(|_| "无法读取视频大小")?.len();
	let mut offset = 0u64; let mut ftyp = false; let mut moov = None; let mut mdat = false;
	while offset < length {
		let mut header = [0u8; 8]; file.read_exact(&mut header).map_err(|_| "视频不是完整 MP4")?;
		let size = u32::from_be_bytes(header[..4].try_into().unwrap());
		let (size, header_len) = match size { 0 => (length - offset, 8), 1 => { let mut extended = [0; 8]; file.read_exact(&mut extended).map_err(|_| "MP4 box 无效")?; (u64::from_be_bytes(extended), 16) }, n => (n as u64, 8) };
		if size < header_len || size > length - offset { return Err("视频文件被截断或格式无效".into()); }
		match &header[4..8] {
			b"ftyp" => ftyp = true,
			b"mdat" => mdat = size > header_len,
			b"moov" => { if size > 16 * 1024 * 1024 { return Err("MP4 元数据过大".into()); } let mut data = vec![0; (size - header_len) as usize]; file.read_exact(&mut data).map_err(|_| "MP4 元数据不完整")?; moov = Some(data); }
			_ => {},
		}
		offset += size; file.seek(SeekFrom::Start(offset)).map_err(|_| "无法读取 MP4")?;
	}
	if !ftyp || !mdat { return Err("服务返回的文件不是有效 MP4".into()); }
	parse(&moov.ok_or("MP4 缺少视频信息")?)
}
