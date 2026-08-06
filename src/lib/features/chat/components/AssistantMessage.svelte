<script lang="ts">
	import { renderAssistantMarkdown } from '../markdown';

	let { content }: { content: string } = $props();
	let renderedContent = $derived(renderAssistantMarkdown(content));
</script>

<article class="assistant-message">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it escapes raw HTML and rejects unsafe link protocols. -->
	<div class="markdown">{@html renderedContent}</div>
</article>

<style>
	.assistant-message {
		max-width: min(80%, 32rem);
		align-self: flex-start;
		color: var(--text);
		font-size: 1.1rem;
		line-height: 1.45;
		word-break: break-word;
	}

	.markdown {
		min-width: 0;
	}

	.markdown :global(:first-child) {
		margin-top: 0;
	}

	.markdown :global(:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(p) {
		margin: 0 0 0.75rem;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0.45rem 0 0.8rem;
		padding-inline-start: 1.35rem;
	}

	.markdown :global(li + li) {
		margin-top: 0.3rem;
	}

	.markdown :global(li > ul),
	.markdown :global(li > ol) {
		margin-block: 0.3rem 0;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4) {
		margin: 1rem 0 0.45rem;
		font-weight: 600;
		line-height: 1.25;
	}

	.markdown :global(h1) {
		font-size: 1.35rem;
	}

	.markdown :global(h2) {
		font-size: 1.22rem;
	}

	.markdown :global(h3),
	.markdown :global(h4) {
		font-size: 1.1rem;
	}

	.markdown :global(strong) {
		font-weight: 600;
	}

	.markdown :global(a) {
		color: inherit;
		text-decoration-thickness: 0.08em;
		text-underline-offset: 0.16em;
	}

	.markdown :global(blockquote) {
		margin: 0.75rem 0;
		border-left: 0.18rem solid color-mix(in srgb, var(--text) 18%, transparent);
		padding-left: 0.8rem;
		color: var(--muted);
	}

	.markdown :global(code) {
		border-radius: 0.3rem;
		padding: 0.1em 0.3em;
		background: color-mix(in srgb, var(--text) 7%, transparent);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.86em;
	}

	.markdown :global(pre) {
		max-width: 100%;
		margin: 0.75rem 0;
		border-radius: 0.65rem;
		padding: 0.75rem 0.85rem;
		background: color-mix(in srgb, var(--text) 7%, transparent);
		overflow-x: auto;
	}

	.markdown :global(pre code) {
		padding: 0;
		background: transparent;
		font-size: 0.82rem;
		white-space: pre;
	}

	.markdown :global(hr) {
		margin: 1rem 0;
		border: 0;
		border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
	}
</style>
