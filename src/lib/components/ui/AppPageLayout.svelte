<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		header,
		children,
		mobileViewportLocked = false
	}: {
		header: Snippet;
		children?: Snippet;
		mobileViewportLocked?: boolean;
	} = $props();
</script>

<main class={['app-page', mobileViewportLocked && 'mobile-viewport-locked']}>
	<header class="app-page-header">{@render header()}</header>
	{#if children}
		<div class="app-page-content">{@render children()}</div>
	{/if}
</main>

<style>
	.app-page {
		display: flex;
		position: relative;
		width: min(100% - 6rem, 60rem);
		min-height: 100vh;
		flex-direction: column;
		justify-content: flex-start;
		box-sizing: border-box;
		margin: 0 auto;
		padding: 1rem 0 4rem;
	}

	.app-page-header {
		display: flex;
		position: absolute;
		top: 4.75rem;
		right: 0;
		left: 0;
		width: min(100%, 44rem);
		flex-direction: column;
		align-items: flex-start;
		margin-inline: auto;
	}

	.app-page-content {
		width: min(100%, 44rem);
		margin-inline: auto;
	}

	@media (max-width: 640px) {
		.app-page {
			width: min(100% - 4rem, 60rem);
		}

		.app-page.mobile-viewport-locked {
			height: 100dvh;
			min-height: 0;
			overflow: hidden;
			padding: 0;
		}
	}
</style>
