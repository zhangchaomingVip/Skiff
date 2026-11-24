import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { BrandMark } from "./BrandMark";
import { CopyButton } from "./CopyButton";
import { Tooltip } from "./ui";

type AboutInfo = { version?: string; tauriVersion?: string; dataDir?: string; piDir?: string };

const settle = <T,>(promise: Promise<T>): Promise<T | undefined> => promise.catch(() => undefined);

/** Version and on-disk locations, gathered for bug reports. Every value degrades to
 *  "—" in the browser preview, where the Tauri runtime is missing. */
export function AboutSettings() {
	const [info, setInfo] = useState<AboutInfo>({});
	useEffect(() => {
		let disposed = false;
		void Promise.all([
			settle(getVersion()),
			settle(getTauriVersion()),
			// Image, video and browser data all live under the app data directory.
			settle(appDataDir()),
			// pi owns auth.json, models.json and the session files; it honours PI_CODING_AGENT_DIR.
			settle(invoke<{ agent_dir?: string | null }>("get_pi_auth_status").then((status) => status.agent_dir ?? undefined)),
		]).then(([version, tauriVersion, dataDir, piDir]) => { if (!disposed) setInfo({ version, tauriVersion, dataDir, piDir }); });
		return () => { disposed = true; };
	}, []);
	const report = [`Skiff ${info.version ?? "未知版本"}`, info.tauriVersion && `Tauri ${info.tauriVersion}`, navigator.userAgent].filter(Boolean).join("\n");
	const path = (title: string, value: string | undefined, copyLabel: string) => <div className="settings-row">
		<div className="settings-row-text"><span className="settings-row-title">{title}</span><span className="settings-row-hint about-path">{value ?? "—"}</span></div>
		{value && <Tooltip text={copyLabel}><CopyButton text={value} label={copyLabel} iconOnly /></Tooltip>}
	</div>;
	return <section className="settings-page" aria-labelledby="about-title">
		<h2 id="about-title">关于</h2>
		<div className="settings-group">
			<div className="settings-row about-hero">
				<BrandMark size={40} />
				<div className="settings-row-text"><span className="settings-row-title">Skiff</span><span className="settings-row-hint">{info.version ? `版本 ${info.version}` : "版本未知"}{info.tauriVersion ? ` · Tauri ${info.tauriVersion}` : ""}</span></div>
				<Tooltip text="复制版本信息"><CopyButton text={report} label="复制版本信息" iconOnly /></Tooltip>
			</div>
		</div>
		<div className="settings-group">
			{path("应用数据", info.dataDir, "复制路径")}
			{path("pi 配置", info.piDir, "复制路径")}
		</div>
		<p className="about-license">MIT License · © 2026 zhangchaomingVip</p>
	</section>;
}
