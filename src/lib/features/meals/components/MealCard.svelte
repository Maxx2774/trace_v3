<script lang="ts">
	import EditIcon from '$lib/components/icons/EditIcon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import {
		MEAL_TYPE_OPTIONS,
		mealTypeLabel,
		type Meal,
		type MealItemMutationInput,
		type MealOccurrenceInput,
		type MealType
	} from '../contracts';
	import {
		createMealOccurrenceDraft,
		mealItemsForMutation,
		mealOccurrenceFromDraft,
		removeMealIngredient,
		removeMealItem,
		upsertMealIngredient,
		upsertMealItem,
		type MealIngredientDraft,
		type MealItemDraft,
		type MealOccurrenceDraft
	} from '../meal-mutations';
	import { formatMealOccurrence, occurrenceForMutation } from '../meal-time';
	import { updateMeal } from '../meals.remote';
	import MealEntryEditor from './MealEntryEditor.svelte';
	import MealItemSection from './MealItemSection.svelte';
	import MealOccurrenceEditor from './MealOccurrenceEditor.svelte';

	type Editor =
		| ({ kind: 'item' } & MealItemDraft)
		| ({ kind: 'ingredient' } & MealIngredientDraft)
		| ({ kind: 'occurrence' } & MealOccurrenceDraft);

	let {
		meal,
		editable = false,
		onUpdated,
		onReloadRequested
	}: {
		meal: Meal;
		editable?: boolean;
		onUpdated?: (meal: Meal) => void;
		onReloadRequested?: () => void;
	} = $props();

	let editing = $state(false);
	let saving = $state(false);
	let editor = $state<Editor | null>(null);
	let errorMessage = $state<string | null>(null);
	let revisionConflict = $state(false);
	let retryMutation = $state<{ signature: string; id: string } | null>(null);
	let timeLabel = $derived(formatMealOccurrence(meal.occurrence));

	function beginEditing() {
		errorMessage = null;
		revisionConflict = false;
		editing = true;
	}

	function finishEditing() {
		if (saving) return;
		editor = null;
		errorMessage = null;
		revisionConflict = false;
		editing = false;
	}

	function editItem(itemId: string) {
		const item = meal.items.find((candidate) => candidate.id === itemId);
		if (!item) return;
		editor = {
			kind: 'item',
			id: item.id,
			name: item.name,
			amountText: item.amountText ?? ''
		};
		clearError();
	}

	function addItem() {
		editor = { kind: 'item', id: null, name: '', amountText: '' };
		clearError();
	}

	function editIngredient(itemId: string, ingredientId: string) {
		const ingredient = meal.items
			.find((item) => item.id === itemId)
			?.ingredients.find((candidate) => candidate.id === ingredientId);
		if (!ingredient) return;
		editor = {
			kind: 'ingredient',
			itemId,
			id: ingredient.id,
			name: ingredient.name,
			amountText: ingredient.amountText ?? ''
		};
		clearError();
	}

	function addIngredient(itemId: string) {
		editor = { kind: 'ingredient', itemId, id: null, name: '', amountText: '' };
		clearError();
	}

	function editOccurrence() {
		editor = { kind: 'occurrence', ...createMealOccurrenceDraft(meal.occurrence) };
		clearError();
	}

	async function changeMealType(mealType: MealType) {
		if (mealType === meal.mealType) return;
		await commit({ mealType });
	}

	async function saveItem(draft: MealItemDraft) {
		try {
			await commit({ items: upsertMealItem(meal.items, draft) }, true);
		} catch (cause) {
			showError(cause instanceof Error ? cause.message : 'Måltidsdelen kunde inte ändras.');
		}
	}

	async function saveIngredient(draft: MealIngredientDraft) {
		try {
			await commit({ items: upsertMealIngredient(meal.items, draft) }, true);
		} catch (cause) {
			showError(cause instanceof Error ? cause.message : 'Ingrediensen kunde inte ändras.');
		}
	}

	async function saveOccurrence(draft: MealOccurrenceDraft) {
		let occurrence: MealOccurrenceInput;
		try {
			occurrence = mealOccurrenceFromDraft(draft);
		} catch (cause) {
			showError(cause instanceof Error ? cause.message : 'Datumet eller tiden är ogiltig.');
			return;
		}
		await commit({ occurrence }, true);
	}

	async function removeItemById(itemId: string) {
		if (meal.items.length <= 1) return;
		await commit({ items: removeMealItem(meal.items, itemId) });
	}

	async function removeIngredientById(itemId: string, ingredientId: string) {
		await commit({ items: removeMealIngredient(meal.items, itemId, ingredientId) });
	}

	async function commit(
		changes: {
			mealType?: MealType | null;
			occurrence?: MealOccurrenceInput;
			items?: MealItemMutationInput[];
		},
		closeEditor = false
	) {
		if (saving) return;
		saving = true;
		clearError();
		const mutation = {
			id: meal.id,
			expectedRevision: meal.revision,
			mealType: changes.mealType === undefined ? meal.mealType : changes.mealType,
			occurrence: changes.occurrence ?? occurrenceForMutation(meal.occurrence),
			items: changes.items ?? mealItemsForMutation(meal.items)
		};
		const signature = JSON.stringify(mutation);
		const clientMutationId =
			retryMutation?.signature === signature ? retryMutation.id : crypto.randomUUID();
		retryMutation = { signature, id: clientMutationId };
		try {
			const updated = await updateMeal({ ...mutation, clientMutationId });
			retryMutation = null;
			onUpdated?.(updated);
			if (closeEditor) editor = null;
		} catch (cause) {
			revisionConflict = isRevisionConflict(cause);
			errorMessage = revisionConflict
				? 'Måltiden har ändrats sedan kortet laddades.'
				: 'Måltiden kunde inte sparas.';
		} finally {
			saving = false;
		}
	}

	function clearError() {
		errorMessage = null;
		revisionConflict = false;
	}

	function showError(message: string) {
		errorMessage = message;
		revisionConflict = false;
	}

	function isRevisionConflict(cause: unknown): boolean {
		return Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
	}
