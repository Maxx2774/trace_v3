<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Icon = Component<{ class?: string }>;
	type Props = Omit<HTMLButtonAttributes, 'children'> & {
		children?: Snippet;
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'md' | 'lg';
		collapseLabel?: boolean;
		leadingIcon?: Icon;
	};

	let {
		children,
		variant = 'primary',
		size = 'md',
		collapseLabel = false,
		leadingIcon: LeadingIcon,
		...attributes
	}: Props = $props();
</script>

<button
	class={[
		'button',
		variant,
		size === 'lg' && 'lg',
		children ? 'with-label' : 'icon-only',
		collapseLabel && 'label-collapsed'
	]}
	{...attributes}
>
	{#if LeadingIcon}<LeadingIcon />{/if}
	{#if children}
		<span class="button-label"><span class="button-label-content">{@render children()}</span></span>
	{/if}
</button>

<style>
	.button {
		--icon-size: 1.4rem;
		display: inline-flex;
		height: 2.5rem;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		gap: 0.55rem;
		border-radius: 999px;
		padding: 0 0.85rem;
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 435;
		line-height: 1.2;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			color 140ms ease,
			gap 180ms ease,
			padding 180ms ease;
	}

	.button.lg {
		--icon-size: 1.575rem;
		height: 2.75rem;
		padding-inline: 1.1rem;
		font-size: 1.05rem;
	}

	.button-label {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		opacity: 1;
		transition:
			grid-template-columns 180ms ease,
			opacity 120ms ease;
	}

	.button-label-content {
		min-width: 0;
		overflow: hidden;
	}

	.button.label-collapsed {
		min-width: 2.5rem;
		gap: 0;
		padding-inline: 0;
	}

	.label-collapsed .button-label {
		grid-template-columns: minmax(0, 0fr);
		opacity: 0;
	}

	.button.icon-only {
		min-width: 2.5rem;
		width: 2.5rem;
		flex: 0 0 2.5rem;
		padding: 0;
	}

	.button.lg.label-collapsed,
	.button.lg.icon-only {
		min-width: 2.75rem;
	}

	.button.lg.icon-only {
		width: 2.75rem;
		flex-basis: 2.75rem;
	}

	.primary {
		border: 0;
		background: var(--button-background);
		color: var(--button-foreground);
	}

	.primary:hover {
		background: var(--button-hover-background);
	}

	.primary:active {
		background: var(--button-active-background);
	}

	.secondary {
		border: 1px solid var(--border);
		background: var(--popover-background);
		color: var(--text);
	}

	.secondary:hover {
		background: var(--surface-hover);
	}

	.secondary:active {
		background: var(--surface-active);
	}

	.ghost {
		border: 0;
		background: transparent;
		color: color-mix(in srgb, var(--text) 58%, transparent);
	}

	.ghost:hover {
		background: color-mix(in srgb, var(--text) 7%, transparent);
		color: var(--text);
	}

	.ghost[data-popover-open='true'] {
		background: color-mix(in srgb, var(--text) 7%, transparent);
		color: var(--text);
	}

	.ghost:active {
		background: color-mix(in srgb, var(--text) 12%, transparent);
	}

	.button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 45%, transparent);
		outline-offset: 2px;
	}
</style>
