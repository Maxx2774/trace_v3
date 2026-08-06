<script lang="ts">
	import ChevronRightIcon from '$lib/components/icons/ChevronRightIcon.svelte';
	import CheckmarkIcon from '$lib/components/icons/CheckmarkIcon.svelte';
	import ChatHistoryIcon from '$lib/components/icons/ChatHistoryIcon.svelte';
	import CloseIcon from '$lib/components/icons/CloseIcon.svelte';
	import DeleteIcon from '$lib/components/icons/DeleteIcon.svelte';
	import MoreHorizontalIcon from '$lib/components/icons/MoreHorizontalIcon.svelte';
	import NewConversationIcon from '$lib/components/icons/NewConversationIcon.svelte';
	import MealCard from '$lib/features/meals/components/MealCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import PopoverItem from '$lib/components/ui/PopoverItem.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { cubicOut } from 'svelte/easing';
	import { fade } from 'svelte/transition';
	import { getRecentConversationDateLabel } from '../conversation-date';
	import type { ConversationPage } from '../contracts';
	import AssistantMessageLoader from './AssistantMessageLoader.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ConversationList from './ConversationList.svelte';
	import { createChatSession } from '../chat-session.svelte';

	let {
		open,
		initialConversationPage,
		onClose
	}: { open: boolean; initialConversationPage: ConversationPage; onClose: () => void } = $props();
	let fullscreen = $state(false);
	let reducedMotion = $state(false);
	let messageScroller = $state<HTMLElement | null>(null);
	const session = createChatSession({
		initialConversationPage: untrack(() => initialConversationPage),
		onMessagesChanged: scrollToBottom,
		onJournalRecordCreated: (entry) => {
			if (entry.record.kind === 'meal') {
				window.dispatchEvent(new CustomEvent('tracemealcreated', { detail: entry.record.value }));
			}
			void scrollToBottom();
		}
	});
	let recordsByTurn = $derived.by(() => {
		const grouped = new SvelteMap<string, typeof session.journalRecords>();
		for (const entry of session.journalRecords) {
			const records = grouped.get(entry.turnId) ?? [];
			grouped.set(entry.turnId, [...records, entry]);
		}
		return grouped;
	});
	let recentConversations = $derived(session.conversations.slice(0, 3));
	let conversationActive = $derived(
		!session.historyOpen &&
			(session.activeConversationId !== null ||
				session.messages.length > 0 ||
				session.conversationLoading)
	);

	onMount(() => {
		const fullscreenQuery = window.matchMedia('(max-width: 767px)');
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const syncFullscreen = () => (fullscreen = fullscreenQuery.matches);
		const syncMotion = () => (reducedMotion = motionQuery.matches);
		const reloadMeal = () => session.reloadActiveConversation();

		syncFullscreen();
		syncMotion();
		fullscreenQuery.addEventListener('change', syncFullscreen);
		motionQuery.addEventListener('change', syncMotion);
		window.addEventListener('tracemealreloadrequested', reloadMeal);

		return () => {
			fullscreenQuery.removeEventListener('change', syncFullscreen);
			motionQuery.removeEventListener('change', syncMotion);
			window.removeEventListener('tracemealreloadrequested', reloadMeal);
		};
	});

	onDestroy(() => session.destroy());

	function close() {
		session.close();
		onClose();
	}

	async function scrollToBottom() {
		await tick();
		messageScroller?.scrollTo({ top: messageScroller.scrollHeight });
	}

	async function loadOlderMessages(scroller = messageScroller) {
		if (!scroller) return;
		const previousHeight = scroller.scrollHeight;
		const loaded = await session.loadOlderMessages();
		if (!loaded) return;

		await tick();
		scroller.scrollTop += scroller.scrollHeight - previousHeight;
	}

	function observeHistoryStart(node: HTMLElement) {
		const scroller = node.closest<HTMLElement>('.messages');
		if (!scroller) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadOlderMessages(scroller);
			},
			{ root: scroller, rootMargin: '240px 0px 0px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	}

	function connectMessageScroller(node: HTMLElement) {
		messageScroller = node;
		return () => {
			if (messageScroller === node) messageScroller = null;
		};
	}

	function formatTime(value: string): string {
		const date = new Date(value);
		return `Idag ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	function turnCompleted(turnId: string): boolean {
		return session.messages.some(
			(message) => message.turnId === turnId && message.role === 'assistant' && !message.pending
		);
	}

	function turnHasRecords(turnId: string): boolean {
		return (recordsByTurn.get(turnId)?.length ?? 0) > 0;
	}

	function blurFade(_node: Element, { duration = 300 } = {}) {
		return {
			duration: reducedMotion ? 0 : duration,
			easing: cubicOut,
			css: (t: number) => `opacity: ${t}; filter: blur(${(1 - t) * 8}px);`
		};
	}
</script>

<Sheet {open} onClose={close} label="Trace">
	<div class={['panel-shell', open && 'mobile-open']} role="dialog" aria-label="Trace-konversation">
		<button class="close-tab" type="button" aria-label="Stäng Trace" onclick={close}>
			<ChevronRightIcon />
		</button>

		<div class="panel">
			<header class="toolbar">
				<div class="toolbar-start">
					{#if session.historyOpen}
						<h2 class="history-title">Konversationer</h2>
					{:else if conversationActive}
						<Button
							variant="secondary"
							size="md"
							leadingIcon={NewConversationIcon}
							aria-label="Ny chatt"
							disabled={session.streaming}
							onclick={session.startNewConversation}
						/>
					{:else}
						<Button
							variant="ghost"
							size="md"
							leadingIcon={ChatHistoryIcon}
							aria-label="Konversationer"
							aria-expanded={session.historyOpen}
							onclick={session.openHistory}
						/>
					{/if}
				</div>

				<div class="toolbar-end">
					{#if session.historyOpen}
						<Button
							variant="secondary"
							size={fullscreen ? 'lg' : 'md'}
							leadingIcon={NewConversationIcon}
							aria-label="Ny konversation"
							disabled={session.streaming}
							onclick={session.startNewConversation}
						/>
					{:else if conversationActive}
						<Button
							variant="ghost"
							size="md"
							leadingIcon={ChatHistoryIcon}
							aria-label="Konversationer"
							aria-expanded={session.historyOpen}
							onclick={session.openHistory}
						/>

						<Popover placement="bottom-end" size="sm" role="menu" width="max-content">
							{#snippet trigger(menuOpen, toggle)}
								<Button
									variant="ghost"
									size="md"
									leadingIcon={MoreHorizontalIcon}
									aria-label="Konversationsmeny"
									aria-haspopup="menu"
									aria-expanded={menuOpen}
									onclick={toggle}
								/>
							{/snippet}

							<PopoverItem
								variant="destructive"
								leadingIcon={DeleteIcon}
								disabled={session.streaming ||
									session.conversationLoading ||
									session.olderMessagesLoading}
								onclick={() => session.deleteConversation()}>Radera konversation</PopoverItem
							>
						</Popover>
					{/if}

					<div class="fullscreen-close">
						<Button
							variant="ghost"
							size="md"
							leadingIcon={CloseIcon}
							aria-label="Stäng Trace"
							onclick={close}
						/>
					</div>
				</div>
			</header>

			<div class="view-stack">
				{#if session.historyOpen}
					<div class="history" in:fade={{ duration: 180 }} out:fade={{ duration: 140 }}>
						<ConversationList
							conversations={session.conversations}
							loading={session.conversationLoading}
							loadingMore={session.historyLoading}
							hasMore={session.hasMoreConversations}
							errorMessage={session.historyError}
							loadMoreError={session.paginationError}
							activeConversationId={session.activeConversationId}
							onSelect={session.selectConversation}
							onDelete={session.deleteConversation}
							onRename={session.renameConversation}
							onLoadMore={session.loadMoreConversations}
						/>
					</div>
				{:else}
					<div
						class={['chat-view', !conversationActive && 'new-conversation']}
						in:fade={{ duration: 180 }}
						out:fade={{ duration: 140 }}
					>
						<section
							class="messages"
							aria-label="Konversationsmeddelanden"
							aria-busy={session.conversationLoading || session.olderMessagesLoading}
							{@attach connectMessageScroller}
						>
							{#if !session.conversationLoading}
								<div class="message-content" in:blurFade={{ duration: 300 }}>
									{#if session.olderMessagesError}
										<div class="older-messages-error" role="status">
											<span>{session.olderMessagesError}</span>
											<button type="button" onclick={() => void loadOlderMessages()}
												>Försök igen</button
											>
										</div>
									{:else if session.hasOlderMessages}
										<div class="history-start" {@attach observeHistoryStart}>
											{#if session.olderMessagesLoading}
												<div
													class="older-message-skeletons"
													role="status"
													aria-label="Laddar äldre meddelanden"
												>
													<Skeleton width="62%" height="2.4rem" radius="1rem" />
													<Skeleton width="78%" height="3.2rem" radius="0.75rem" />
													<Skeleton width="54%" height="2.4rem" radius="1rem" />
												</div>
											{/if}
										</div>
									{/if}
									{#if session.startedAt}
										<time datetime={session.startedAt}>{formatTime(session.startedAt)}</time>
									{/if}
									{#each session.messages as message (message.id)}
										{#if message.role === 'user'}
											<article class="user-message"><p>{message.content}</p></article>
											{@const records = recordsByTurn.get(message.turnId) ?? []}
											{#if records.length > 0}
												<div class="turn-records">
													<p class="registration-status" role="status">
														<CheckmarkIcon />
														<span>Registrerat</span>
													</p>
													{#each records as entry (entry.record.value.id)}
														{#if entry.record.kind === 'meal'}
															<MealCard
																meal={entry.record.value}
																editable={turnCompleted(message.turnId)}
																onUpdated={session.updateMealRecord}
															/>
														{/if}
													{/each}
												</div>
											{/if}
										{:else if message.content && (!turnHasRecords(message.turnId) || message.content !== 'Registrerat')}
											<AssistantMessageLoader content={message.content} />
										{:else if message.pending && !turnHasRecords(message.turnId)}
											<p class="formulating-status" data-text="Formulerar svar" role="status">
												Formulerar svar
											</p>
										{/if}
									{/each}
									{#if session.statusMessage}
										<p class="status-message" role="status">{session.statusMessage}</p>
										{#if session.canRetry}
											<button class="retry-button" type="button" onclick={session.retryLastTurn}>
												Försök igen
											</button>
										{/if}
									{/if}
								</div>
							{/if}
						</section>

						<div class="composer-shell">
							<ChatComposer
								autoFocus
								disabled={session.conversationLoading}
								onSubmit={session.submit}
								streaming={session.streaming}
								stoppable={session.canStopResponse}
								onStop={session.stopResponse}
							/>
						</div>

						{#if !conversationActive && recentConversations.length > 0}
							<nav class="recent-conversations" aria-label="Senaste konversationer">
								<ul>
									{#each recentConversations as conversation (conversation.id)}
										<li>
											<button
												type="button"
												onclick={() => session.selectConversation(conversation.id)}
											>
												<span>{conversation.title}</span>
												<time datetime={conversation.lastMessageAt}>
													{getRecentConversationDateLabel(conversation.lastMessageAt)}
												</time>
											</button>
										</li>
									{/each}
								</ul>
							</nav>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</Sheet>

<style>
	.panel-shell {
		position: fixed;
		inset: 0 0 0 auto;
		z-index: 1;
		width: 100vw;
		box-sizing: border-box;
		filter: blur(8px);
		color: var(--text);
		opacity: 0;
		pointer-events: auto;
		transition:
			opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
			filter 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.panel-shell.mobile-open {
		filter: none;
		opacity: 1;
		transition-duration: 340ms;
	}

	.panel {
		display: grid;
		position: relative;
		width: 100%;
		height: 100%;
		grid-template-rows: auto minmax(0, 1fr);
		box-sizing: border-box;
		border: 0;
		border-radius: 0;
		background: var(--chat-panel-background);
		box-shadow: none;
		overflow: hidden;
	}

	.close-tab {
		--icon-size: 1.1rem;
		position: absolute;
		top: 5.95rem;
		left: calc(-1.5rem - 1px);
		z-index: 2;
		display: grid;
		width: calc(1.5rem + 1px);
		height: 3rem;
		place-items: center;
		box-sizing: border-box;
		border: 1px solid var(--chat-panel-border);
		border-right: 0;
		border-radius: 0.5rem 0 0 0.5rem;
		padding: 0;
		background: var(--chat-panel-background);
		box-shadow: -0.2rem 0 0.65rem rgb(23 32 51 / 8%);
		color: color-mix(in srgb, var(--text) 58%, transparent);
		cursor: pointer;
		transform: translateY(-50%);
		transition: color 140ms ease;
	}

	.close-tab:hover,
	.close-tab:active {
		color: var(--text);
	}

	.close-tab:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 42%, transparent);
		outline-offset: 2px;
	}

	.toolbar {
		display: flex;
		position: relative;
		min-height: 4.25rem;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
		padding: 0.75rem;
		background: transparent;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-synthesis: none;
	}

	.toolbar-start,
	.toolbar-end {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.history-title {
		margin: 0 0 0 0.65rem;
		color: var(--text);
		font-size: 1.53rem;
		font-weight: 400;
		line-height: 1.2;
	}

	.fullscreen-close {
		display: none;
	}

	.messages,
	.history {
		min-height: 0;
		overflow-y: auto;
		box-sizing: border-box;
		scrollbar-color: color-mix(in srgb, var(--text) 22%, transparent) transparent;
		scrollbar-width: thin;
	}

	.view-stack {
		display: grid;
		min-height: 0;
		grid-template-areas: 'view';
		overflow: hidden;
	}

	.chat-view {
		display: grid;
		min-height: 0;
		grid-area: view;
		grid-template-rows: minmax(0, 1fr) auto;
	}

	.chat-view.new-conversation {
		grid-template-rows: minmax(2rem, 0.42fr) auto auto minmax(2rem, 0.58fr);
	}

	.chat-view.new-conversation .composer-shell {
		--composer-min-height: 7.5rem;

		margin-inline: 2rem;
		border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
		border-radius: 1rem;
		background: var(--background);
		box-shadow: 0 0.75rem 2rem rgb(23 32 51 / 10%);
	}

	.recent-conversations {
		min-width: 0;
		margin: 0.65rem 2rem 0;
	}

	.recent-conversations ul {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.recent-conversations button {
		display: grid;
		width: 100%;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		box-sizing: border-box;
		border: 0;
		border-radius: 0.5rem;
		padding: 0.45rem 0.65rem;
		background: transparent;
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		font-family: 'General Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.1rem;
		font-weight: 400;
		line-height: 1.25;
		text-align: left;
		cursor: pointer;
		transition:
			background 140ms ease,
			color 140ms ease;
	}

	.recent-conversations button:hover,
	.recent-conversations button:active {
		background: color-mix(in srgb, var(--text) 5%, transparent);
		color: var(--text);
	}

	.recent-conversations span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recent-conversations time {
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		font-size: 1.1rem;
		font-variant-numeric: tabular-nums;
		line-height: inherit;
		white-space: nowrap;
		transition: color 140ms ease;
	}

	.recent-conversations button:hover time,
	.recent-conversations button:active time {
		color: var(--text);
	}

	.messages {
		padding: 1rem 1rem 1.5rem;
		overflow-anchor: none;
	}

	.message-content {
		display: flex;
		min-height: 100%;
		flex-direction: column;
		gap: 1.5rem;
	}

	.history-start {
		min-height: 1px;
	}

	.older-message-skeletons {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-bottom: 0.75rem;
	}

	.older-message-skeletons :global(.skeleton:nth-child(odd)) {
		align-self: flex-end;
	}

	.older-messages-error {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.82rem;
	}

	.older-messages-error button {
		border: 0;
		padding: 0.15rem 0.25rem;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 0.14em;
		cursor: pointer;
	}

	time {
		align-self: center;
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		font-size: 0.95rem;
		line-height: 1;
	}

	.user-message {
		max-width: min(80%, 32rem);
		font-size: 1.1rem;
		line-height: 1.4;
		word-break: break-word;
	}

	.user-message {
		align-self: flex-end;
		border-radius: 1.15rem 0.65rem 1.15rem 1.15rem;
		padding: 0.55rem 1rem;
		background: var(--background);
		color: var(--text);
	}

	.user-message p {
		margin: 0;
		white-space: pre-wrap;
	}

	.turn-records {
		display: flex;
		align-self: stretch;
		flex-direction: column;
		gap: 0.65rem;
	}

	.registration-status {
		--icon-size: 1.4em;

		display: inline-flex;
		align-self: flex-start;
		align-items: center;
		gap: 0.2rem;
		margin: 0;
		color: var(--accent);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 435;
		line-height: 1.3;
	}

	.formulating-status {
		position: relative;
		align-self: flex-start;
		margin: 0;
		color: var(--muted);
		font-size: 1.1rem;
		line-height: 1.4;
	}

	.formulating-status::after {
		position: absolute;
		inset: 0;
		color: color-mix(in oklch, var(--accent) 72%, var(--text));
		content: attr(data-text);
		mask-image: linear-gradient(90deg, transparent, black 50%, transparent);
		mask-position: -100% 0;
		mask-repeat: no-repeat;
		mask-size: 45% 100%;
		pointer-events: none;
		-webkit-mask-image: linear-gradient(90deg, transparent, black 50%, transparent);
		-webkit-mask-position: -100% 0;
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-size: 45% 100%;
		animation: formulating-sweep 2.2s linear infinite;
	}

	@keyframes formulating-sweep {
		from {
			mask-position: -100% 0;
			-webkit-mask-position: -100% 0;
		}

		55%,
		100% {
			mask-position: 200% 0;
			-webkit-mask-position: 200% 0;
		}
	}

	.history {
		display: block;
		min-height: 0;
		grid-area: view;
		overflow: hidden;
	}

	.status-message {
		align-self: center;
		margin: 0;
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.35;
		text-align: center;
	}

	.retry-button {
		align-self: center;
		border: 0;
		padding: 0.2rem 0.35rem;
		background: transparent;
		color: var(--text);
		font-size: 0.82rem;
		text-decoration: underline;
		text-underline-offset: 0.16em;
		cursor: pointer;
	}

	.composer-shell {
		min-width: 0;
		max-height: 12rem;
		margin: 0;
		border: 0;
		border-top: 1px solid color-mix(in srgb, var(--text) 6%, transparent);
		border-radius: 0;
		background: var(--chat-composer-background);
		box-shadow: none;
		overflow: hidden;
	}

	@media (max-width: 767px) {
		.close-tab {
			display: none;
		}

		.fullscreen-close {
			display: block;
		}
	}

	@media (min-width: 768px) and (max-width: 959px) {
		.panel-shell {
			width: var(--chat-panel-width);
			filter: none;
			background: color-mix(in srgb, var(--chat-panel-background) 88%, transparent);
			-webkit-backdrop-filter: blur(12px);
			backdrop-filter: blur(12px);
		}

		.panel {
			border-left: 1px solid var(--chat-panel-border);
			background: transparent;
			filter: blur(8px);
			transition: filter 220ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		.panel-shell.mobile-open .panel {
			filter: none;
			transition-duration: 340ms;
		}
	}

	@media (min-width: 960px) {
		.panel-shell {
			width: var(--chat-panel-width);
			filter: none;
			opacity: 1;
			transition: none;
		}

		.panel {
			border-left: 1px solid var(--chat-panel-border);
		}

		.close-tab {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.formulating-status::after {
			display: none;
		}
	}

	:global(:root[data-theme='dark']) .user-message {
		background: var(--surface-hover);
	}

	:global(:root[data-theme='dark']) .chat-view.new-conversation .composer-shell {
		box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 34%);
	}

	:global(:root[data-theme='dark']) .close-tab {
		box-shadow: -0.2rem 0 0.65rem rgb(0 0 0 / 22%);
	}
</style>
