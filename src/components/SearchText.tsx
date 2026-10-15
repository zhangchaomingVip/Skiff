export function SearchText({ text, query }: { text: string; query: string }) {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return text;
	const lower = text.toLocaleLowerCase(), parts = [];
	let cursor = 0, index = lower.indexOf(needle);
	while (index >= 0) {
		parts.push(text.slice(cursor, index), <mark className="chat-highlight" key={index}>{text.slice(index, index + needle.length)}</mark>);
		cursor = index + needle.length; index = lower.indexOf(needle, cursor);
	}
	parts.push(text.slice(cursor));
	return <>{parts}</>;
}
