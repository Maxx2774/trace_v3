<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const now = new Date();
	const greeting = getGreeting(now.getHours());
	const date = formatDate(now);
	let firstName = $derived(data.displayName.split(/\s+/)[0] || 'där');

	function getGreeting(hour: number): string {
		if (hour < 12) return 'God morgon';
		if (hour < 18) return 'God eftermiddag';
		return 'God kväll';
	}

	function formatDate(value: Date): string {
		const formatted = new Intl.DateTimeFormat('sv-SE', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(value);
		return formatted.charAt(0).toUpperCase() + formatted.slice(1);
	}
</script>

<svelte:head>
	<title>Trace</title>
	<meta name="description" content="Din privata hälsojournal i naturligt språk." />
</svelte:head>

<main class="home-page">
	<div class="home-content">
		<div class="greeting-group">
			<h1>{greeting}, {firstName}</h1>
			<p>{date}</p>
		</div>
	</div>
</main>

<style>
	.home-page {
		display: flex;
		position: relative;
		width: min(100% - 2rem, 60rem);
		min-height: 100vh;
		flex-direction: column;
		justify-content: center;
		box-sizing: border-box;
		margin: 0 auto;
		padding: 1rem 0;
	}

	.home-content {
		display: flex;
		position: absolute;
		top: 4.75rem;
		left: calc((2.5rem - 1.2rem) / 2);
		width: min(100%, 44rem);
		flex-direction: column;
		align-items: flex-start;
		gap: 2.75rem;
	}

	.greeting-group {
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
		font-size: clamp(1rem, 1.5vw, 1.1rem);
		line-height: 1.3;
	}

	@media (max-width: 640px) {
		.home-page {
			height: 100dvh;
			min-height: 0;
			overflow: hidden;
		}

		.home-page {
			padding: 0;
		}
	}
</style>
