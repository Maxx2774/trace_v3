<script lang="ts">
	import type { Snippet } from 'svelte';
	import DeleteIcon from '$lib/components/icons/DeleteIcon.svelte';
	import EditIcon from '$lib/components/icons/EditIcon.svelte';
	import type { MealIngredient, MealItem } from '../contracts';
	import type { MealIngredientDraft, MealItemDraft } from '../meal-mutations';
	import MealEntryEditor from './MealEntryEditor.svelte';

	let {
		item,
		editing,
		saving,
		metaLabel = null,
		metaAction,
		editorActive,
		canRemove,
		itemDraft,
		ingredientDraft,
		onEditItem,
		onRemoveItem,
		onAddIngredient,
		onEditIngredient,
		onRemoveIngredient,
		onItemDraftChange,
		onIngredientDraftChange,
		onSaveItem,
		onSaveIngredient,
		onCancelEditor
	}: {
		item: MealItem;
		editing: boolean;
		saving: boolean;
		metaLabel?: string | null;
		metaAction?: Snippet;
		editorActive: boolean;
		canRemove: boolean;
		itemDraft: MealItemDraft | null;
		ingredientDraft: MealIngredientDraft | null;
		onEditItem: () => void;
		onRemoveItem: () => void | Promise<void>;
		onAddIngredient: () => void;
		onEditIngredient: (ingredientId: string) => void;
		onRemoveIngredient: (ingredientId: string) => void | Promise<void>;
		onItemDraftChange: (draft: MealItemDraft) => void;
		onIngredientDraftChange: (draft: MealIngredientDraft) => void;
		onSaveItem: (draft: MealItemDraft) => void | Promise<void>;
		onSaveIngredient: (draft: MealIngredientDraft) => void | Promise<void>;
		onCancelEditor: () => void;
	} = $props();

	function capitalizeFirstLetter(value: string): string {
		return value.length === 0 ? value : value[0].toLocaleUpperCase('sv-SE') + value.slice(1);
	}

	function lowercaseFirstLetter(value: string): string {
		return value.length === 0 ? value : value[0].toLocaleLowerCase('sv-SE') + value.slice(1);
	}

	function formatIngredient(ingredient: MealIngredient): string {
		const name = lowercaseFirstLetter(ingredient.name);
		return ingredient.amountText ? `${ingredient.amountText} ${name}` : name;
	}

	let inlineIngredients = $derived(item.ingredients.map(formatIngredient).join(', '));
</script>

<section class="meal-item">
	{#if itemDraft}
		<MealEntryEditor
			draft={itemDraft}
			{saving}
			onChange={onItemDraftChange}
			onSave={onSaveItem}
			onCancel={onCancelEditor}
		/>
	{:else}
		<div class="item-row">
			<p class="item-name">
				{capitalizeFirstLetter(item.name)}{#if item.amountText}<span>
						· {item.amountText}</span
					>{/if}
				{#if !editing && inlineIngredients}
					<span class="inline-ingredients"> · {inlineIngredients}</span>
				{/if}
			</p>
			{#if metaLabel}
				<span class="meta">
					<span class="meta-label"><span>{metaLabel}</span></span>
					{#if metaAction}<span class="meta-action">{@render metaAction()}</span>{/if}
				</span>
			{/if}
			{#if editing}
				<div class="row-actions">
					<button
						type="button"
						aria-label={`Redigera ${item.name}`}
						disabled={saving}
						onclick={onEditItem}><EditIcon /></button
					>
					{#if canRemove}
						<button
							type="button"
							aria-label={`Ta bort ${item.name}`}
							disabled={saving}
							onclick={() => void onRemoveItem()}><DeleteIcon /></button
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if editing && item.ingredients.length > 0}
		<ul aria-label={`Ingredienser i ${capitalizeFirstLetter(item.name)}`}>
			{#each item.ingredients as ingredient (ingredient.id)}
				<li>
					{#if ingredientDraft?.id === ingredient.id}
						<MealEntryEditor
							draft={ingredientDraft}
							{saving}
							variant="ingredient"
							onChange={(draft) => onIngredientDraftChange({ ...draft, itemId: item.id })}
							onSave={(draft) => onSaveIngredient({ ...draft, itemId: item.id })}
							onCancel={onCancelEditor}
						/>
					{:else}
						<div class="ingredient-row">
							<span>
								{lowercaseFirstLetter(ingredient.name)}{#if ingredient.amountText}
									· {ingredient.amountText}{/if}
							</span>
							{#if editing}
								<div class="row-actions">
									<button
										type="button"
										aria-label={`Redigera ${ingredient.name}`}
										disabled={saving}
										onclick={() => onEditIngredient(ingredient.id)}><EditIcon /></button
									>
									<button
										type="button"
										aria-label={`Ta bort ${ingredient.name}`}
										disabled={saving}
										onclick={() => void onRemoveIngredient(ingredient.id)}><DeleteIcon /></button
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
		{#if ingredientDraft?.id === null}
			<MealEntryEditor
				draft={ingredientDraft}
				{saving}
				variant="ingredient"
				onChange={(draft) => onIngredientDraftChange({ ...draft, itemId: item.id })}
				onSave={(draft) => onSaveIngredient({ ...draft, itemId: item.id })}
				onCancel={onCancelEditor}
			/>
		{:else}
			<button
				class="add-button"
				type="button"
				disabled={saving || editorActive}
				onclick={onAddIngredient}>Lägg till ingrediens</button
			>
		{/if}
	{/if}
</section>

<style>
	.meal-item {
		min-width: 0;
	}

	.item-row,
	.ingredient-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.item-name {
		min-width: 0;
		margin: 0;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 400;
		line-height: 1.3;
	}

	.item-name span,
	.ingredient-row {
		color: color-mix(in srgb, var(--text) 82%, transparent);
	}

	.item-name .inline-ingredients {
		font-family: 'General Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.92rem;
	}

	.meta {
		position: relative;
		display: inline-flex;
		min-width: 2rem;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
	}

	.meta-label {
		position: relative;
		z-index: 1;
		margin-right: -0.5rem;
		padding-right: 0.5rem;
		background: var(--background);
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.3;
		visibility: var(--meal-meta-visibility, visible);
		white-space: nowrap;
	}

	.meta-label::before {
		position: absolute;
		top: 50%;
		right: 0;
		z-index: 0;
		width: 100%;
		min-width: 2rem;
		height: 2rem;
		background: var(--background);
		content: '';
		transform: translateY(-50%);
	}

	.meta-label > span {
		position: relative;
		z-index: 1;
	}

	.meta-action {
		position: absolute;
		top: 50%;
		right: -0.5rem;
		z-index: 0;
		display: inline-flex;
		pointer-events: var(--meal-action-pointer-events, none);
		transform: translateY(-50%);
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
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--accent);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.86rem;
		font-weight: 435;
		cursor: pointer;
	}

	.add-button:hover {
		color: color-mix(in srgb, var(--accent) 76%, var(--text));
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
