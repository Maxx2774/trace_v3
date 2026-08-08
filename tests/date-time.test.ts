import {
	differenceInCalendarDays,
	formatCalendarDate,
	formatSwedishLongDate,
	getLocalDate,
	getLocalDateTime,
	getLocalTime,
	getRuntimeTimezone,
	isValidTimezone,
	zonedDateTimeToIso
} from '$lib/date-time';
import { describe, expect, it } from 'vitest';

describe('date and time utilities', () => {
	it('formats local date and time in an IANA timezone', () => {
		const value = new Date('2026-08-06T06:30:00.000Z');
		expect(getLocalDateTime(value, 'Europe/Stockholm')).toEqual({
			date: '2026-08-06',
			time: '08:30'
		});
		expect(getLocalDate(value, 'Europe/Stockholm')).toBe('2026-08-06');
		expect(getLocalTime(value, 'Europe/Stockholm')).toBe('08:30');
	});

	it('converts local time to UTC without losing its wall-clock value', () => {
		const iso = zonedDateTimeToIso('2026-08-06', '08:30', 'Europe/Stockholm');
		expect(iso).toBe('2026-08-06T06:30:00.000Z');
		expect(getLocalTime(new Date(iso), 'Europe/Stockholm')).toBe('08:30');
	});

	it('validates IANA timezones', () => {
		expect(isValidTimezone('Europe/Stockholm')).toBe(true);
		expect(isValidTimezone('Not/A_Timezone')).toBe(false);
		expect(isValidTimezone(getRuntimeTimezone())).toBe(true);
	});

	it('compares and formats date-only calendar values without timezone drift', () => {
		expect(differenceInCalendarDays('2026-08-06', '2026-08-04')).toBe(2);
		expect(formatCalendarDate('2026-08-04', { weekday: 'long' })).toBe('tisdag');
	});

	it('formats the shared Swedish page date', () => {
		expect(formatSwedishLongDate(new Date(2026, 7, 8, 12))).toBe('Lördag 8 augusti');
	});
});
