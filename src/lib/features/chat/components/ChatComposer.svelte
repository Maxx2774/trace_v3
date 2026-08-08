<script lang="ts">
	import AddIcon from '$lib/components/icons/AddIcon.svelte';
	import ArrowIcon from '$lib/components/icons/ArrowIcon.svelte';
	import { tick } from 'svelte';

	let {
		autoFocus = false,
		disabled = false,
		onDraftChange,
		onMultilineChange,
		onSubmit,
		singleRow = false,
		streaming = false,
		stoppable,
		onStop
	}: {
		autoFocus?: boolean;
		disabled?: boolean;
		onDraftChange?: (hasDraft: boolean) => void;
		onMultilineChange?: (multiline: boolean) => void;
		onSubmit: (message: string) => void;
		singleRow?: boolean;
		streaming?: boolean;
		stoppable?: boolean;
		onStop?: () => void;
	} = $props();

	let message = $state('');
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let textareaHeight = $state(30);
	let hasDraft = $state(false);
	let multiline = $state(false);
	let canSubmit = $derived(message.trim().length > 0 && !disabled && !streaming);
	let showStop = $derived(streaming && (stoppable ?? true));
	let limitReached = $derived(message.length >= 5_000);
	const singleLineHeight = 30;
	const singleLineTolerance = 12;
	const multilineMinHeight = 56;
	const defaultMaxTextareaHeight = 120;
	const singleRowMaxTextareaHeight = 176;

	$effect(() => {
		if (!autoFocus || disabled || !textarea || window.matchMedia('(max-width: 959px)').matches) {
			return;
		}

		const target = textarea;
		void tick().then(() => target.focus());
	});

	function resize() {
		if (!textarea) return;
		const nextHasDraft = textarea.value.length > 0;
		if (nextHasDraft !== hasDraft) {
			hasDraft = nextHasDraft;
			onDraftChange?.(nextHasDraft);
		}
		textarea.style.height = 'auto';
		const contentHeight = textarea.scrollHeight;
		const wasMultiline = multiline;
		const maxTextareaHeight = singleRow ? singleRowMaxTextareaHeight : defaultMaxTextareaHeight;
		const contentWraps = contentHeight > singleLineHeight + singleLineTolerance;
		const nextMultiline = singleRow
			? textarea.value.length > 0 && (multiline || contentWraps)
			: contentWraps;
		const nextHeight = nextMultiline
			? Math.min(
					Math.max(contentHeight, singleRow ? multilineMinHeight : singleLineHeight),
					maxTextareaHeight
				)
			: singleLineHeight;
		multiline = nextMultiline;
		textareaHeight = nextHeight;
		if (nextMultiline !== wasMultiline) {
			onMultilineChange?.(nextMultiline);
		}
		textarea.style.height = `${textareaHeight}px`;
		textarea.style.overflowY = contentHeight > maxTextareaHeight ? 'auto' : 'hidden';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const value = message.trim();
		if (!value || disabled || streaming || value.length > 5_000) return;
		onSubmit(value);
		message = '';
		if (hasDraft) {
			hasDraft = false;
			onDraftChange?.(false);
		}
		const wasMultiline = multiline;
		multiline = false;
		textareaHeight = singleLineHeight;
		if (wasMultiline) onMultilineChange?.(false);
		await tick();
		if (textarea) {
			textarea.style.height = `${singleLineHeight}px`;
			textarea.style.overflowY = 'hidden';
			textarea.scrollTop = 0;
			textarea.scrollLeft = 0;
		}
	}

	function stop() {
		if (!showStop) return;
		onStop?.();
	}

	function submitOnEnter(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		if (canSubmit) event.currentTarget.form?.requestSubmit();
	}
</script>

