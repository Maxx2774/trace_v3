<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Wordmark from '$lib/components/brand/Wordmark.svelte';
	import ChevronRightIcon from '$lib/components/icons/ChevronRightIcon.svelte';
	import OverviewActiveIcon from '$lib/components/icons/OverviewActiveIcon.svelte';
	import OverviewIcon from '$lib/components/icons/OverviewIcon.svelte';
	import AccountMenu from '$lib/features/auth/AccountMenu.svelte';
	import { getPrimaryNavigationUrl } from '$lib/features/chat/chat-url';

	let {
		open,
		chatOpen,
		onToggle,
		onClose,
		displayName,
		overviewActive
	}: {
		open: boolean;
		chatOpen: boolean;
		onToggle: () => void;
		onClose: () => void;
		displayName: string;
		overviewActive: boolean;
	} = $props();
	let overviewHref = $derived(getPrimaryNavigationUrl(resolve('/'), page.url));
</script>

<button
	class={['sidebar-tab', open && 'open', chatOpen && 'chat-open']}
	type="button"
	aria-label={open ? 'Stäng sidofält' : 'Öppna sidofält'}
	aria-controls="app-sidebar"
	aria-expanded={open}
	onclick={onToggle}
>
	<span class={['tab-icon', open && 'open']}><ChevronRightIcon /></span>
</button>

<button
	class={['backdrop', open && 'visible']}
	type="button"
	aria-label="Stäng sidofält"
	tabindex="-1"
	onclick={onClose}
></button>

<aside
	id="app-sidebar"
	class={['sidebar', open && 'open']}
	aria-label="Huvudnavigation"
	aria-hidden={!open}
	inert={!open}
>
	<div class="sidebar-wordmark"><Wordmark /></div>

	<nav aria-label="Trace">
		<a
			class:active={overviewActive}
			href={resolve(overviewHref)}
			aria-current={overviewActive ? 'page' : undefined}
		>
			{#if overviewActive}<OverviewActiveIcon />{:else}<OverviewIcon />{/if}
			<span>Översikt</span>
		</a>
	</nav>
	<div class="spacer"></div>
	<div class="account"><AccountMenu {displayName} /></div>
</aside>

<style>
	.sidebar-tab {
		--icon-size: 1.1rem;
		position: fixed;
		top: 90%;
		left: 0;
		z-index: 170;
		display: grid;
		width: calc(1.5rem + 1px);
		height: 3rem;
		place-items: center;
		box-sizing: border-box;
		border: 1px solid var(--border);
		border-left: 0;
		border-radius: 0 0.5rem 0.5rem 0;
		padding: 0;
		background: var(--background);
		box-shadow: 0.2rem 0 0.65rem rgb(23 32 51 / 8%);
		color: color-mix(in srgb, var(--text) 58%, transparent);
		cursor: pointer;
		transform: translateY(-50%);
		transition:
			color 160ms ease,
			left 280ms var(--sidebar-easing);
	}

	.sidebar-tab.open {
		left: var(--sidebar-width);
	}

	.sidebar-tab:hover,
	.sidebar-tab:active {
		color: var(--text);
	}

	.tab-icon {
		display: grid;
		place-items: center;
		transition: transform 280ms var(--sidebar-easing);
	}

	.tab-icon.open {
		transform: rotate(180deg);
	}

	.sidebar-tab:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 42%, transparent);
		outline-offset: 2px;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 150;
		display: none;
		border: 0;
		padding: 0;
		background: rgb(0 0 0 / 24%);
		opacity: 0;
		pointer-events: none;
		transition: opacity 220ms ease;
	}

	.sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 160;
		display: flex;
		width: var(--sidebar-width);
		flex-direction: column;
		box-sizing: border-box;
		border-right: 1px solid color-mix(in srgb, var(--text) 5%, transparent);
		padding: 1rem 0.75rem 0.75rem;
		background: var(--background);
		transform: translate3d(-100%, 0, 0);
		transition: transform 280ms var(--sidebar-easing);
		will-change: transform;
	}

	.sidebar.open {
		transform: translate3d(0, 0, 0);
	}

	.sidebar-wordmark {
		display: flex;
		height: 2.5rem;
		align-items: center;
		padding-left: 0.9rem;
	}

	nav {
		display: grid;
		gap: 0.25rem;
		margin-top: 1.25rem;
	}

	nav a {
		--icon-size: 1.5rem;
		display: flex;
		height: 2.5rem;
		min-width: 0;
		align-items: center;
		box-sizing: border-box;
		gap: 0.7rem;
		margin-inline: 0.25rem;
		border-radius: 0.7rem;
		padding: 0.65rem;
		color: var(--text);
		font-size: 1.1rem;
		font-weight: 400;
		text-decoration: none;
		transition: background 150ms ease;
	}

	nav a.active,
	nav a:hover {
		background: var(--surface-hover);
	}

	nav a:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 45%, transparent);
		outline-offset: 2px;
	}

	.spacer {
		flex: 1 1 auto;
	}

	.account {
		display: block;
		width: 100%;
		margin-top: 0.75rem;
	}

	@media (max-width: 1199px) {
		.sidebar-tab.open {
			left: min(var(--sidebar-width), calc(100vw - 3rem));
		}

		.sidebar {
			width: min(var(--sidebar-width), calc(100vw - 3rem));
		}

		.backdrop {
			display: block;
		}

		.backdrop.visible {
			opacity: 1;
			pointer-events: auto;
		}
	}

	@media (max-width: 767px) {
		.sidebar-tab.chat-open {
			display: none;
		}
	}

	:global(:root[data-theme='dark']) .sidebar-tab {
		border-color: var(--surface-border);
		background: var(--popover-background);
		box-shadow: 0.2rem 0 0.75rem rgb(0 0 0 / 38%);
		color: color-mix(in srgb, var(--text) 68%, transparent);
	}

	:global(:root[data-theme='dark']) .sidebar {
		border-right-color: color-mix(in srgb, var(--surface-border) 75%, transparent);
	}
</style>
