const millisecondsPerDay = 86_400_000;
const timeFormatter = new Intl.DateTimeFormat('sv-SE', {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

export function formatConversationDate(value: string, now = new Date()): string {
	const date = new Date(value);
	const dateAtMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const todayAtMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	const daysAgo = Math.max(0, Math.round((todayAtMidnight - dateAtMidnight) / millisecondsPerDay));
	let dateLabel: string;

	if (daysAgo === 0) dateLabel = 'Idag';
	else if (daysAgo === 1) dateLabel = 'Igår';
	else if (daysAgo < 7) dateLabel = `${daysAgo} dagar sedan`;
	else if (daysAgo < 14) dateLabel = 'Förra veckan';
	else if (daysAgo < 28) dateLabel = `${Math.floor(daysAgo / 7)} veckor sedan`;
	else {
		dateLabel = new Intl.DateTimeFormat('sv-SE', {
			day: 'numeric',
			month: 'short',
			year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
		}).format(date);
	}

	return `${dateLabel} ${timeFormatter.format(date)}`;
}
