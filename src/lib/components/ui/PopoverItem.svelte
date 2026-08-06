<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Icon = Component<{ class?: string }>;
	type Props = Omit<HTMLButtonAttributes, 'children' | 'class'> & {
		children: Snippet;
		variant?: 'default' | 'destructive';
		leadingIcon?: Icon;
	};

	let {
		children,
		variant = 'default',
		leadingIcon: LeadingIcon,
		type = 'button',
		role = 'menuitem',
		...attributes
	}: Props = $props();
</script>

<button class={['item', variant]} {type} {role} {...attributes}>
	{#if LeadingIcon}<LeadingIcon />{/if}
	<span>{@render children()}</span>
</button>

<style>
	.item {
		--icon-size: var(--popover-item-icon-size);
		display: flex;
		width: 100%;
		min-height: var(--popover-item-min-height);
		align-items: center;
		box-sizing: border-box;
		gap: var(--popover-item-gap);
		border: 0;
		padding: var(--popover-item-padding-block) var(--popover-item-padding-inline);
		background: transparent;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-weight: 435;
		text-align: left;
		white-space: nowrap;
	}

	.item.default:hover {
		background: var(--surface-hover);
	}

	.item.default:active {
		background: var(--surface-active);
	}

	.item.destructive {
		color: var(--destructive-text);
	}

	.item.destructive:hover {
		background: var(--destructive-hover-background);
	}

	.item.destructive:active {
		background: color-mix(
			in srgb,
			var(--destructive-hover-background) 82%,
			var(--destructive-text)
		);
	}

	.item:focus-visible {
		outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
		outline-offset: -2px;
	}
</style>
