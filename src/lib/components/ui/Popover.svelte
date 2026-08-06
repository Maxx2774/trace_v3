<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { on } from 'svelte/events';
	import { scale } from 'svelte/transition';

	type Placement = 'bottom-end' | 'bottom-start' | 'right-center' | 'top-end' | 'top-start';
	type Size = 'sm' | 'md';

	let {
		trigger,
		children,
		open: controlledOpen,
		placement = 'bottom-end',
		size = 'md',
		role,
		width,
		fullWidth = false,
		onOpenChange
	}: {
		trigger: Snippet<[boolean, () => void]>;
		children: Snippet<[() => void]>;
		open?: boolean;
		placement?: Placement;
		size?: Size;
		role?: 'menu' | 'dialog';
		width?: string;
		fullWidth?: boolean;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	let internalOpen = $state(false);
	let root = $state<HTMLDivElement | null>(null);
	let content = $state<HTMLDivElement | null>(null);
	let open = $derived(controlledOpen ?? internalOpen);
	let origin = $derived(
		placement === 'right-center'
			? 'left-center'
			: placement === 'top-start'
				? 'bottom-left'
				: placement === 'top-end'
					? 'bottom-right'
					: placement === 'bottom-start'
						? 'top-left'
						: 'top-right'
	);

	const viewportPadding = 12;
	const offset = 8;
	const portal: Attachment<HTMLElement> = (element) => {
		const anchor = document.createComment('popover-portal');
		const removeClickListener = on(element, 'click', handleContentClick);
		element.before(anchor);
		document.body.append(element);

		return () => {
			removeClickListener();
			element.remove();
			anchor.remove();
		};
	};

	$effect(() => {
		if (!open || !root || !content) return;

		content.style.visibility = 'hidden';
		updatePosition();
		const observer = new ResizeObserver(updatePosition);
		observer.observe(content);
		observer.observe(triggerElement());
		return () => observer.disconnect();
	});

	function setOpen(next: boolean) {
		if (controlledOpen === undefined) internalOpen = next;
		onOpenChange?.(next);
	}

	function close(restoreFocus = false) {
		setOpen(false);
		if (restoreFocus) triggerElement().focus();
	}

	function triggerElement(): HTMLElement {
		return root?.firstElementChild instanceof HTMLElement ? root.firstElementChild : root!;
	}

	function updatePosition() {
		if (!root || !content) return;

		const triggerRect = triggerElement().getBoundingClientRect();
		const contentRect = content.getBoundingClientRect();
		const maxLeft = window.innerWidth - viewportPadding - contentRect.width;
		const maxTop = window.innerHeight - viewportPadding - contentRect.height;
		const opensAbove = placement.startsWith('top');
		const alignsStart = placement.endsWith('start');
		let left = alignsStart ? triggerRect.left : triggerRect.right - contentRect.width;
		let top = opensAbove
			? triggerRect.top - offset - contentRect.height
			: triggerRect.bottom + offset;

		if (placement === 'right-center') {
			left = triggerRect.right + offset;
			top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2;
			if (left > maxLeft && triggerRect.left - offset - contentRect.width >= viewportPadding) {
				left = triggerRect.left - offset - contentRect.width;
			}
		} else if (opensAbove && top < viewportPadding && triggerRect.bottom + offset <= maxTop) {
			top = triggerRect.bottom + offset;
		} else if (
			!opensAbove &&
			top > maxTop &&
			triggerRect.top - offset - contentRect.height >= viewportPadding
		) {
			top = triggerRect.top - offset - contentRect.height;
		}

		content.style.left = `${Math.round(clamp(left, viewportPadding, maxLeft))}px`;
		content.style.top = `${Math.round(clamp(top, viewportPadding, maxTop))}px`;
		content.style.visibility = 'visible';
	}

	function clamp(value: number, min: number, max: number) {
		return max < min ? min : Math.min(Math.max(value, min), max);
	}

	function handlePointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (open && !root?.contains(target) && !content?.contains(target)) close();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopImmediatePropagation();
			close(true);
		}
	}

	function handleContentClick(event: MouseEvent) {
		const target = event.target;
		if (target instanceof Element && target.closest('a, button, [role="menuitem"]')) close();
	}
</script>

<svelte:window
	onpointerdown={handlePointerDown}
	onkeydown={handleKeydown}
	onresize={updatePosition}
	onscroll={updatePosition}
/>

<div bind:this={root} class:full-width={fullWidth} class="root">
	{@render trigger(open, () => setOpen(!open))}
	{#if open}
		<div
			bind:this={content}
			class={['content', origin, size]}
			style:width
			style="visibility: hidden;"
			{role}
			data-popover-content
			{@attach portal}
			transition:scale={{ duration: 140, start: 0.96, opacity: 0 }}
		>
			{@render children(close)}
		</div>
	{/if}
</div>

<style>
	.root {
		position: relative;
		display: inline-flex;
	}

	.root.full-width {
		display: block;
		width: 100%;
	}

	.content {
		position: fixed;
		z-index: 200;
		min-width: 9rem;
		overflow: hidden;
		box-sizing: border-box;
		border: 0;
		border-radius: 0.8rem;
		padding: 0;
		background: var(--popover-background);
		box-shadow: 0 1rem 2.5rem rgb(23 32 51 / 12%);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-weight: 435;
	}

	.content.sm {
		--popover-item-min-height: 2.35rem;
		--popover-item-padding-block: 0.45rem;
		--popover-item-padding-inline: 0.7rem;
		--popover-item-icon-size: 1.1rem;
		--popover-item-gap: 0.55rem;
		border-radius: 0.5rem;
		font-size: 0.9rem;
	}

	.content.md {
		--popover-item-min-height: 2.7739rem;
		--popover-item-padding-block: 0.6rem;
		--popover-item-padding-inline: 0.85rem;
		--popover-item-icon-size: 1.54rem;
		--popover-item-gap: 0.65rem;
		font-size: 1.1rem;
	}

	.left-center {
		transform-origin: left center;
	}
	.top-right {
		transform-origin: top right;
	}
	.top-left {
		transform-origin: top left;
	}
	.bottom-right {
		transform-origin: bottom right;
	}
	.bottom-left {
		transform-origin: bottom left;
	}
</style>
