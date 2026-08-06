<script lang="ts">
	import DeleteIcon from '$lib/components/icons/DeleteIcon.svelte';
	import EditIcon from '$lib/components/icons/EditIcon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import {
		MEAL_TYPE_OPTIONS,
		mealItemsForMutation,
		mealTypeLabel,
		type Meal,
		type MealItemMutationInput,
		type MealOccurrenceInput,
		type MealType
	} from '../contracts';
	import {
		formatMealOccurrence,
		localTimeInput,
		occurrenceForMutation,
		zonedDateTimeToIso
	} from '../meal-time';
	import { updateMeal } from '../meals.remote';

	type Precision = Meal['occurrence']['precision'];
	type Editor =
		| { kind: 'item'; id: string | null; name: string; amountText: string }
		| {
				kind: 'ingredient';
				itemId: string;
				id: string | null;
				name: string;
				amountText: string;
		  }
		| {
				kind: 'occurrence';
				precision: Precision;
				date: string;
				time: string;
				timezone: string;
				timeExpression: string;
		  };

	const PRECISION_OPTIONS: ReadonlyArray<{ value: Precision; label: string }> = [
		{ value: 'exact', label: 'Exakt tid' },
		{ value: 'approximate', label: 'Ungefärlig tid' },
		{ value: 'date', label: 'Endast datum' },
		{ value: 'unknown', label: 'Datum ej angivet' }
	];

	let {
		meal,
		editable = false,
		onUpdated
	}: {
		meal: Meal;
		editable?: boolean;
		onUpdated?: (meal: Meal) => void;
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
		const occurrence = meal.occurrence;
		const timezone =
			occurrence.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
		editor = {
			kind: 'occurrence',
			precision: occurrence.precision,
			date: occurrence.occurredOn ?? localDate(new Date(), timezone),
			time: localTimeInput(occurrence.occurredAt, occurrence.timezone),
			timezone,
			timeExpression: occurrence.timeExpression ?? ''
		};
		clearError();
	}

	async function changeMealType(mealType: MealType) {
		if (mealType === meal.mealType) return;
		await commit({ mealType });
	}

	async function saveItem(event: SubmitEvent) {
		event.preventDefault();
		if (!editor || editor.kind !== 'item') return;
		const itemEditor = editor;
		const name = itemEditor.name.trim();
		if (!name) return showError('Namnet får inte vara tomt.');

		const items = mealItemsForMutation(meal.items);
		if (itemEditor.id) {
			const next = items.map((item) =>
				item.id === itemEditor.id
					? { ...item, name, amountText: nullableText(itemEditor.amountText) }
					: item
			);
			await commit({ items: next }, true);
		} else {
			await commit(
				{
					items: [
						...items,
						{ id: null, name, amountText: nullableText(itemEditor.amountText), ingredients: [] }
					]
				},
				true
			);
		}
	}

	async function saveIngredient(event: SubmitEvent) {
		event.preventDefault();
		if (!editor || editor.kind !== 'ingredient') return;
		const ingredientEditor = editor;
		const name = ingredientEditor.name.trim();
		if (!name) return showError('Ingrediensens namn får inte vara tomt.');

		const items = mealItemsForMutation(meal.items).map((item) => {
			if (item.id !== ingredientEditor.itemId) return item;
			const ingredients = ingredientEditor.id
				? item.ingredients.map((ingredient) =>
						ingredient.id === ingredientEditor.id
							? { ...ingredient, name, amountText: nullableText(ingredientEditor.amountText) }
							: ingredient
					)
				: [
						...item.ingredients,
						{ id: null, name, amountText: nullableText(ingredientEditor.amountText) }
					];
			return { ...item, ingredients };
		});
		await commit({ items }, true);
	}

	async function saveOccurrence(event: SubmitEvent) {
		event.preventDefault();
		if (!editor || editor.kind !== 'occurrence') return;
		let occurrence: MealOccurrenceInput;
		try {
			occurrence = occurrenceFromEditor(editor);
		} catch (cause) {
			showError(cause instanceof Error ? cause.message : 'Datumet eller tiden är ogiltig.');
			return;
		}
		await commit({ occurrence }, true);
	}

	async function removeItem(itemId: string) {
		if (meal.items.length <= 1) return;
		await commit({ items: mealItemsForMutation(meal.items).filter((item) => item.id !== itemId) });
	}

	async function removeIngredient(itemId: string, ingredientId: string) {
		const items = mealItemsForMutation(meal.items).map((item) =>
			item.id === itemId
				? {
						...item,
						ingredients: item.ingredients.filter((ingredient) => ingredient.id !== ingredientId)
					}
				: item
		);
		await commit({ items });
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
			const updated = await updateMeal({
				...mutation,
				clientMutationId
			});
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

	function requestReload() {
		window.dispatchEvent(new CustomEvent('tracemealreloadrequested'));
	}

	function clearError() {
		errorMessage = null;
		revisionConflict = false;
	}

	function showError(message: string) {
		errorMessage = message;
		revisionConflict = false;
	}

	function nullableText(value: string): string | null {
		return value.trim() || null;
	}

	function occurrenceFromEditor(
		value: Extract<Editor, { kind: 'occurrence' }>
	): MealOccurrenceInput {
		if (value.precision === 'unknown') {
			return {
				precision: 'unknown',
				occurredAt: null,
				occurredOn: null,
				timezone: null,
				timeExpression: null
			};
		}
		if (!value.date) throw new Error('Ange ett datum.');
		if (value.precision === 'date') {
			return {
				precision: 'date',
				occurredAt: null,
				occurredOn: value.date,
				timezone: value.timezone,
				timeExpression: nullableText(value.timeExpression)
			};
		}
		if (value.precision === 'exact') {
			if (!value.time) throw new Error('Ange en exakt tid.');
			return {
				precision: 'exact',
				occurredAt: zonedDateTimeToIso(value.date, value.time, value.timezone),
				timezone: value.timezone,
				timeExpression: nullableText(value.timeExpression)
			};
		}

		const expression = nullableText(value.timeExpression);
		if (!expression) throw new Error('Ange det ungefärliga tidsuttrycket.');
		return value.time
			? {
					precision: 'approximate',
					occurredAt: zonedDateTimeToIso(value.date, value.time, value.timezone),
					timezone: value.timezone,
					timeExpression: expression
				}
			: {
					precision: 'approximate',
					occurredAt: null,
					occurredOn: value.date,
					timezone: value.timezone,
					timeExpression: expression
				};
	}

	function localDate(value: Date, timezone: string): string {
		const parts = new Intl.DateTimeFormat('sv-SE', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(value);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((candidate) => candidate.type === type)?.value ?? '';
		return `${part('year')}-${part('month')}-${part('day')}`;
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
		<form class="occurrence-editor" onsubmit={saveOccurrence}>
			<Select
				value={editor.precision}
				options={PRECISION_OPTIONS}
				placeholder="Välj precision"
				label="Tidsprecision"
				disabled={saving}
				onValueChange={(precision) => {
					if (editor?.kind === 'occurrence') editor.precision = precision;
				}}
			/>
			{#if editor.precision !== 'unknown'}
				<label>
					<span>Datum</span>
					<input type="date" bind:value={editor.date} disabled={saving} required />
				</label>
			{/if}
			{#if editor.precision === 'exact' || editor.precision === 'approximate'}
				<label>
					<span>{editor.precision === 'exact' ? 'Tid' : 'Ungefärlig klocktid (valfri)'}</span>
					<input
						type="time"
						bind:value={editor.time}
						disabled={saving}
						required={editor.precision === 'exact'}
					/>
				</label>
			{/if}
			{#if editor.precision !== 'unknown'}
				<label>
					<span>
						{editor.precision === 'approximate' ? 'Tidsuttryck' : 'Sparat tidsuttryck (valfritt)'}
					</span>
					<input
						type="text"
						bind:value={editor.timeExpression}
						maxlength="160"
						disabled={saving}
						required={editor.precision === 'approximate'}
					/>
				</label>
			{/if}
			<div class="form-actions">
				<button class="save" type="submit" disabled={saving}>Spara</button>
				<button type="button" disabled={saving} onclick={() => (editor = null)}>Avbryt</button>
			</div>
		</form>
	{/if}

	<div class="items">
		{#each meal.items as item (item.id)}
			<section class="meal-item">
				{#if editor?.kind === 'item' && editor.id === item.id}
					<form class="inline-editor" onsubmit={saveItem}>
						<label>
							<span>Namn</span>
							<input bind:value={editor.name} maxlength="160" disabled={saving} required />
						</label>
						<label>
							<span>Mängd (valfri)</span>
							<input bind:value={editor.amountText} maxlength="80" disabled={saving} />
						</label>
						<div class="form-actions">
							<button class="save" type="submit" disabled={saving}>Spara</button>
							<button type="button" disabled={saving} onclick={() => (editor = null)}>
								Avbryt
							</button>
						</div>
					</form>
				{:else}
					<div class="item-row">
						<p class="item-name">
							{item.name}{#if item.amountText}<span> · {item.amountText}</span>{/if}
						</p>
						{#if editing}
							<div class="row-actions">
								<button
									type="button"
									aria-label={`Redigera ${item.name}`}
									disabled={saving}
									onclick={() => editItem(item.id)}><EditIcon /></button
								>
								{#if meal.items.length > 1}
									<button
										type="button"
										aria-label={`Ta bort ${item.name}`}
										disabled={saving}
										onclick={() => removeItem(item.id)}><DeleteIcon /></button
									>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if item.ingredients.length > 0}
					<ul aria-label={`Ingredienser i ${item.name}`}>
						{#each item.ingredients as ingredient (ingredient.id)}
							<li>
								{#if editor?.kind === 'ingredient' && editor.id === ingredient.id}
									<form class="inline-editor ingredient-editor" onsubmit={saveIngredient}>
										<label>
											<span>Namn</span>
											<input bind:value={editor.name} maxlength="160" disabled={saving} required />
										</label>
										<label>
											<span>Mängd (valfri)</span>
											<input bind:value={editor.amountText} maxlength="80" disabled={saving} />
										</label>
										<div class="form-actions">
											<button class="save" type="submit" disabled={saving}>Spara</button>
											<button type="button" disabled={saving} onclick={() => (editor = null)}>
												Avbryt
											</button>
										</div>
									</form>
								{:else}
									<div class="ingredient-row">
										<span>
											{ingredient.name}{#if ingredient.amountText}
												· {ingredient.amountText}{/if}
										</span>
										{#if editing}
											<div class="row-actions">
												<button
													type="button"
													aria-label={`Redigera ${ingredient.name}`}
													disabled={saving}
													onclick={() => editIngredient(item.id, ingredient.id)}
													><EditIcon /></button
												>
												<button
													type="button"
													aria-label={`Ta bort ${ingredient.name}`}
													disabled={saving}
													onclick={() => removeIngredient(item.id, ingredient.id)}
													><DeleteIcon /></button
												>
											</div>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if editing}
					{#if editor?.kind === 'ingredient' && editor.itemId === item.id && editor.id === null}
						<form class="inline-editor ingredient-editor" onsubmit={saveIngredient}>
							<label>
								<span>Namn</span>
								<input bind:value={editor.name} maxlength="160" disabled={saving} required />
							</label>
							<label>
								<span>Mängd (valfri)</span>
								<input bind:value={editor.amountText} maxlength="80" disabled={saving} />
							</label>
							<div class="form-actions">
								<button class="save" type="submit" disabled={saving}>Spara</button>
								<button type="button" disabled={saving} onclick={() => (editor = null)}>
									Avbryt
								</button>
							</div>
						</form>
					{:else}
						<button
							class="add-button"
							type="button"
							disabled={saving || editor !== null}
							onclick={() => addIngredient(item.id)}>Lägg till ingrediens</button
						>
					{/if}
				{/if}
			</section>
		{/each}
	</div>

	{#if editing}
		{#if editor?.kind === 'item' && editor.id === null}
			<form class="inline-editor new-item-editor" onsubmit={saveItem}>
				<label>
					<span>Namn</span>
					<input bind:value={editor.name} maxlength="160" disabled={saving} required />
				</label>
				<label>
					<span>Mängd (valfri)</span>
					<input bind:value={editor.amountText} maxlength="80" disabled={saving} />
				</label>
				<div class="form-actions">
					<button class="save" type="submit" disabled={saving}>Spara</button>
					<button type="button" disabled={saving} onclick={() => (editor = null)}>Avbryt</button>
				</div>
			</form>
		{:else}
			<button
				class="add-button add-item-button"
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
				<button type="button" onclick={requestReload}>Ladda om</button>
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

	.meal-heading,
	.item-row,
	.ingredient-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3,
	p {
		margin: 0;
	}

	h3,
	.item-name {
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

	.change-time-button,
	.add-button,
	.edit-button,
	.form-actions button,
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

	.items {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
		margin-top: 0.75rem;
	}

	.meal-item {
		min-width: 0;
	}

	.item-name span,
	.ingredient-row {
		color: color-mix(in srgb, var(--text) 82%, transparent);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin: 0.22rem 0 0;
		padding: 0 0 0 0.65rem;
		font-size: 0.92rem;
		line-height: 1.4;
		list-style: none;
	}

	.row-actions {
		display: flex;
		flex: 0 0 auto;
		gap: 0.05rem;
	}

	.row-actions button {
		--icon-size: 0.95rem;
		display: grid;
		width: 2.1rem;
		height: 2.1rem;
		place-items: center;
		border: 0;
		border-radius: 999px;
		padding: 0;
		background: transparent;
		color: color-mix(in srgb, var(--text) 52%, transparent);
		cursor: pointer;
	}

	.row-actions button:hover {
		background: color-mix(in srgb, var(--text) 6%, transparent);
		color: var(--text);
	}

	.add-button {
		margin-top: 0.35rem;
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
	.add-button:hover,
	.edit-button:hover,
	.form-actions button:hover,
	.edit-error button:hover {
		color: color-mix(in srgb, var(--accent) 76%, var(--text));
	}

	.occurrence-editor,
	.inline-editor {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.65rem;
		border-radius: 0.65rem;
		padding: 0.65rem;
		background: color-mix(in srgb, var(--text) 4%, transparent);
	}

	.occurrence-editor label,
	.inline-editor label {
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

	.form-actions {
		display: flex;
		gap: 0.85rem;
	}

	.form-actions button:not(.save) {
		color: var(--muted);
	}

	.ingredient-editor {
		margin: 0.35rem 0;
	}

	.new-item-editor {
		margin-top: 0.75rem;
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

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
