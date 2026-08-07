<script lang="ts">
	import { MEAL_LIMITS } from '../contracts';
	import type { MealItemDraft } from '../meal-mutations';

	let {
		draft,
		saving,
		variant = 'default',
		onChange,
		onSave,
		onCancel
	}: {
		draft: MealItemDraft;
		saving: boolean;
		variant?: 'default' | 'ingredient' | 'new-item';
		onChange: (draft: MealItemDraft) => void;
		onSave: (draft: MealItemDraft) => void | Promise<void>;
		onCancel: () => void;
	} = $props();
</script>

<form
	class={['entry-editor', variant]}
	onsubmit={(event) => {
		event.preventDefault();
		void onSave(draft);
	}}
>
	<label>
		<span>Namn</span>
		<input
			value={draft.name}
			maxlength={MEAL_LIMITS.maxNameLength}
			disabled={saving}
			required
			oninput={(event) => onChange({ ...draft, name: event.currentTarget.value })}
		/>
	</label>
	<label>
		<span>Mängd (valfri)</span>
		<input
			value={draft.amountText}
			maxlength={MEAL_LIMITS.maxAmountLength}
			disabled={saving}
			oninput={(event) => onChange({ ...draft, amountText: event.currentTarget.value })}
		/>
	</label>
	<div class="actions">
		<button class="save" type="submit" disabled={saving}>Spara</button>
		<button type="button" disabled={saving} onclick={onCancel}>Avbryt</button>
	</div>
</form>

<style>
	.entry-editor {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.65rem;
		border-radius: 0.65rem;
		padding: 0.65rem;
		background: color-mix(in srgb, var(--text) 4%, transparent);
	}

	.entry-editor.ingredient {
		margin: 0.35rem 0;
	}

	.entry-editor.new-item {
		margin-top: 0.75rem;
	}

	label {
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
