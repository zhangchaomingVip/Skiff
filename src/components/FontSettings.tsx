import { DEFAULT_TYPOGRAPHY, FONT_FAMILIES, setTypographyPreference, useTypographyPreference, type TypographyPreference } from "../typography";
import { Button, Select } from "./ui";

export function FontSettings() {
	const preference = useTypographyPreference();
	return <section aria-labelledby="font-settings-title">
		<h2 id="font-settings-title">字体</h2>
		<p className="muted">调整界面和对话的字体与字号，立即生效并自动保存。</p>
		<div className="settings-font-controls">
			<div><label htmlFor="settings-font-family">字体类型</label><Select id="settings-font-family" value={preference.family} onChange={(event) => setTypographyPreference({ ...preference, family: event.target.value as TypographyPreference["family"] })}>{FONT_FAMILIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</Select></div>
			<div><label htmlFor="settings-font-size">字号</label><Select id="settings-font-size" value={preference.size} onChange={(event) => setTypographyPreference({ ...preference, size: Number(event.target.value) })}>{Array.from({ length: 9 }, (_, index) => index + 12).map((size) => <option key={size} value={size}>{size} px{size === DEFAULT_TYPOGRAPHY.size ? "（默认）" : ""}</option>)}</Select></div>
		</div>
		<div className="settings-font-preview" aria-label="字体预览"><p>让每一次对话，都清晰易读。</p><span className="muted">耗时 1m 59s · 7 步</span><code>const message = "Hello, Skiff";</code></div>
		<Button onClick={() => setTypographyPreference(DEFAULT_TYPOGRAPHY)} disabled={preference.size === DEFAULT_TYPOGRAPHY.size && preference.family === DEFAULT_TYPOGRAPHY.family}>恢复默认字体</Button>
	</section>;
}
