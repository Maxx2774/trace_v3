export type LocalDateTime = {
	date: string;
	time: string;
};

const DAY_MS = 86_400_000;
export const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function getLocalDateTime(value: Date, timezone: string): LocalDateTime {
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value;
	const year = part('year');
	const month = part('month');
	const day = part('day');
	const hour = part('hour');
	const minute = part('minute');
	if (!year || !month || !day || !hour || !minute) throw new Error('Datum kunde inte formateras.');
	return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function getLocalDate(value: Date, timezone: string): string {
	return getLocalDateTime(value, timezone).date;
}

export function getLocalTime(value: Date, timezone: string): string {
	return getLocalDateTime(value, timezone).time;
}

export function zonedDateTimeToIso(localDate: string, localTime: string, timezone: string): string {
	const [year, month, day] = localDate.split('-').map(Number);
	const [hour, minute] = localTime.split(':').map(Number);
	if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
		throw new Error('Datum eller tid är ogiltig.');
	}

	const desired = Date.UTC(year, month - 1, day, hour, minute);
	let candidate = desired;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const parts = getLocalDateTime(new Date(candidate), timezone);
		const represented = Date.UTC(
			Number(parts.date.slice(0, 4)),
			Number(parts.date.slice(5, 7)) - 1,
			Number(parts.date.slice(8, 10)),
			Number(parts.time.slice(0, 2)),
			Number(parts.time.slice(3, 5))
		);
		candidate += desired - represented;
	}

	const verified = getLocalDateTime(new Date(candidate), timezone);
	if (verified.date !== localDate || verified.time !== localTime) {
		throw new Error('Tiden finns inte i den valda tidszonen.');
	}
	return new Date(candidate).toISOString();
}

export function isValidTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('sv-SE', { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}

export function getRuntimeTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function differenceInCalendarDays(laterDate: string, earlierDate: string): number {
	return Math.floor(
		(calendarDateAtNoonUtc(laterDate).getTime() - calendarDateAtNoonUtc(earlierDate).getTime()) /
			DAY_MS
	);
}

export function formatCalendarDate(
	value: string,
	options: Intl.DateTimeFormatOptions,
	locale = 'sv-SE'
): string {
	return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
		calendarDateAtNoonUtc(value)
	);
}

function calendarDateAtNoonUtc(value: string): Date {
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) throw new Error('Datumet är ogiltigt.');
	return new Date(Date.UTC(year, month - 1, day, 12));
}
