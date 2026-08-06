<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import ConversationSheet from '$lib/features/chat/components/ConversationSheet.svelte';
	import AppSidebar from '$lib/features/home/AppSidebar.svelte';
	import { onMount, untrack } from 'svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let sidebarOpen = $state(untrack(() => data.sidebarOpen));
	let chatOpen = $state(false);
	let navigationIsOverlay = $state(false);
	let chatAvailable = $derived(page.url.pathname !== '/settings');

	function setSidebar(open: boolean) {
		sidebarOpen = open;
		if (open && navigationIsOverlay) chatOpen = false;
		document.cookie = `trace-sidebar-open=${open ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`;
	}

	function setChat(open: boolean) {
		chatOpen = open;
		if (open && navigationIsOverlay && sidebarOpen) setSidebar(false);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && sidebarOpen) setSidebar(false);
	}

	onMount(() => {
		const navigationOverlayQuery = window.matchMedia('(max-width: 1199px)');
		const syncNavigationLayout = () => {
			navigationIsOverlay = navigationOverlayQuery.matches;
			if (navigationIsOverlay && sidebarOpen) setSidebar(false);
		};

		syncNavigationLayout();
		navigationOverlayQuery.addEventListener('change', syncNavigationLayout);

		return () => navigationOverlayQuery.removeEventListener('change', syncNavigationLayout);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class={['app-shell', sidebarOpen && 'sidebar-open', chatAvailable && 'chat-available']}>
	<AppSidebar
		open={sidebarOpen}
		chatOpen={chatAvailable && chatOpen}
		onToggle={() => setSidebar(!sidebarOpen)}
		onClose={() => setSidebar(false)}
		displayName={data.displayName}
		overviewActive={page.url.pathname === '/'}
	/>

	<div class="app-content">
		{@render children()}

		{#if chatAvailable && !chatOpen}
			<div class="ask-actions">
				<Button type="button" size="lg" onclick={() => setChat(true)}>Fråga Trace</Button>
			</div>
		{/if}
	</div>

	<div class="chat-region" hidden={!chatAvailable}>
		<ConversationSheet
			open={chatOpen}
			initialConversationPage={data.initialConversationPage}
			onClose={() => setChat(false)}
		/>
	</div>
</div>

<style>
	.app-shell,
	.app-content {
		min-height: 100vh;
	}

	.app-shell {
		background: var(--background);
	}

	.app-content {
		position: relative;
		transition: margin-left 280ms var(--sidebar-easing);
	}

	.ask-actions {
		display: none;
		position: absolute;
		right: max(1rem, calc((100% - 60rem) / 2));
		bottom: max(1.5rem, env(safe-area-inset-bottom));
		z-index: 110;
		align-items: center;
		justify-content: center;
		max-width: calc(100vw - 2rem);
	}

	@media (min-width: 1200px) {
		.sidebar-open .app-content {
			margin-left: var(--sidebar-width);
		}
	}

	@media (min-width: 960px) {
		.chat-available .app-content {
			margin-right: var(--chat-panel-width);
		}
	}

	@media (max-width: 959px) {
		.ask-actions {
			display: inline-flex;
		}
	}

	@media (max-width: 640px) {
		.ask-actions {
			position: fixed;
			right: max(0.5rem, env(safe-area-inset-right));
			bottom: max(0.75rem, env(safe-area-inset-bottom));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.app-content {
			transition-duration: 0.01ms;
		}
	}
</style>
