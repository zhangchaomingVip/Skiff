import { DEFAULT_TYPOGRAPHY, FONT_FAMILIES, setTypographyPreference, useTypographyPreference, type TypographyPreference } from "../typography";
import { Select } from "./ui";

/** Typography card on the appearance page. Changes apply and save immediately. */
export function FontSettings() {
	const preference = useTypographyPreference();
	return <div className="settings-group">
		<div className="settings-row">
			<div className="settings-row-text"><label className="settings-row-title" htmlFor="settings-font-family">字体</label></div>
			<Select id="settings-font-family" value={preference.family} onChange={(event) => setTypographyPreference({ ...preference, family: event.target.value as TypographyPreference["family"] })}>{FONT_FAMILIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</Select>
		</div>
		<div className="settings-row">
			<div className="settings-row-text"><label className="settings-row-title" htmlFor="settings-font-size">字号</label></div>
			<Select id="settings-font-size" value={preference.size} onChange={(event) => setTypographyPreference({ ...preference, size: Number(event.target.value) })}>{Array.from({ length: 9 }, (_, index) => index + 12).map((size) => <option key={size} value={size}>{size} px{size === DEFAULT_TYPOGRAPHY.size ? "（默认）" : ""}</option>)}</Select>
		</div>
	</div>;
}
