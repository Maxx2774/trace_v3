const millisecondsPerDay = 86_400_000;
const weekdayLabels = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'] as const;
const shortMonthLabels = [
	'jan',
	'feb',
	'mar',
	'apr',
	'maj',
	'jun',
	'jul',
	'aug',
	'sep',
	'okt',
	'nov',
	'dec'
] as const;
const monthLabels = [
	'Januari',
	'Februari',
	'Mars',
	'April',
	'Maj',
	'Juni',
	'Juli',
	'Augusti',
	'September',
	'Oktober',
	'November',
	'December'
] as const;

export type ConversationDatePresentation = {
	groupKey: string;
	groupLabel: string;
	dateLabel: string;
};

export function getConversationDatePresentation(
	value: string,
	now = new Date()
): ConversationDatePresentation {
	const date = new Date(value);
	const dateDay = getCalendarDay(date);
	const today = getCalendarDay(now);
	const startOfThisWeek = today - ((now.getDay() + 6) % 7);

	if (dateDay >= today) {
		return { groupKey: 'today', groupLabel: 'Idag', dateLabel: formatTime(date) };
	}

	if (dateDay === today - 1) {
		return { groupKey: 'yesterday', groupLabel: 'Igår', dateLabel: formatTime(date) };
	}

	if (dateDay >= startOfThisWeek) {
		return {
			groupKey: 'this-week',
			groupLabel: 'Den här veckan',
			dateLabel: formatWeekdayTime(date)
		};
	}

	if (dateDay >= startOfThisWeek - 7) {
		return {
			groupKey: 'last-week',
			groupLabel: 'Förra veckan',
			dateLabel: formatWeekdayTime(date)
		};
	}

	const year = date.getFullYear();
	const month = date.getMonth();
	return {
		groupKey: `month-${year}-${String(month + 1).padStart(2, '0')}`,
		groupLabel: `${monthLabels[month]}${year === now.getFullYear() ? '' : ` ${year}`}`,
		dateLabel: `${date.getDate()} ${shortMonthLabels[month]}`
	};
}

export function getRecentConversationDateLabel(value: string, now = new Date()): string {
	const date = new Date(value);
	const dateDay = getCalendarDay(date);
	const today = getCalendarDay(now);

	if (dateDay >= today) return formatTime(date);
	if (dateDay === today - 1) return 'Igår';

	return `${date.getDate()} ${shortMonthLabels[date.getMonth()]}`;
}

export function getConversationStartDateLabel(value: string, now = new Date()): string {
	const date = new Date(value);
	const difference = getCalendarDay(now) - getCalendarDay(date);
	const time = formatTime(date);

	if (difference <= 0) return `Idag ${time}`;
	if (difference === 1) return `Igår ${time}`;
	if (difference <= 6) {
		const weekday = new Intl.DateTimeFormat('sv-SE', { weekday: 'long' }).format(date);
		return `${weekday.slice(0, 1).toUpperCase()}${weekday.slice(1)} ${time}`;
	}

	const year = date.getFullYear();
	return `${date.getDate()} ${shortMonthLabels[date.getMonth()]}${
		year === now.getFullYear() ? '' : ` ${year}`
	} ${time}`;
}

function getCalendarDay(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / millisecondsPerDay;
}

function formatWeekdayTime(date: Date): string {
	return `${weekdayLabels[date.getDay()]} ${formatTime(date)}`;
}

function formatTime(date: Date): string {
	return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
