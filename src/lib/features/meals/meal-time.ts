import {
	MEAL_TIME_PERIOD_OPTIONS,
	type MealOccurrence,
	type MealOccurrenceExtraction,
	type MealOccurrenceInput,
	type MealTimePeriod
} from './contracts';
import {
	differenceInCalendarDays,
	formatCalendarDate,
	getLocalDate,
	getLocalTime,
	zonedDateTimeToIso
} from '$lib/date-time';

export function formatMealOccurrence(occurrence: MealOccurrence, now = new Date()): string {
	if (occurrence.precision === 'unknown') return 'Datum ej angivet';

	const date = formatRelativeMealDate(occurrence.occurredOn, occurrence.timezone, now);
	if (occurrence.precision === 'date') return date;

	if (occurrence.precision === 'approximate' && !occurrence.occurredAt) {
		if (occurrence.timePeriod === null) throw new Error('Måltiden saknar en tidsperiod.');
		return `${date}, ${mealTimePeriodLabel(occurrence.timePeriod).toLocaleLowerCase('sv-SE')}`;
	}

	const time = getLocalTime(new Date(occurrence.occurredAt!), occurrence.timezone);
	return occurrence.precision === 'approximate' ? `${date}, cirka ${time}` : `${date}, ${time}`;
}

export function formatRelativeMealDate(
	localDate: string,
	timezone: string,
	now = new Date()
): string {
	const today = getLocalDate(now, timezone);
	const difference = differenceInCalendarDays(today, localDate);

	if (difference === 0) return 'Idag';
	if (difference === 1) return 'Igår';
	if (difference >= 2 && difference <= 6) {
		const weekday = formatCalendarDate(localDate, { weekday: 'long' });
		return `${weekday.slice(0, 1).toUpperCase()}${weekday.slice(1)}`;
	}

	return formatCalendarDate(localDate, { day: 'numeric', month: 'short' });
}

export function occurrenceForMutation(occurrence: MealOccurrence): MealOccurrenceInput {
	if (occurrence.precision === 'exact') {
		return {
			precision: 'exact',
			occurredAt: occurrence.occurredAt,
			timezone: occurrence.timezone,
			timePeriod: null
		};
	}
	if (occurrence.precision === 'approximate' && occurrence.occurredAt) {
		return {
			precision: 'approximate',
			occurredAt: occurrence.occurredAt,
			timezone: occurrence.timezone,
			timePeriod: null
		};
	}
	if (occurrence.precision === 'approximate') {
		if (occurrence.timePeriod === null) throw new Error('Måltiden saknar en tidsperiod.');
		return {
			precision: 'approximate',
			occurredAt: null,
			occurredOn: occurrence.occurredOn,
			timezone: occurrence.timezone,
			timePeriod: occurrence.timePeriod
		};
	}
	return occurrence;
}

export function occurrenceFromExtraction(
	extraction: MealOccurrenceExtraction,
	timezone: string
): MealOccurrenceInput {
	if (extraction.date === null) {
		if (extraction.time !== null) throw new Error('En tid kräver ett känt datum.');
		return {
			precision: 'unknown',
			occurredAt: null,
			occurredOn: null,
			timezone: null,
			timePeriod: null
		};
	}

	if (extraction.time === null) {
		return {
			precision: 'date',
			occurredAt: null,
			occurredOn: extraction.date,
			timezone,
			timePeriod: null
		};
	}

	if (extraction.time.kind === 'period') {
		return {
			precision: 'approximate',
			occurredAt: null,
			occurredOn: extraction.date,
			timezone,
			timePeriod: extraction.time.value
		};
	}

	return {
		precision: extraction.time.kind,
		occurredAt: zonedDateTimeToIso(extraction.date, extraction.time.localTime, timezone),
		timezone,
		timePeriod: null
	};
}

export function mealTimePeriodLabel(period: MealTimePeriod): string {
	return MEAL_TIME_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period;
}
