export type ImageResolution = "1K" | "2K" | "4K";
export const imageResolutions: ImageResolution[] = ["1K", "2K", "4K"];
export const maxImageSizes = 32;

/** Configuration examples, not an assertion about a provider's capabilities. */
export const imageSizePresets: Record<ImageResolution, string[]> = {
	"1K": ["1024x1024", "1536x864", "864x1536", "864x1152", "1152x864", "1536x1024", "1024x1536", "1792x768"],
	"2K": ["2048x2048", "2560x1440", "1440x2560", "1728x2304", "2304x1728", "2304x1536", "1536x2304", "2688x1152"],
	"4K": ["2880x2880", "3840x2160", "2160x3840", "2496x3328", "3328x2496", "3456x2304", "2304x3456", "4032x1728"],
};

export function imageResolution(size: string): ImageResolution {
	const [width, height] = size.split("x").map(Number);
	const longest = Math.max(width, height);
	// 4K-class square/portrait images can have a shorter long edge than UHD.
	return longest >= 3840 || width * height >= 7_500_000 ? "4K" : longest >= 2048 ? "2K" : "1K";
}

export function parseImageSizes(value: string) {
	return [...new Set(value.split(/[,，\s]+/).filter(Boolean))];
}
