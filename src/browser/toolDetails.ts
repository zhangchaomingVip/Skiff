export interface BrowserToolDetails { requestId: string; operation: string; target?: string; durationMs?: number; outcome: string }
export const browserActionLabels: Record<string, string> = { open: "打开网页", snapshot: "读取页面", click: "点击元素", fill: "填写字段", press: "按键操作", scroll: "滚动页面", wait: "等待页面", screenshot: "截取页面", drag: "拖拽元素", mouse: "移动鼠标", get: "读取信息" };
export function parseBrowserDetails(raw: unknown): BrowserToolDetails | undefined {
	const value = (raw as { skiffBrowser?: BrowserToolDetails } | undefined)?.skiffBrowser;
	if (!value || typeof value.requestId !== "string" || typeof value.operation !== "string" || !Object.prototype.hasOwnProperty.call(browserActionLabels, value.operation) || typeof value.outcome !== "string") return undefined;
	return { requestId: value.requestId.slice(0, 128), operation: value.operation, target: typeof value.target === "string" ? value.target.slice(0, 8192) : undefined, durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? value.durationMs : undefined, outcome: value.outcome };
}
export const browserOutcomeLabel = (outcome: string) => ({ success: "成功", cancelled: "已取消", humanControl: "人工接管，未执行", timeout: "超时", revoked: "凭据已失效", closed: "已关闭", disconnected: "连接已断开", invalidArguments: "参数无效", unavailable: "连接不可用", snapshotRequired: "需要重新读取页面" }[outcome] ?? "失败");
