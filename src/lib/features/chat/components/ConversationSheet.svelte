<script lang="ts">
	import ChevronRightIcon from '$lib/components/icons/ChevronRightIcon.svelte';
	import ChatHistoryIcon from '$lib/components/icons/ChatHistoryIcon.svelte';
	import CloseIcon from '$lib/components/icons/CloseIcon.svelte';
	import DeleteIcon from '$lib/components/icons/DeleteIcon.svelte';
	import MoreHorizontalIcon from '$lib/components/icons/MoreHorizontalIcon.svelte';
	import NewConversationIcon from '$lib/components/icons/NewConversationIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import PopoverItem from '$lib/components/ui/PopoverItem.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade } from 'svelte/transition';
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
		onMessagesChanged: scrollToBottom
	});
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

		syncFullscreen();
		syncMotion();
		fullscreenQuery.addEventListener('change', syncFullscreen);
		motionQuery.addEventListener('change', syncMotion);

		return () => {
			fullscreenQuery.removeEventListener('change', syncFullscreen);
			motionQuery.removeEventListener('change', syncMotion);
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

	function formatTime(value: string): string {
		const date = new Date(value);
		return `Idag ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
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
							variant="primary"
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
							collapseLabel={conversationActive}
							aria-label="Konversationer"
							aria-expanded={session.historyOpen}
							onclick={session.openHistory}>Konversationer</Button
						>
					{/if}
				</div>

				<div class="toolbar-end">
					{#if session.historyOpen}
						<Button
							variant="primary"
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
							collapseLabel
							aria-label="Konversationer"
							aria-expanded={session.historyOpen}
							onclick={session.openHistory}>Konversationer</Button
						>

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
								disabled={session.streaming || session.conversationLoading}
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
					<div class="chat-view" in:fade={{ duration: 180 }} out:fade={{ duration: 140 }}>
						<section
							class="messages"
							aria-label="Konversationsmeddelanden"
							aria-busy={session.conversationLoading}
							bind:this={messageScroller}
						>
							{#if !session.conversationLoading}
								<div class="message-content" in:blurFade={{ duration: 300 }}>
									{#if session.startedAt}
										<time datetime={session.startedAt}>{formatTime(session.startedAt)}</time>
									{/if}
									{#each session.messages as message (message.id)}
										{#if message.role === 'user'}
											<article class="user-message"><p>{message.content}</p></article>
										{:else if message.content}
											<AssistantMessageLoader content={message.content} />
										{:else if message.pending}
											<p class="formulating-status" data-text="Formulerar svar" role="status">
												Formulerar svar
											</p>
										{/if}
									{/each}
									{#if session.statusMessage}
										<p class="status-message" role="status">{session.statusMessage}</p>
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
								onStop={session.stopResponse}
							/>
						</div>
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
		color: color-mix(in srgb, var(--text) 58%, transparent);
		font-size: 1.25rem;
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

	.messages {
		padding: 1rem 1rem 1.5rem;
	}

	.message-content {
		display: flex;
		min-height: 100%;
		flex-direction: column;
		gap: 1.5rem;
	}

	time {
		align-self: center;
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		font-size: 0.85rem;
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

	:global(:root[data-theme='dark']) .close-tab {
		box-shadow: -0.2rem 0 0.65rem rgb(0 0 0 / 22%);
	}
</style>
