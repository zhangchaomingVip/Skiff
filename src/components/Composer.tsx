import { useState, type KeyboardEvent } from "react";

/** Message composer: Enter sends, Shift+Enter inserts a newline. */
export function Composer({
	disabled,
	streaming,
	onSend,
	onAbort,
}: {
	disabled: boolean;
	streaming: boolean;
	onSend: (text: string) => void;
	onAbort: () => void;
}) {
	const [text, setText] = useState("");

	const submit = () => {
		const trimmed = text.trim();
		if (!trimmed || disabled || streaming) return;
		onSend(trimmed);
		setText("");
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<div className="composer">
			<textarea
				className="composer-input"
				rows={3}
				value={text}
				placeholder={disabled ? "connecting…" : "Message pi…   (Enter to send, Shift+Enter for newline)"}
				disabled={disabled}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
			/>
			<div className="composer-actions">
				{streaming ? (
					<button className="btn danger" onClick={onAbort}>
						Stop
					</button>
				) : (
					<button className="btn primary" onClick={submit} disabled={disabled || !text.trim()}>
						Send
					</button>
				)}
			</div>
		</div>
	);
}
