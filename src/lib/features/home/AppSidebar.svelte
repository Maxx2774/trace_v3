<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import JournalActiveIcon from '$lib/components/icons/JournalActiveIcon.svelte';
	import JournalIcon from '$lib/components/icons/JournalIcon.svelte';
	import OverviewActiveIcon from '$lib/components/icons/OverviewActiveIcon.svelte';
	import OverviewIcon from '$lib/components/icons/OverviewIcon.svelte';
	import PanelLeftIcon from '$lib/components/icons/PanelLeftIcon.svelte';
	import AccountMenu from '$lib/features/auth/AccountMenu.svelte';
	import { getPrimaryNavigationUrl } from '$lib/features/chat/chat-url';

	let {
		open,
		chatOpen,
		onToggle,
		onClose,
		displayName,
		overviewActive,
		journalActive
	}: {
		open: boolean;
		chatOpen: boolean;
		onToggle: () => void;
		onClose: () => void;
		displayName: string;
		overviewActive: boolean;
		journalActive: boolean;
	} = $props();
	let overviewHref = $derived(getPrimaryNavigationUrl(resolve('/'), page.url));
	let journalHref = $derived(getPrimaryNavigationUrl(resolve('/journal'), page.url));
</script>

<button
	class={['sidebar-toggle', 'closed-toggle', open && 'sidebar-open', chatOpen && 'chat-open']}
	type="button"
	aria-label="Öppna sidofält"
	aria-controls="app-sidebar"
	aria-expanded="false"
	aria-hidden={open}
	tabindex={open ? -1 : undefined}
	onclick={onToggle}
>
	<PanelLeftIcon />
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
	<div class="sidebar-header">
		<button
			class="sidebar-toggle open-toggle"
			type="button"
			aria-label="Stäng sidofält"
			aria-controls="app-sidebar"
			aria-expanded="true"
			onclick={onToggle}
		>
			<PanelLeftIcon />
		</button>
	</div>

	<nav aria-label="Trace">
		<a
			class:active={overviewActive}
			href={resolve(overviewHref)}
			aria-current={overviewActive ? 'page' : undefined}
		>
			{#if overviewActive}<OverviewActiveIcon />{:else}<OverviewIcon />{/if}
			<span>Översikt</span>
		</a>
		<a
			class:active={journalActive}
			href={resolve(journalHref)}
			aria-current={journalActive ? 'page' : undefined}
		>
			{#if journalActive}<JournalActiveIcon />{:else}<JournalIcon />{/if}
			<span>Journal</span>
		</a>
	</nav>
	<div class="spacer"></div>
	<div class="account"><AccountMenu {displayName} /></div>
</aside>

<style>
	.sidebar-toggle {
		--icon-size: 1.5rem;
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		box-sizing: border-box;
		border: 0;
		border-radius: 0.7rem;
		padding: 0;
		background: transparent;
		color: color-mix(in srgb, var(--text) 58%, transparent);
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease,
			opacity 120ms ease;
	}

	.sidebar-toggle:hover,
	.sidebar-toggle:active {
		background: var(--surface-hover);
		color: var(--text);
	}

	.sidebar-toggle:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 42%, transparent);
		outline-offset: 2px;
	}

	.closed-toggle {
		position: fixed;
		top: 1rem;
		left: 1rem;
		z-index: 170;
	}

	.closed-toggle.sidebar-open {
		opacity: 0;
		pointer-events: none;
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

	.sidebar-header {
		position: relative;
		height: 2.5rem;
		flex: 0 0 2.5rem;
	}

	.open-toggle {
		position: absolute;
		top: 0;
		left: 0.25rem;
	}

	nav {
		display: grid;
		gap: 0.25rem;
		margin-top: 1.25rem;
	}

	nav a {
		--icon-size: 1.25rem;
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
		font-size: 1rem;
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
		.closed-toggle {
			z-index: 210;
		}

		.sidebar {
			z-index: 200;
			width: min(var(--sidebar-width), calc(100vw - 3rem));
		}

		.backdrop {
			z-index: 190;
			display: block;
		}

		.backdrop.visible {
			opacity: 1;
			pointer-events: auto;
		}
	}

	@media (max-width: 767px) {
		.closed-toggle.chat-open {
			display: none;
		}
	}

	:global(:root[data-theme='dark']) .sidebar {
		border-right-color: color-mix(in srgb, var(--surface-border) 75%, transparent);
	}
</style>
