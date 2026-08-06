<script lang="ts">
	import DeleteIcon from '$lib/components/icons/DeleteIcon.svelte';
	import EditIcon from '$lib/components/icons/EditIcon.svelte';
	import MoreHorizontalIcon from '$lib/components/icons/MoreHorizontalIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import PopoverItem from '$lib/components/ui/PopoverItem.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { getConversationDatePresentation } from '../conversation-date';
	import type { ConversationSummary } from '../contracts';

	type ConversationGroup = {
		key: string;
		label: string;
		items: Array<{ conversation: ConversationSummary; dateLabel: string }>;
	};

	let {
		conversations,
		loading = false,
		loadingMore = false,
		hasMore = false,
		errorMessage = null,
		loadMoreError = null,
		activeConversationId = null,
		onSelect,
		onDelete,
		onRename,
		onLoadMore
	}: {
		conversations: ConversationSummary[];
		loading?: boolean;
		loadingMore?: boolean;
		hasMore?: boolean;
		errorMessage?: string | null;
		loadMoreError?: string | null;
		activeConversationId?: string | null;
		onSelect: (id: string) => void;
		onDelete: (id: string) => void;
		onRename: (id: string, title: string) => Promise<boolean>;
		onLoadMore: () => void;
	} = $props();

	let openConversationMenuId = $state<string | null>(null);
	let editingConversationId = $state<string | null>(null);
	let renameTitle = $state('');
	let renamePending = $state(false);
	let renameError = $state<string | null>(null);
	let renameInput = $state<HTMLInputElement | null>(null);
	const skeletonRows = [
		{ id: 'first', titleWidth: '62%' },
		{ id: 'second', titleWidth: '48%' },
		{ id: 'third', titleWidth: '70%' }
	] as const;
	let conversationGroups = $derived(groupConversations(conversations));

	function groupConversations(items: ConversationSummary[]): ConversationGroup[] {
		const now = new Date();
		const groups: ConversationGroup[] = [];

		for (const conversation of items) {
			const presentation = getConversationDatePresentation(conversation.lastMessageAt, now);
			let group = groups.find((item) => item.key === presentation.groupKey);

			if (!group) {
				group = { key: presentation.groupKey, label: presentation.groupLabel, items: [] };
				groups.push(group);
			}

			group.items.push({ conversation, dateLabel: presentation.dateLabel });
		}

		return groups;
	}

	function setConversationMenuOpen(conversationId: string, open: boolean) {
		if (open) {
			openConversationMenuId = conversationId;
		} else if (openConversationMenuId === conversationId) {
			openConversationMenuId = null;
		}
	}

	async function startRenaming(conversation: ConversationSummary) {
		openConversationMenuId = null;
		editingConversationId = conversation.id;
		renameTitle = conversation.title;
		renameError = null;
		await tick();
		renameInput?.focus();
		renameInput?.select();
	}

	function cancelRenaming() {
		if (renamePending) return;
		editingConversationId = null;
		renameError = null;
	}

	async function saveRenamedConversation() {
		const conversationId = editingConversationId;
		if (!conversationId || renamePending) return;

		const title = renameTitle.trim();
		const currentTitle = conversations.find(
			(conversation) => conversation.id === conversationId
		)?.title;
		if (!title) {
			renameError = 'Namnet får inte vara tomt.';
			await tick();
			renameInput?.focus();
			return;
		}

		if (title === currentTitle) {
			cancelRenaming();
			return;
		}

		renamePending = true;
		renameError = null;
		const renamed = await onRename(conversationId, title);
		renamePending = false;

		if (renamed) {
			editingConversationId = null;
			return;
		}

		renameError = 'Namnet kunde inte ändras.';
		await tick();
		renameInput?.focus();
	}

	function handleRenameKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		cancelRenaming();
	}

	function observeLoadMore(canLoad: boolean, loadingPage: boolean): Attachment {
		return (element) => {
			if (!canLoad || loadingPage) return;

			const observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
				},
				{ root: element.closest('.conversation-list'), rootMargin: '0px 0px 40px' }
			);

			observer.observe(element);
			return () => observer.disconnect();
		};
	}
