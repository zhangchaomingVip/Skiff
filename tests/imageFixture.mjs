import { deflateSync, crc32 } from "node:zlib";

// Valid 32 × 32 RGBA PNG, independent of image-processing dependencies.
export function testImage() {
	const chunk = (type, data) => {
		const name = Buffer.from(type); const bytes = Buffer.concat([name, data]);
		const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
		const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(bytes));
		return Buffer.concat([size, bytes, checksum]);
	};
	const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
	const pixels = Buffer.alloc(32 * (32 * 4 + 1));
	for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
		const offset = y * 129 + 1 + x * 4;
		pixels.set([90 + x * 3, 100 + y * 3, 220, 255], offset);
	}
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
