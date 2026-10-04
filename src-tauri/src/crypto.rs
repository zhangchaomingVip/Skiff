//! Seals provider API keys at rest.
//!
//! Windows builds use DPAPI with the current user's credentials, so the stored
//! blob can only be decrypted by this Windows account on this machine. The
//! ciphertext is hex-encoded because we deliberately avoid pulling in a base64
//! dependency for one line of encoding.
//!
//! Other platforms refuse new secret writes until a secure storage backend
//! is available; they never silently fall back to plaintext.

#[cfg(windows)]
mod imp {
	use std::ffi::c_void;
	use windows_sys::Win32::Foundation::LocalFree;
	use windows_sys::Win32::Security::Cryptography::{
		CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
	};

	const ENTROPY: &[u8] = b"skiff.provider.v1";

	fn blob(data: &mut [u8]) -> CRYPT_INTEGER_BLOB {
		CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_mut_ptr() }
	}

	pub fn protect(plain: &str) -> Result<Vec<u8>, String> {
		let mut input = plain.as_bytes().to_vec();
		let mut entropy = ENTROPY.to_vec();
		let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
		let ok = unsafe {
			CryptProtectData(
				&blob(&mut input),
				std::ptr::null(),
				&blob(&mut entropy),
				std::ptr::null::<c_void>(),
				std::ptr::null(),
				0,
				&mut output,
			)
		};
		if ok == 0 {
			return Err("无法加密 API Key（DPAPI 调用失败）".into());
		}
		let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
		unsafe { LocalFree(output.pbData as *mut c_void) };
		Ok(bytes)
	}

	pub fn unprotect(sealed: &[u8]) -> Result<String, String> {
		let mut input = sealed.to_vec();
		let mut entropy = ENTROPY.to_vec();
		let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
		let ok = unsafe {
			CryptUnprotectData(
				&blob(&mut input),
				std::ptr::null_mut(),
				&blob(&mut entropy),
				std::ptr::null::<c_void>(),
				std::ptr::null(),
				0,
				&mut output,
			)
		};
		if ok == 0 {
			return Err("无法解密 API Key（可能换过 Windows 账户或配置文件被复制到其他机器）".into());
		}
		let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
		unsafe { LocalFree(output.pbData as *mut c_void) };
		String::from_utf8(bytes).map_err(|_| "API Key 内容损坏".to_string())
	}
}

#[cfg(not(windows))]
mod imp {
	pub fn protect(_plain: &str) -> Result<Vec<u8>, String> { Err("当前平台尚未支持密钥加密存储".into()) }
	pub fn unprotect(_sealed: &[u8]) -> Result<String, String> { Err("当前平台尚未支持密钥解密".into()) }
}

const SEALED_PREFIX: &str = "dpapi1:";

/// True when a stored value is already ciphertext, so re-saving never nests it.
pub fn is_sealed(value: &str) -> bool {
	value.starts_with(SEALED_PREFIX)
}

fn to_hex(bytes: &[u8]) -> String {
	let mut out = String::with_capacity(bytes.len() * 2);
	for byte in bytes {
		out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
		out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
	}
	out
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
	if text.len() % 2 != 0 { return None; }
	let digits: Vec<u8> = text.bytes().collect();
	let mut out = Vec::with_capacity(digits.len() / 2);
	for pair in digits.chunks(2) {
		let high = (pair[0] as char).to_digit(16)?;
		let low = (pair[1] as char).to_digit(16)?;
		out.push(((high << 4) | low) as u8);
	}
	Some(out)
}

/// Encrypt for storage. Returns `None` for an empty key so callers keep the
/// existing secret instead of overwriting it with nothing.
pub fn seal(plain: &str) -> Result<Option<String>, String> {
	if plain.is_empty() { return Ok(None); }
	imp::protect(plain).map(|bytes| Some(format!("{SEALED_PREFIX}{}", to_hex(&bytes))))
}

/// Decrypt a stored value. Plaintext values (hand-edited files) still load so
/// migration never loses a key.
pub fn open(stored: &str) -> Result<String, String> {
	match stored.strip_prefix(SEALED_PREFIX) {
		Some(hex) => {
			let bytes = from_hex(hex).ok_or("API Key 存储格式损坏")?;
			imp::unprotect(&bytes)
		}
		None => Ok(stored.to_string()),
	}
}
