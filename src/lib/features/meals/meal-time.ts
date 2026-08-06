import type { MealOccurrence, MealOccurrenceInput } from './contracts';

const DAY_MS = 86_400_000;

export function formatMealOccurrence(occurrence: MealOccurrence, now = new Date()): string {
	if (occurrence.precision === 'unknown') return 'Datum ej angivet';

	const date = formatRelativeMealDate(occurrence.occurredOn, occurrence.timezone, now);
	if (occurrence.precision === 'date') return date;

	if (occurrence.precision === 'approximate' && !occurrence.occurredAt) {
		return `${date}, ${occurrence.timeExpression}`;
	}

	const time = formatTime(occurrence.occurredAt!, occurrence.timezone);
	return occurrence.precision === 'approximate' ? `${date}, cirka ${time}` : `${date}, ${time}`;
}

export function formatRelativeMealDate(
	localDate: string,
	timezone: string,
	now = new Date()
): string {
	const today = dateInTimezone(now, timezone);
	const difference = dateOrdinal(today) - dateOrdinal(localDate);

	if (difference === 0) return 'Idag';
	if (difference === 1) return 'Igår';
	if (difference >= 2 && difference <= 6) {
		const weekday = new Intl.DateTimeFormat('sv-SE', {
			weekday: 'long',
			timeZone: 'UTC'
		}).format(dateAtNoonUtc(localDate));
		return `${weekday.slice(0, 1).toUpperCase()}${weekday.slice(1)}`;
	}

	return new Intl.DateTimeFormat('sv-SE', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).format(dateAtNoonUtc(localDate));
}

export function occurrenceForMutation(occurrence: MealOccurrence): MealOccurrenceInput {
	if (occurrence.precision === 'exact') {
		return {
			precision: 'exact',
			occurredAt: occurrence.occurredAt,
			timezone: occurrence.timezone,
			timeExpression: occurrence.timeExpression
		};
	}
	if (occurrence.precision === 'approximate' && occurrence.occurredAt) {
		return {
			precision: 'approximate',
			occurredAt: occurrence.occurredAt,
			timezone: occurrence.timezone,
			timeExpression: occurrence.timeExpression
		};
	}
	if (occurrence.precision === 'approximate') {
		return {
			precision: 'approximate',
			occurredAt: null,
			occurredOn: occurrence.occurredOn,
			timezone: occurrence.timezone,
			timeExpression: occurrence.timeExpression
		};
	}
	return occurrence;
}

export function localTimeInput(isoTimestamp: string | null, timezone: string | null): string {
	if (!isoTimestamp || !timezone) return '';
	return formatParts(new Date(isoTimestamp), timezone).time;
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
		const parts = formatParts(new Date(candidate), timezone);
		const represented = Date.UTC(
			Number(parts.date.slice(0, 4)),
			Number(parts.date.slice(5, 7)) - 1,
			Number(parts.date.slice(8, 10)),
			Number(parts.time.slice(0, 2)),
			Number(parts.time.slice(3, 5))
		);
		candidate += desired - represented;
	}

	const verified = formatParts(new Date(candidate), timezone);
	if (verified.date !== localDate || verified.time !== localTime) {
		throw new Error('Tiden finns inte i den valda tidszonen.');
	}
	return new Date(candidate).toISOString();
}

function formatTime(isoTimestamp: string, timezone: string): string {
	return formatParts(new Date(isoTimestamp), timezone).time;
}

function dateInTimezone(value: Date, timezone: string): string {
	return formatParts(value, timezone).date;
}

function formatParts(value: Date, timezone: string): { date: string; time: string } {
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

function dateOrdinal(value: string): number {
	return Math.floor(dateAtNoonUtc(value).getTime() / DAY_MS);
}

function dateAtNoonUtc(value: string): Date {
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) throw new Error('Måltidens datum är ogiltigt.');
	return new Date(Date.UTC(year, month - 1, day, 12));
}
