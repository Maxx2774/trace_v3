<script module lang="ts">
	let assistantMessageModule: Promise<typeof import('./AssistantMessage.svelte')> | undefined;

	function loadAssistantMessage() {
		return (assistantMessageModule ??= import('./AssistantMessage.svelte'));
	}
</script>

<script lang="ts">
	let { content }: { content: string } = $props();
	const messageModule = loadAssistantMessage();
</script>

{#snippet plainTextMessage()}
	<article class="assistant-message-fallback"><p>{content}</p></article>
{/snippet}

{#await messageModule}
	{@render plainTextMessage()}
{:then { default: AssistantMessage }}
	<AssistantMessage {content} />
{:catch}
	{@render plainTextMessage()}
{/await}

<style>
	.assistant-message-fallback {
		max-width: min(80%, 32rem);
		align-self: flex-start;
		color: var(--text);
		font-size: 1.1rem;
		line-height: 1.45;
		word-break: break-word;
	}

	.assistant-message-fallback p {
		margin: 0;
		white-space: pre-wrap;
	}
</style>