<form class={{ multiline, 'single-row': singleRow }} onsubmit={submit}>
	<button
		class="focus-target"
		type="button"
		tabindex="-1"
		aria-label="Fokusera meddelandefältet"
		{disabled}
		onclick={() => textarea?.focus()}
	></button>
	<button class="add-button" type="button" aria-label="Lägg till">
		<AddIcon />
	</button>
	<label class="sr-only" for="conversation-message">Meddelande till Trace</label>
	{#if message.length === 0}
		<span class="visual-placeholder" aria-hidden="true">Skriv till Trace</span>
	{/if}
	<textarea
		bind:this={textarea}
		bind:value={message}
		id="conversation-message"
		name="message"
		rows="1"
		maxlength="5000"
		aria-placeholder="Skriv till Trace"
		aria-describedby={limitReached ? 'conversation-message-limit' : undefined}
		disabled={disabled || streaming}
		oninput={resize}
		onkeydown={submitOnEnter}></textarea>

	{#if showStop}
		<button class="submit-button stop-button" type="button" aria-label="Avbryt svar" onclick={stop}>
			<span class="stop-icon" aria-hidden="true"></span>
		</button>
	{:else}
		<button class="submit-button" type="submit" aria-label="Skicka" disabled={!canSubmit}>
			<ArrowIcon />
		</button>
	{/if}

	{#if limitReached}
		<p id="conversation-message-limit" class="limit-message" aria-live="polite">
			Meddelandet får vara högst 5 000 tecken.
		</p>
	{/if}
</form>

<style>
	form {
		display: grid;
		position: relative;
		width: 100%;
		height: auto;
		min-height: var(--composer-min-height, 9rem);
		max-height: 12rem;
		align-items: start;
		column-gap: 0.75rem;
		row-gap: 0.75rem;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: minmax(1.875rem, auto) 2.5rem;
		box-sizing: border-box;
		border: 0;
		border-radius: 0;
		padding: 1.05rem 0.65rem 0.65rem;
		background: transparent;
		box-shadow: none;
		cursor: text;
	}

	form.single-row {
		max-height: 15.5rem;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: minmax(2.5rem, auto);
		padding: 0.35rem 0.45rem;
	}

	form.single-row.multiline {
		grid-template-rows: minmax(1.875rem, auto) 2.5rem;
		row-gap: 0.4rem;
		padding: 0.55rem 0.45rem 0.4rem;
	}

	.focus-target {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: text;
	}

	textarea {
		position: relative;
		z-index: 2;
		width: calc(100% + 0.65rem);
		height: 1.875rem;
		max-height: 7.5rem;
		grid-column: 1 / -1;
		grid-row: 1;
		box-sizing: border-box;
		margin-right: -0.65rem;
		border: 0;
		padding: 0 0.75rem 0 0.55rem;
		outline: 0;
		resize: none;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 1.1rem;
		font-weight: 400;
		line-height: 1.5;
		overflow-x: hidden;
		scrollbar-color: color-mix(in srgb, var(--text) 24%, transparent) transparent;
		scrollbar-width: thin;
	}

	form.single-row textarea {
		width: 100%;
		max-height: 11rem;
		align-self: center;
		grid-column: 1;
		grid-row: 1;
		margin-right: 0;
		padding-block: 0.1125rem;
		padding-right: 0.5rem;
		padding-left: calc(2.65rem - 1px);
	}

	form.single-row.multiline textarea {
		width: 100%;
		align-self: start;
		grid-column: 1 / -1;
		grid-row: 1;
		margin-right: 0;
		padding-left: 0.7rem;
	}

	.visual-placeholder {
		position: absolute;
		top: 1.05rem;
		left: 1.2rem;
		z-index: 1;
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		font-size: 1.1rem;
		font-weight: 400;
		line-height: 1.5;
		pointer-events: none;
	}

	form.single-row .visual-placeholder {
		top: 50%;
		left: calc(3.1rem - 1px);
		transform: translateY(-50%);
	}

	.add-button {
		--icon-size: 1.2rem;

		position: relative;
		z-index: 3;
		display: inline-flex;
		width: 2.5rem;
		height: 2.5rem;
		align-items: center;
		justify-content: center;
		align-self: end;
		grid-column: 1;
		grid-row: 2;
		justify-self: start;
		box-sizing: border-box;
		border: 0;
		border-radius: 999px;
		padding: 0;
		background: transparent;
		color: color-mix(in srgb, var(--muted) 78%, transparent);
		cursor: pointer;
		transition:
			background 140ms ease,
			color 140ms ease;
	}

	form.single-row .add-button {
		position: absolute;
		top: calc(0.35rem + 2px);
		left: calc(0.45rem + 1.8px);
		width: 2.25rem;
		height: 2.25rem;
		align-self: auto;
		grid-column: auto;
		grid-row: auto;
		justify-self: auto;
	}

	.add-button:hover,
	.add-button:focus-visible,
	.add-button:active {
		background: color-mix(in srgb, var(--text) 5%, transparent);
		color: var(--text);
	}

	.submit-button {
		position: relative;
		z-index: 1;
		display: inline-flex;
		width: 2.5rem;
		height: 2.5rem;
		align-items: center;
		justify-content: center;
		align-self: end;
		box-sizing: border-box;
		border: 0;
		border-radius: 999px;
		padding: 0;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.submit-button {
		--icon-size: 1.25rem;
		grid-column: 2;
		grid-row: 2;
		justify-self: end;
		background: var(--accent);
		color: var(--button-foreground);
	}

	form.single-row .submit-button {
		--icon-size: 1.125rem;

		align-self: center;
		width: 2.25rem;
		height: 2.25rem;
		grid-column: 2;
		grid-row: 1;
	}

	form.single-row.multiline .submit-button {
		grid-row: 2;
	}

	form.single-row.multiline .add-button {
		top: auto;
		bottom: calc(0.4rem + 2px);
	}

	.submit-button:hover {
		background: color-mix(in oklch, var(--accent) 90%, var(--text));
	}

	.submit-button:active {
		background: color-mix(in oklch, var(--accent) 82%, var(--text));
	}

	.submit-button:disabled {
		cursor: default;
		opacity: 0.42;
	}

	.stop-button {
		background: var(--text);
	}

	.stop-icon {
		display: block;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 0.12rem;
		background: var(--chat-panel-background);
	}

	.limit-message {
		position: absolute;
		left: 1.2rem;
		bottom: 0.75rem;
		z-index: 2;
		max-width: calc(100% - 4.75rem);
		margin: 0;
		color: var(--destructive-text);
		font-size: 0.78rem;
		line-height: 1.25;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
		padding: 0;
		margin: -1px;
	}
</style>
