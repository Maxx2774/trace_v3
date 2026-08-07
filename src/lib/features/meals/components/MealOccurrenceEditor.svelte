<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import { MEAL_TIME_PERIOD_OPTIONS, type Meal } from '../contracts';
	import type { MealOccurrenceDraft } from '../meal-mutations';

	type Precision = Meal['occurrence']['precision'];

	const PRECISION_OPTIONS: ReadonlyArray<{ value: Precision; label: string }> = [
		{ value: 'exact', label: 'Exakt tid' },
		{ value: 'approximate', label: 'Ungefärlig tid' },
		{ value: 'date', label: 'Endast datum' },
		{ value: 'unknown', label: 'Datum ej angivet' }
	];

	let {
		draft,
		saving,
		onChange,
		onSave,
		onCancel
	}: {
		draft: MealOccurrenceDraft;
		saving: boolean;
		onChange: (draft: MealOccurrenceDraft) => void;
		onSave: (draft: MealOccurrenceDraft) => void | Promise<void>;
		onCancel: () => void;
	} = $props();

	function changePrecision(precision: Precision) {
		onChange({
			...draft,
			precision,
			timePeriod: precision === 'approximate' ? draft.timePeriod : null,
			time: precision === 'date' || precision === 'unknown' ? '' : draft.time
		});
	}
</script>

<form
	class="occurrence-editor"
	onsubmit={(event) => {
		event.preventDefault();
		void onSave(draft);
	}}
>
	<Select
		value={draft.precision}
		options={PRECISION_OPTIONS}
		placeholder="Välj precision"
		label="Tidsprecision"
		disabled={saving}
		onValueChange={changePrecision}
	/>
	{#if draft.precision !== 'unknown'}
		<label>
			<span>Datum</span>
			<input
				type="date"
				value={draft.date}
				disabled={saving}
				required
				oninput={(event) => onChange({ ...draft, date: event.currentTarget.value })}
			/>
		</label>
	{/if}
	{#if draft.precision === 'exact' || draft.precision === 'approximate'}
		<label>
			<span>{draft.precision === 'exact' ? 'Tid' : 'Ungefärlig klocktid (valfri)'}</span>
			<input
				type="time"
				value={draft.time}
				disabled={saving}
				required={draft.precision === 'exact'}
				oninput={(event) =>
					onChange({
						...draft,
						time: event.currentTarget.value,
						timePeriod: event.currentTarget.value ? null : draft.timePeriod
					})}
			/>
		</label>
	{/if}
	{#if draft.precision === 'approximate'}
		<div class="time-period-field">
			<span>Tidsperiod om klockslag saknas</span>
			<Select
				value={draft.timePeriod}
				options={MEAL_TIME_PERIOD_OPTIONS}
				placeholder="Välj tidsperiod"
				label="Tidsperiod"
				disabled={saving}
				onValueChange={(timePeriod) => onChange({ ...draft, timePeriod, time: '' })}
			/>
		</div>
	{/if}
	<div class="actions">
		<button class="save" type="submit" disabled={saving}>Spara</button>
		<button type="button" disabled={saving} onclick={onCancel}>Avbryt</button>
	</div>
</form>

<style>
	.occurrence-editor {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.65rem;
		border-radius: 0.65rem;
		padding: 0.65rem;
		background: color-mix(in srgb, var(--text) 4%, transparent);
	}

	label,
	.time-period-field {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.78rem;
	}

	input {
		width: 100%;
		min-height: 2.15rem;
		box-sizing: border-box;
		border: 0;
		border-radius: 0.4rem;
		padding: 0.3rem 0.45rem;
		background: color-mix(in srgb, var(--background) 72%, transparent);
		color: var(--text);
		font-size: 0.92rem;
		outline: none;
	}

	input:focus-visible,
	button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 38%, transparent);
		outline-offset: 1px;
	}

	.actions {
		display: flex;
		gap: 0.85rem;
	}

	button {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--muted);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.86rem;
		font-weight: 435;
		cursor: pointer;
	}

	button.save {
		color: var(--accent);
	}

	button:hover {
		color: color-mix(in srgb, var(--accent) 76%, var(--text));
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