</script>

{#snippet conversationSkeletons(label: string)}
	<div class="loading-skeletons" role="status" aria-label={label}>
		{#each skeletonRows as row (row.id)}
			<div class="skeleton-row">
				<Skeleton width={row.titleWidth} height="1.25rem" />
				<Skeleton width="3.25rem" height="1.25rem" />
			</div>
		{/each}
	</div>
{/snippet}

{#snippet conversationRow(conversation: ConversationSummary, dateLabel: string)}
	<li
		class={{
			active: conversation.id === activeConversationId,
			'menu-open': conversation.id === openConversationMenuId,
			editing: conversation.id === editingConversationId
		}}
	>
		{#if conversation.id === editingConversationId}
			<form
				class="rename-form"
				onsubmit={(event) => {
					event.preventDefault();
					void saveRenamedConversation();
				}}
			>
				<input
					bind:this={renameInput}
					bind:value={renameTitle}
					class="rename-input"
					aria-label={`Nytt namn för ${conversation.title}`}
					aria-describedby={renameError ? `rename-error-${conversation.id}` : undefined}
					aria-invalid={renameError ? 'true' : undefined}
					maxlength="160"
					disabled={renamePending}
					onblur={() => void saveRenamedConversation()}
					onkeydown={handleRenameKeydown}
				/>
				{#if renameError}
					<span class="sr-only" id={`rename-error-${conversation.id}`} role="alert"
						>{renameError}</span
					>
				{/if}
			</form>
		{:else}
			<button class="conversation-button" type="button" onclick={() => onSelect(conversation.id)}>
				<span>{conversation.title}</span>
				<time datetime={conversation.lastMessageAt}>{dateLabel}</time>
			</button>
		{/if}
		<div class="conversation-menu">
			<Popover
				open={conversation.id === openConversationMenuId}
				placement="bottom-end"
				size="sm"
				role="menu"
				width="max-content"
				onOpenChange={(open) => setConversationMenuOpen(conversation.id, open)}
			>
				{#snippet trigger(menuOpen, toggle)}
					<Button
						variant="ghost"
						size="md"
						leadingIcon={MoreHorizontalIcon}
						aria-label={`Meny för ${conversation.title}`}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={toggle}
					/>
				{/snippet}
				<PopoverItem leadingIcon={EditIcon} onclick={() => void startRenaming(conversation)}>
					Byt namn
				</PopoverItem>
				<PopoverItem
					variant="destructive"
					leadingIcon={DeleteIcon}
					onclick={() => onDelete(conversation.id)}
				>
					Radera konversation
				</PopoverItem>
			</Popover>
		</div>
	</li>
{/snippet}

<section
	class="conversation-list"
	aria-label="Sparade konversationer"
	aria-busy={loading || loadingMore}
>
	{#if loading && conversations.length === 0}
		{@render conversationSkeletons('Laddar konversationer')}
	{:else if errorMessage && conversations.length === 0}
		<p class="state error">{errorMessage}</p>
	{:else if conversations.length === 0}
		<p class="state">Inga konversationer ännu.</p>
	{:else}
		<div class="conversation-groups">
			{#each conversationGroups as group (group.key)}
				<section class="conversation-group" aria-labelledby={`conversation-group-${group.key}`}>
					<h3 id={`conversation-group-${group.key}`}>{group.label}</h3>
					<ul>
						{#each group.items as item (item.conversation.id)}
							{@render conversationRow(item.conversation, item.dateLabel)}
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}

	{#if hasMore || loadingMore || loadMoreError}
		<div
			class={['load-more', { loading: loadingMore }]}
			{@attach observeLoadMore(hasMore && !loadMoreError, loadingMore)}
		>
			{#if loadingMore}
				{@render conversationSkeletons('Laddar fler konversationer')}
			{:else if loadMoreError}
				<p>{loadMoreError}</p>
				<button type="button" onclick={onLoadMore}>Försök igen</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.conversation-list {
		min-height: 0;
		height: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem 1rem;
		overflow-y: auto;
		overflow-anchor: none;
		scrollbar-color: color-mix(in srgb, var(--text) 22%, transparent) transparent;
		scrollbar-width: thin;
	}

	.conversation-groups {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.conversation-group {
		display: grid;
		gap: 0.2rem;
	}

	.conversation-group h3 {
		margin: 0;
		padding: 0.25rem 0.65rem 0.2rem;
		color: var(--muted);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.05rem;
		font-weight: 400;
		line-height: 1.25;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 2.5rem;
		align-items: center;
		border-radius: 0.5rem;
	}

	li:hover,
	li.active,
	li.menu-open,
	li.editing {
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.conversation-button {
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.conversation-button {
		grid-column: 1 / -1;
		grid-row: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		min-width: 0;
		gap: 0.75rem;
		padding: 0.3rem 0.65rem;
		text-align: left;
	}

	.conversation-button span {
		overflow: hidden;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 400;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rename-form {
		z-index: 2;
		display: grid;
		min-width: 0;
		min-height: 2.25rem;
		align-items: center;
		grid-column: 1 / -1;
		grid-row: 1;
		box-sizing: border-box;
		padding: 0.3rem 0.65rem;
	}

	.rename-input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		border: 0;
		outline: 0;
		padding: 0;
		background: transparent;
		color: var(--text);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 400;
		line-height: 1.25;
	}

	.rename-input:disabled {
		opacity: 0.6;
	}

	time {
		transition: opacity 120ms ease;
		color: var(--muted);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		white-space: nowrap;
	}

	.conversation-menu {
		position: relative;
		z-index: 1;
		grid-column: 2;
		grid-row: 1;
		justify-self: end;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}

	.conversation-menu :global(button:hover),
	.conversation-menu :global(button:active) {
		background: transparent;
	}

	.conversation-menu :global(button) {
		width: 2.25rem;
		min-width: 2.25rem;
		height: 2.25rem;
	}

	.conversation-menu :global(button:hover) {
		color: color-mix(in srgb, var(--text) 78%, transparent);
	}

	.menu-open .conversation-menu :global(button) {
		color: color-mix(in srgb, var(--text) 78%, transparent);
	}

	li:hover time,
	li:focus-within time,
	li.menu-open time {
		opacity: 0;
	}

	li:hover .conversation-menu,
	li:focus-within .conversation-menu,
	li.menu-open .conversation-menu {
		opacity: 1;
		pointer-events: auto;
	}

	li.editing .conversation-menu {
		opacity: 0;
		pointer-events: none;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		clip-path: inset(50%);
	}

	.state {
		display: grid;
		height: 100%;
		place-items: center;
		margin: 0;
		color: var(--muted);
		font-size: 1.1rem;
		text-align: center;
	}

	.state.error {
		color: var(--destructive-text);
	}

	.loading-skeletons {
		display: flex;
		width: 100%;
		flex-direction: column;
		gap: 0.125rem;
	}

	.skeleton-row {
		display: grid;
		min-height: 2.25rem;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) auto;
		box-sizing: border-box;
		gap: 0.75rem;
		padding: 0.4rem 0.65rem;
	}

	.load-more {
		display: grid;
		min-height: 1px;
		place-items: center;
		gap: 0.4rem;
		padding: 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
		text-align: center;
	}

	.load-more.loading {
		place-items: stretch;
		padding: 0.125rem 0 0;
	}

	.load-more p {
		margin: 0;
	}

	.load-more button {
		border: 0;
		padding: 0.35rem 0.6rem;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	@media (hover: none) {
		.conversation-button {
			padding-right: 3.15rem;
		}

		.conversation-menu {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
