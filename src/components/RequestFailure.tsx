import type { SessionState } from "../chat/types";
import { classifyProviderFailure } from "../chat/modelFamilies";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolDetailSection, ToolDetailText } from "./ToolDetailSection";
import { Button } from "./ui";

type Retry = NonNullable<SessionState["retryAttempts"]>[number];

function reason(error: string): string {
	switch (classifyProviderFailure(error)) {
		case "timeout": return "请求超时";
		case "network": return "连接中断";
		case "rate_limit": return "请求频率受限";
		case "unauthorized": return "身份验证失败";
		case "server": return "服务器繁忙";
		default: return "请求失败";
	}
}

/** Keep raw provider details available during backoff, after stopping and in history. */
export function RequestFailure({ error, retry, onRetry, disabled = false }: { error: string; retry?: Retry; onRetry?: () => void; disabled?: boolean }) {
	const status = retry?.status ?? "failed";
	const action = { retrying: "正在重新连接", retried: "已重试", recovered: "已恢复", failed: "重试未恢复", cancelled: "已停止重试" }[status];
	const label = retry ? `${reason(error)}，${action} ${retry.attempt}/${retry.maxAttempts}` : "请求失败";
	let details: Record<string, unknown> = {};
	try {
		const start = error.indexOf("{");
		if (start >= 0) {
			const value = JSON.parse(error.slice(start));
			if (value && typeof value === "object") details = value.error && typeof value.error === "object" ? value.error : value;
		}
	} catch { /* Non-JSON errors remain readable in the original response below. */ }
	const httpStatus = error.match(/\b[45]\d\d\b/)?.[0];
	const fields = [
		["HTTP 状态", httpStatus],
		["错误类型", details.type],
		["错误码", details.code],
		["Request ID", details.request_id ?? details.requestId],
		["Message ID", details.message_id ?? details.messageId],
	].filter((field): field is [string, string] => typeof field[1] === "string" && !!field[1]);
	return <div className={retry ? "retry-progress" : "request-failure"}>
		<ProcessDisclosure className="request-error" icon={status === "retrying" ? "wifi" : "alert"} label={label}>
			<div className="tool-content request-error-content">
				{fields.length > 0 && <dl className="request-error-fields">{fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
				<ToolDetailSection title="错误详情" copy={{ text: error, label: "复制错误" }}><ToolDetailText text={error} /></ToolDetailSection>
			</div>
		</ProcessDisclosure>
		{onRetry && <Button size="compact" disabled={disabled} onClick={onRetry}>重试</Button>}
	</div>;
}
