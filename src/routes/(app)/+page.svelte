<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { formatSwedishLongDate } from '$lib/date-time';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const now = new Date();
	const greeting = getGreeting(now.getHours());
	const date = formatSwedishLongDate(now);
	let firstName = $derived(data.displayName.split(/\s+/)[0] || 'där');

	function getGreeting(hour: number): string {
		if (hour < 12) return 'God morgon';
		if (hour < 18) return 'God eftermiddag';
		return 'God kväll';
	}
</script>

<svelte:head>
	<title>Trace</title>
	<meta name="description" content="Din privata hälsojournal i naturligt språk." />
</svelte:head>

<main class="home-page">
	<div class="home-content">
		<PageHeader title={`${greeting}, ${firstName}`} subtitle={date} />
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
