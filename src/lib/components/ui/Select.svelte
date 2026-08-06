<script lang="ts" generics="T extends string">
	import { tick } from 'svelte';
	import ChevronRightIcon from '$lib/components/icons/ChevronRightIcon.svelte';
	import Popover from './Popover.svelte';

	type SelectOption<T extends string> = {
		value: T;
		label: string;
	};

	let {
		value,
		options,
		placeholder,
		label,
		disabled = false,
		onValueChange
	}: {
		value: T | null;
		options: ReadonlyArray<SelectOption<T>>;
		placeholder: string;
		label: string;
		disabled?: boolean;
		onValueChange: (value: T) => void;
	} = $props();

	const id = $props.id();
	let triggerElement = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	let activeIndex = $state(-1);
	let typeahead = '';
	let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
	let selectedIndex = $derived(options.findIndex((option) => option.value === value));
	let displayLabel = $derived(selectedIndex >= 0 ? options[selectedIndex].label : placeholder);
	let activeOptionId = $derived(
		open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
	);

	function setOpen(next: boolean) {
		if (disabled && next) return;
		open = next;
		if (next) {
			activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
			void revealActiveOption();
		} else {
			clearTypeahead();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled || options.length === 0) return;

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) {
				setOpen(true);
				if (selectedIndex < 0) activeIndex = event.key === 'ArrowDown' ? 0 : options.length - 1;
			} else {
				moveActive(event.key === 'ArrowDown' ? 1 : -1);
			}
			return;
		}

		if (event.key === 'Home' || event.key === 'End') {
			if (!open) return;
			event.preventDefault();
			activeIndex = event.key === 'Home' ? 0 : options.length - 1;
			void revealActiveOption();
			return;
		}

		if ((event.key === 'Enter' || event.key === ' ') && open) {
			event.preventDefault();
			selectIndex(activeIndex);
			return;
		}

		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			return;
		}

		if (event.key === 'Tab' && open) {
			setOpen(false);
			return;
		}

		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			if (!open) setOpen(true);
			handleTypeahead(event.key);
		}
	}

	function moveActive(delta: number) {
		activeIndex = (activeIndex + delta + options.length) % options.length;
		void revealActiveOption();
	}

	function handleTypeahead(character: string) {
		if (typeaheadTimer) clearTimeout(typeaheadTimer);
		typeahead += character.toLocaleLowerCase('sv-SE');
		const start = Math.max(activeIndex, -1);
		for (let offset = 1; offset <= options.length; offset += 1) {
			const index = (start + offset) % options.length;
			if (options[index].label.toLocaleLowerCase('sv-SE').startsWith(typeahead)) {
				activeIndex = index;
				void revealActiveOption();
				break;
			}
		}
		typeaheadTimer = setTimeout(clearTypeahead, 500);
	}

	function clearTypeahead() {
		if (typeaheadTimer) clearTimeout(typeaheadTimer);
		typeaheadTimer = undefined;
		typeahead = '';
	}

	function selectIndex(index: number) {
		const option = options[index];
		if (!option) return;
		onValueChange(option.value);
		setOpen(false);
		void tick().then(() => triggerElement?.focus());
	}

	async function revealActiveOption() {
		await tick();
		if (activeIndex < 0) return;
		document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
	}
</script>

<Popover {open} onOpenChange={setOpen} placement="bottom-start" size="sm" width="max-content">
	{#snippet trigger(popoverOpen, toggle)}
		<button
			bind:this={triggerElement}
			class="select-trigger"
			type="button"
			role="combobox"
			aria-label={label}
			aria-expanded={popoverOpen}
			aria-controls={`${id}-listbox`}
			aria-haspopup="listbox"
			aria-activedescendant={activeOptionId}
			{disabled}
			onclick={toggle}
			onkeydown={handleKeydown}
		>
			<span class:placeholder={value === null}>{displayLabel}</span>
			<span class="chevron"><ChevronRightIcon /></span>
		</button>
	{/snippet}

	{#snippet children(close)}
		<div id={`${id}-listbox`} class="options" role="listbox" aria-label={label}>
			{#each options as option, index (option.value)}
				<button
					id={`${id}-option-${index}`}
					class:active={index === activeIndex}
					type="button"
					role="option"
					tabindex="-1"
					aria-selected={option.value === value}
					onpointerdown={(event) => event.preventDefault()}
					onmousemove={() => (activeIndex = index)}
					onclick={() => {
						selectIndex(index);
						close(true);
					}}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/snippet}
</Popover>

<style>
	.select-trigger {
		display: inline-flex;
		min-height: 2rem;
		align-items: center;
		gap: 0.28rem;
		border: 0;
		border-radius: 0.4rem;
		padding: 0.2rem 0.28rem;
		background: transparent;
		color: var(--text);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: inherit;
		font-weight: 550;
		cursor: pointer;
	}

	.select-trigger:hover,
	.select-trigger[aria-expanded='true'] {
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}

	.select-trigger:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--text) 38%, transparent);
		outline-offset: 1px;
	}

	.select-trigger:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.placeholder {
		color: var(--muted);
		font-weight: 435;
	}

	.chevron {
		--icon-size: 1rem;
		display: inline-flex;
		transform: rotate(90deg);
	}

	.options {
		min-width: 10rem;
		max-height: min(18rem, calc(100vh - 2rem));
		overflow-y: auto;
		padding: 0.25rem;
	}

	.options button {
		display: flex;
		width: 100%;
		min-height: 2.35rem;
		align-items: center;
		border: 0;
		border-radius: 0.38rem;
		padding: 0.45rem 0.7rem;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 435;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}

	.options button.active {
		background: var(--surface-hover);
	}

	.options button[aria-selected='true'] {
		font-weight: 500;
	}
</style>
