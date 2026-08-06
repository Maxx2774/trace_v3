<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open,
		onClose,
		children,
		label
	}: { open: boolean; onClose: () => void; children: Snippet; label: string } = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class={['sheet', open && 'open']} aria-label={label}>
	<button class="backdrop" type="button" aria-label={`Stäng ${label}`} onclick={onClose}></button>
	{@render children()}
</div>

<style>
	.sheet {
		position: fixed;
		inset: 0;
		z-index: 180;
		visibility: hidden;
		pointer-events: none;
		transition: visibility 0s linear 220ms;
	}

	.sheet.open {
		visibility: visible;
		transition-delay: 0s;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 0;
		border: 0;
		padding: 0;
		background: var(--overlay-backdrop);
		cursor: default;
		opacity: 0;
		pointer-events: none;
		transition: opacity 180ms ease;
	}

	.sheet.open .backdrop {
		opacity: 1;
		pointer-events: auto;
	}

	@media (min-width: 960px) {
		.sheet {
			visibility: visible;
			transition: none;
		}

		.backdrop {
			display: none;
		}
	}
</style>
