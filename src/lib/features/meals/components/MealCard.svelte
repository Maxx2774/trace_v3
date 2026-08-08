<script lang="ts">
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import CheckmarkIcon from '$lib/components/icons/CheckmarkIcon.svelte';
	import EditIcon from '$lib/components/icons/EditIcon.svelte';
	import MealIcon from '$lib/components/icons/MealIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { getRevealMotion } from '$lib/motion';
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
		editorPresentation = 'overlay',
		variant = 'chat',
		onUpdated,
		onReloadRequested
	}: {
		meal: Meal;
		editable?: boolean;
		editorPresentation?: 'overlay' | 'inline';
		variant?: 'chat' | 'journal';
		onUpdated?: (meal: Meal) => void;
		onReloadRequested?: () => void;
	} = $props();

	let editing = $state(false);
	let saving = $state(false);
	let closing = $state(false);
	let editButtonSuppressed = $state(false);
	let cardElement = $state<HTMLElement | null>(null);
	let previewElement = $state<HTMLElement | null>(null);
	let slotElement = $state<HTMLDivElement | null>(null);
	let restingHeight = $state<number | null>(null);
	let overlayBounds = $state<{
		left: number;
		top: number;
		width: number;
		height: number;
		centerY: number;
		cardLeft: number;
		cardWidth: number;
	} | null>(null);
	let editor = $state<Editor | null>(null);
	let errorMessage = $state<string | null>(null);
	let revisionConflict = $state(false);
	let retryMutation = $state<{ signature: string; id: string } | null>(null);
	let overlayAnimation: Animation | null = null;
	let viewAnimation: Animation | null = null;
	let timeLabel = $derived(formatMealOccurrence(meal.occurrence));
	let selectedMealType = $derived(meal.mealType);
	let readOnlyMealLabel = $derived(
		meal.mealType === null
			? timeLabel
			: `${mealTypeLabel(meal.mealType)} ${lowercaseFirstLetter(timeLabel)}`
	);
	let journalMealTypeLabel = $derived(meal.mealType === null ? '' : mealTypeLabel(meal.mealType));
	let overlayStyle = $derived(
		overlayBounds
			? `--meal-overlay-left: ${overlayBounds.left}px; --meal-overlay-top: ${overlayBounds.top}px; --meal-overlay-width: ${overlayBounds.width}px; --meal-overlay-height: ${overlayBounds.height}px; --meal-overlay-center-y: ${overlayBounds.centerY}px; --meal-overlay-card-left: ${overlayBounds.cardLeft}px; --meal-overlay-card-width: ${overlayBounds.cardWidth}px;`
			: undefined
	);

	async function beginEditing() {
		if (closing) return;
		editButtonSuppressed = false;
		errorMessage = null;
		revisionConflict = false;
		restingHeight =
			editorPresentation === 'overlay'
				? (cardElement?.getBoundingClientRect().height ?? null)
				: null;
		if (editorPresentation === 'overlay') updateOverlayBounds();
		editing = true;
		await tick();
		if (editorPresentation === 'overlay') updateOverlayBounds();
		if (!cardElement || !overlayBounds || prefersReducedMotion()) return;
		const revealMotion = getRevealMotion(cardElement);
		overlayAnimation?.cancel();
		overlayAnimation = cardElement.animate(
			[
				{ filter: `blur(${revealMotion.blur})`, opacity: 0, transform: 'translateY(-50%)' },
				{ filter: 'blur(0)', opacity: 1, transform: 'translateY(-50%)' }
			],
			{ duration: revealMotion.duration, easing: revealMotion.easing }
		);
		await overlayAnimation.finished.catch(() => undefined);
		overlayAnimation = null;
	}

	async function finishEditing() {
		if (saving || closing) return;
		closing = true;
		overlayAnimation?.cancel();
		viewAnimation?.cancel();
		if (
			editorPresentation === 'overlay' &&
			cardElement &&
			overlayBounds &&
			!prefersReducedMotion()
		) {
			await tick();
			overlayAnimation = cardElement.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 260,
				easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
				fill: 'forwards'
			});
			if (previewElement) {
				viewAnimation = previewElement.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 260,
					easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
					fill: 'forwards'
				});
			}
			await Promise.all([
				overlayAnimation.finished.catch(() => undefined),
				viewAnimation?.finished.catch(() => undefined)
			]);
		}
		editor = null;
		errorMessage = null;
		revisionConflict = false;
		editButtonSuppressed = true;
		editing = false;
		restingHeight = null;
		overlayBounds = null;
		closing = false;
		await tick();
		overlayAnimation?.cancel();
		viewAnimation?.cancel();
		overlayAnimation = null;
		viewAnimation = null;
		await waitForPaint();
		editButtonSuppressed = false;
	}

	function waitForPaint(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	function updateOverlayBounds() {
		const messages = cardElement?.closest<HTMLElement>('.messages');
		if (!messages || !slotElement) return;
		const view = messages.getBoundingClientRect();
		const slot = slotElement.getBoundingClientRect();
		const inset = 8;
		const availableHeight = Math.max(0, view.height - inset * 2);
		const cardHeight = Math.min(
			cardElement?.getBoundingClientRect().height ?? slot.height,
			availableHeight
		);
		const preferredCenterY = slot.top + slot.height / 2;
		const minimumCenterY = view.top + inset + cardHeight / 2;
		const maximumCenterY = view.bottom - inset - cardHeight / 2;
		overlayBounds = {
			left: view.left,
			top: view.top,
			width: view.width,
			height: view.height,
			centerY:
				minimumCenterY <= maximumCenterY
					? Math.min(Math.max(preferredCenterY, minimumCenterY), maximumCenterY)
					: view.top + view.height / 2,
			cardLeft: slot.left,
			cardWidth: slot.width
		};
	}

	const trackCardSize: Attachment<HTMLElement> = (node) => {
		cardElement = node;
		const observer = new ResizeObserver(() => {
			if (editing && editorPresentation === 'overlay') updateOverlayBounds();
		});
		observer.observe(node);
		return () => {
			observer.disconnect();
			if (cardElement === node) cardElement = null;
		};
	};

	const trackPreview: Attachment<HTMLElement> = (node) => {
		previewElement = node;
		return () => {
			if (previewElement === node) previewElement = null;
		};
	};

	const trackSlot: Attachment<HTMLDivElement> = (node) => {
		slotElement = node;
		return () => {
			if (slotElement === node) slotElement = null;
		};
	};

	function handleWindowResize() {
		if (editing && editorPresentation === 'overlay') updateOverlayBounds();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (editing && event.key === 'Escape') {
			event.preventDefault();
			void finishEditing();
		}
	}

	function prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
		if (mealType === selectedMealType) return;
		const previousMealType = meal.mealType;
		selectedMealType = mealType;
		const saved = await commit({ mealType });
		if (!saved) selectedMealType = previousMealType;
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
	): Promise<boolean> {
		if (saving) return false;
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
			return true;
		} catch (cause) {
			revisionConflict = isRevisionConflict(cause);
			errorMessage = revisionConflict
				? 'Måltiden har ändrats sedan kortet laddades.'
				: 'Måltiden kunde inte sparas.';
			return false;
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

	function lowercaseFirstLetter(value: string): string {
		return value.length === 0 ? value : value[0].toLocaleLowerCase('sv-SE') + value.slice(1);
	}
</script>

<svelte:window onresize={handleWindowResize} onkeydown={handleWindowKeydown} />

{#snippet mealEditButton()}
	<Button
		variant="ghost"
		size="compact"
		type="button"
		style="--icon-size: 18px; color: color-mix(in srgb, var(--text) 58%, transparent); transition: none;"
		leadingIcon={EditIcon}
		aria-label="Redigera måltid"
		disabled={saving}
		onclick={beginEditing}
	/>
{/snippet}

{#snippet mealItems(editMode: boolean)}
	{#if !editMode && variant === 'journal'}
		<div class="journal-heading">
			<span class="journal-kind">
				<span class="journal-kind-icon"><MealIcon /></span>
				<span>Måltid</span>
			</span>
			<span class="journal-meta">
				<span class="journal-time-label"><span>{journalMealTypeLabel}</span></span>
				{#if editable && !closing}
					<span class="journal-edit-button">{@render mealEditButton()}</span>
				{/if}
			</span>
		</div>
	{/if}
	<div class="items">
		{#each meal.items as item, index (item.id)}
			<MealItemSection
				{item}
				editing={editMode}
				{saving}
				metaLabel={!editMode && variant === 'chat' && index === 0 ? readOnlyMealLabel : null}
				metaAction={!editMode && variant === 'chat' && index === 0 && editable && !closing
					? mealEditButton
					: undefined}
				editorActive={editMode && editor !== null}
				canRemove={meal.items.length > 1}
				itemDraft={editMode && editor?.kind === 'item' && editor.id === item.id ? editor : null}
				ingredientDraft={editMode && editor?.kind === 'ingredient' && editor.itemId === item.id
					? editor
					: null}
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
{/snippet}

<div
	{@attach trackSlot}
	class="meal-card-slot"
	style:height={editing && restingHeight !== null ? `${restingHeight}px` : undefined}
>
	{#if editing && overlayBounds}
		<button
			class="editing-backdrop"
			type="button"
			tabindex="-1"
			aria-label="Avsluta redigering"
			style={overlayStyle}
			disabled={saving || closing}
			onclick={finishEditing}
			onwheel={(event) => event.preventDefault()}
		></button>
	{/if}
	{#if closing}
		<article
			class={['meal-card', 'view-preview', variant === 'journal' && 'journal']}
			aria-hidden="true"
			{@attach trackPreview}
		>
			{@render mealItems(false)}
		</article>
	{/if}

	<article
		{@attach trackCardSize}
		class={[
			'meal-card',
			variant === 'journal' && 'journal',
			editing && 'editing',
			closing && 'closing',
			editButtonSuppressed && 'edit-button-suppressed',
			meal.items.length > 1 && 'multi-item',
			overlayBounds && 'overlay',
			editable && 'editable'
		]}
		aria-label="Registrerad måltid"
		style={overlayStyle}
	>
		{#if editing}
			<div class="meal-heading">
				<Select
					value={selectedMealType}
					options={MEAL_TYPE_OPTIONS}
					placeholder="Välj måltidstyp"
					label="Måltidstyp"
					disabled={saving}
					onValueChange={changeMealType}
				/>
				<span class="time-label">{timeLabel}</span>
			</div>

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

		{@render mealItems(editing)}

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

		{#if editable && editing}
			<div class={['edit-button', editing && 'editing']}>
				<Button
					variant="ghost"
					size="compact"
					type="button"
					leadingIcon={CheckmarkIcon}
					aria-label="Avsluta redigering"
					disabled={saving || closing}
					onclick={finishEditing}
				/>
			</div>
		{/if}
	</article>
</div>

<style>
	.meal-card-slot {
		width: var(--meal-card-width, min(80%, 32rem));
		align-self: flex-start;
	}

	.meal-card {
		--meal-card-background: var(--background);

		position: relative;
		width: 100%;
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--accent) 10%, transparent);
		border-radius: 1rem;
		padding: 0.8rem 1rem 0.75rem;
		background: var(--meal-card-background);
		box-shadow: 0 0.25rem 0.9rem rgb(23 32 51 / 4%);
		color: var(--text);
	}

	.meal-card.journal {
		border-color: color-mix(in srgb, var(--accent) 6%, transparent);
	}

	.editing-backdrop {
		position: fixed;
		top: var(--meal-overlay-top);
		left: var(--meal-overlay-left);
		z-index: 3;
		width: var(--meal-overlay-width);
		height: var(--meal-overlay-height);
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}

	.meal-card.editing.overlay {
		position: fixed;
		top: var(--meal-overlay-center-y);
		left: var(--meal-overlay-card-left);
		z-index: 4;
		width: var(--meal-overlay-card-width);
		max-height: calc(var(--meal-overlay-height) - 2rem);
		box-shadow: 0 1rem 3rem rgb(23 32 51 / 18%);
		overflow-y: auto;
		transform: translateY(-50%);
	}

	.meal-card.closing {
		pointer-events: none;
	}

	.view-preview {
		opacity: 0;
		pointer-events: none;
	}

	:global(:root[data-theme='dark']) .meal-card {
		border-color: color-mix(in srgb, var(--accent) 16%, transparent);
		box-shadow: none;
	}

	:global(:root[data-theme='dark']) .meal-card.journal {
		--meal-card-background: color-mix(in srgb, var(--text) 6%, var(--background));

		border-color: color-mix(in srgb, var(--text) 6%, transparent);
	}

	:global(:root[data-theme='dark']) .meal-card.editing.overlay {
		box-shadow: 0 1rem 3rem rgb(0 0 0 / 45%);
	}

	.meal-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.time-label {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.3;
		white-space: nowrap;
	}

	.journal-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.65rem;
	}

	.journal-kind {
		--icon-size: 1.15rem;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 400;
		line-height: 1.3;
	}

	.journal-kind-icon {
		display: inline-flex;
		color: var(--accent);
	}

	.journal-meta {
		position: relative;
		display: inline-flex;
		min-width: 2rem;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
	}

	.journal-time-label {
		position: relative;
		z-index: 1;
		margin-right: -0.5rem;
		padding-right: 0.5rem;
		background: var(--meal-card-background);
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.3;
		white-space: nowrap;
	}

	.journal-time-label::before {
		position: absolute;
		top: 50%;
		right: 0;
		z-index: 0;
		width: 100%;
		min-width: 2rem;
		height: 2rem;
		background: var(--meal-card-background);
		content: '';
		transform: translateY(-50%);
	}

	.journal-time-label > span {
		position: relative;
		z-index: 1;
	}

	.journal-edit-button {
		position: absolute;
		top: 50%;
		right: -0.5rem;
		z-index: 0;
		display: inline-flex;
		pointer-events: none;
		transform: translateY(-50%);
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
		margin-top: 0;
	}

	.meal-card.editing .items {
		margin-top: 0.75rem;
	}

	.change-time-button,
	.add-item-button,
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
		position: absolute;
		top: 0;
		right: 0.5rem;
		bottom: 0;
		z-index: 1;
		height: 2rem;
		margin-block: auto;
		border-radius: 0.55rem;
		background: var(--meal-card-background);
		transition: opacity 160ms ease;
	}

	.edit-button.editing {
		top: 0.5rem;
		bottom: auto;
		margin-block: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		.meal-card.editable:hover,
		.meal-card.editable:focus-within {
			--meal-action-pointer-events: auto;
			--meal-meta-visibility: hidden;
		}

		.meal-card.journal:hover .journal-edit-button,
		.meal-card.journal:focus-within .journal-edit-button {
			pointer-events: auto;
		}

		.meal-card.journal:hover .journal-time-label,
		.meal-card.journal:focus-within .journal-time-label {
			visibility: hidden;
		}
	}

	.meal-card.edit-button-suppressed .edit-button {
		opacity: 0;
		pointer-events: none;
		transition: none;
	}

	.change-time-button:hover,
	.add-item-button:hover,
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
