import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type Bounds = { min: number; max: number };

export function ResizeSeparator({ label, value, bounds, direction = 1, onResize, onCommit }: {
	label: string;
	value: number;
	bounds: Bounds;
	direction?: 1 | -1;
	onResize: (value: number) => void;
	onCommit: (value: number) => void;
}) {
	const [dragging, setDragging] = useState(false);
	const drag = useRef<{ pointerId: number; startX: number; startValue: number; currentValue: number }>();
	const callbacks = useRef({ onResize, onCommit, bounds, value, direction });
	callbacks.current = { onResize, onCommit, bounds, value, direction };

	const clamp = (next: number) => Math.max(callbacks.current.bounds.min, Math.min(callbacks.current.bounds.max, next));
	const finish = useCallback(() => {
		const active = drag.current;
		if (!active) return;
		drag.current = undefined;
		setDragging(false);
		callbacks.current.onCommit(active.currentValue);
	}, []);

	useEffect(() => {
		if (!dragging) return;
		window.addEventListener("blur", finish);
		window.addEventListener("resize", finish);
		return () => {
			window.removeEventListener("blur", finish);
			window.removeEventListener("resize", finish);
		};
	}, [dragging, finish]);
	useEffect(() => () => finish(), [finish]);

	const move = (clientX: number) => {
		const active = drag.current;
		if (!active) return;
		const next = clamp(active.startValue + (clientX - active.startX) * callbacks.current.direction);
		active.currentValue = next;
		callbacks.current.onResize(next);
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, currentValue: value };
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(true);
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const delta = event.key === "Home" ? bounds.min - value : event.key === "End" ? bounds.max - value : (event.key === "ArrowRight" ? 12 : -12) * direction;
		const next = clamp(value + delta);
		onResize(next);
		onCommit(next);
	};

	return <div className={`resize-separator${dragging ? " dragging" : ""}`} data-direction={direction === -1 ? "end" : "start"} role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={value} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) move(event.clientX); }} onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) { move(event.clientX); finish(); } }} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={onKeyDown} />;
}