</script>

<article class="meal-card" aria-label="Registrerad måltid">
	<div class="meal-heading">
		{#if editing}
			<Select
				value={meal.mealType}
				options={MEAL_TYPE_OPTIONS}
				placeholder="Välj måltidstyp"
				label="Måltidstyp"
				disabled={saving}
				onValueChange={changeMealType}
			/>
		{:else}
			<h3 class:placeholder={meal.mealType === null}>{mealTypeLabel(meal.mealType)}</h3>
		{/if}
		<span class="time-label">{timeLabel}</span>
	</div>

	{#if editing}
		<button class="change-time-button" type="button" disabled={saving} onclick={editOccurrence}>
			Ändra datum och tid
		</button>
	{/if}

	{#if editor?.kind === 'occurrence'}
		<MealOccurrenceEditor
			draft={editor}
			{saving}
			onChange={(draft) => (editor = { kind: 'occurrence', ...draft })}
			onSave={saveOccurrence}
			onCancel={() => (editor = null)}
		/>
	{/if}

	<div class="items">
		{#each meal.items as item (item.id)}
			<MealItemSection
				{item}
				{editing}
				{saving}
				editorActive={editor !== null}
				canRemove={meal.items.length > 1}
				itemDraft={editor?.kind === 'item' && editor.id === item.id ? editor : null}
				ingredientDraft={editor?.kind === 'ingredient' && editor.itemId === item.id ? editor : null}
				onEditItem={() => editItem(item.id)}
				onRemoveItem={() => removeItemById(item.id)}
				onAddIngredient={() => addIngredient(item.id)}
				onEditIngredient={(ingredientId) => editIngredient(item.id, ingredientId)}
				onRemoveIngredient={(ingredientId) => removeIngredientById(item.id, ingredientId)}
				onItemDraftChange={(draft) => (editor = { kind: 'item', ...draft })}
				onIngredientDraftChange={(draft) => (editor = { kind: 'ingredient', ...draft })}
				onSaveItem={saveItem}
				onSaveIngredient={saveIngredient}
				onCancelEditor={() => (editor = null)}
			/>
		{/each}
	</div>

	{#if editing}
		{#if editor?.kind === 'item' && editor.id === null}
			<MealEntryEditor
				draft={editor}
				{saving}
				variant="new-item"
				onChange={(draft) => (editor = { kind: 'item', ...draft })}
				onSave={saveItem}
				onCancel={() => (editor = null)}
			/>
		{:else}
			<button
				class="add-item-button"
				type="button"
				disabled={saving || editor !== null}
				onclick={addItem}>Lägg till mat eller dryck</button
			>
		{/if}
	{/if}

	{#if errorMessage}
		<div class="edit-error" role="status">
			<span>{errorMessage}</span>
			{#if revisionConflict}
				<button type="button" onclick={() => onReloadRequested?.()}>Ladda om</button>
			{/if}
		</div>
	{/if}

	{#if editable}
		<button
			class="edit-button"
			type="button"
			disabled={saving}
			onclick={editing ? finishEditing : beginEditing}
		>
			{#if !editing}<EditIcon />{/if}
			<span>{editing ? 'Klar' : 'Redigera'}</span>
		</button>
	{/if}
</article>

<style>
	.meal-card {
		width: var(--meal-card-width, min(88%, 28rem));
		align-self: flex-start;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
		border-radius: 1rem;
		padding: 0.8rem 1rem 0.75rem;
		background: color-mix(in srgb, var(--accent) 7%, var(--background));
		color: var(--text);
	}

	.meal-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		margin: 0;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 550;
		line-height: 1.3;
	}

	h3.placeholder {
		color: var(--muted);
		font-weight: 435;
	}

	.time-label {
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.3;
		white-space: nowrap;
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
		margin-top: 0.75rem;
	}

	.change-time-button,
	.add-item-button,
	.edit-button,
	.edit-error button {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--accent);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.86rem;
		font-weight: 435;
		cursor: pointer;
	}

	.change-time-button {
		margin-top: 0.25rem;
	}

	.add-item-button {
		margin-top: 0.75rem;
	}

	.edit-button {
		--icon-size: 0.95em;
		display: inline-flex;
		min-height: 2rem;
		align-items: center;
		gap: 0.28rem;
		margin-top: 0.7rem;
	}

	.change-time-button:hover,
	.add-item-button:hover,
	.edit-button:hover,
	.edit-error button:hover {
		color: color-mix(in srgb, var(--accent) 76%, var(--text));
	}

	.edit-error {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-top: 0.65rem;
		color: var(--destructive-text);
		font-size: 0.82rem;
	}

	.edit-error button {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 38%, transparent);
		outline-offset: 1px;
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
