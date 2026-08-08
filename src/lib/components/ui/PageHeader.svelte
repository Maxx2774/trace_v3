<script lang="ts">
	let { title, subtitle }: { title: string; subtitle?: string } = $props();
</script>

<div class="page-header">
	<h1>{title}</h1>
	{#if subtitle}<p>{subtitle}</p>{/if}
</div>

<style>
	.page-header {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
	}

	h1,
	p {
		margin: 0;
		font-weight: 400;
	}

	h1 {
		color: var(--text);
		font-size: clamp(1.6rem, 2.5vw, 2rem);
		letter-spacing: normal;
		line-height: 1.2;
	}

	p {
		color: var(--muted);
		font-family: 'General Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: clamp(1rem, 1.5vw, 1.1rem);
		line-height: 1.3;
	}
</style>
