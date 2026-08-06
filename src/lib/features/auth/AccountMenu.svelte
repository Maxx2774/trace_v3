<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import LogOutIcon from '$lib/components/icons/LogOutIcon.svelte';
	import PersonIcon from '$lib/components/icons/PersonIcon.svelte';
	import SettingsIcon from '$lib/components/icons/SettingsIcon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';

	let { displayName }: { displayName: string } = $props();
</script>

<Popover placement="top-start" size="md" role="menu" width="15.5rem" fullWidth>
	{#snippet trigger(open, toggle)}
		<button
			class={['account-trigger', open && 'open']}
			type="button"
			onclick={toggle}
			aria-label="Användarmeny"
			aria-haspopup="menu"
			aria-expanded={open}
		>
			<span class="avatar"><PersonIcon /></span>
			<strong>{displayName}</strong>
		</button>
	{/snippet}

	<a class="menu-item" href={resolve('/settings')} role="menuitem">
		<SettingsIcon />
		<span>Inställningar</span>
	</a>
	<form method="POST" action={resolve('/auth/logout')} use:enhance>
		<button class="menu-item" type="submit" role="menuitem">
			<LogOutIcon />
			<span>Logga ut</span>
		</button>
	</form>
</Popover>

<style>
	.account-trigger {
		display: grid;
		width: calc(100% - 0.5rem);
		height: 2.5rem;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.7rem;
		box-sizing: border-box;
		margin-inline: 0.25rem;
		border: 0;
		border-radius: 0.8rem;
		padding: 0 0.65rem;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		transition: background 150ms ease;
	}

	.account-trigger:hover,
	.account-trigger.open {
		background: var(--surface-hover);
	}

	.account-trigger:focus-visible,
	.menu-item:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 45%, transparent);
		outline-offset: 2px;
	}

	.avatar {
		--icon-size: 1.5rem;
		display: inline-grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		flex: 0 0 auto;
	}

	strong {
		overflow: hidden;
		font-size: 1.1rem;
		font-weight: 400;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	form {
		margin: 0;
	}

	.menu-item {
		--icon-size: var(--popover-item-icon-size);
		display: flex;
		width: 100%;
		min-height: var(--popover-item-min-height);
		align-items: center;
		gap: 0.65rem;
		box-sizing: border-box;
		border: 0;
		padding: var(--popover-item-padding-block) var(--popover-item-padding-inline);
		background: transparent;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: inherit;
		font-weight: inherit;
		text-align: left;
		text-decoration: none;
	}

	.menu-item:hover {
		background: var(--surface-hover);
	}

	.menu-item:active {
		background: var(--surface-active);
	}
</style>
