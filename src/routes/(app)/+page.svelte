<script lang="ts">
	import AppPageLayout from '$lib/components/ui/AppPageLayout.svelte';
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

<AppPageLayout mobileViewportLocked>
	{#snippet header()}
		<PageHeader title={`${greeting}, ${firstName}`} subtitle={date} />
	{/snippet}
</AppPageLayout>
