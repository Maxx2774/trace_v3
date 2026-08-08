<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import MealCard from '$lib/features/meals/components/MealCard.svelte';
	import type { Meal } from '$lib/features/meals/contracts';
	import type { PageProps } from './$types';

	type JournalTab = 'all' | 'meals';

	let { data }: PageProps = $props();
	let meals = $derived(data.meals);
	let activeTab = $derived<JournalTab>(
		page.url.searchParams.get('tab') === 'meals' ? 'meals' : 'all'
	);
	let allHref = $derived(journalTabHref(page.url, 'all'));
	let mealsHref = $derived(journalTabHref(page.url, 'meals'));

	function journalTabHref(currentUrl: URL, tab: JournalTab): PathnameWithSearchOrHash {
		const target = new URL(currentUrl);
		if (tab === 'meals') target.searchParams.set('tab', 'meals');
		else target.searchParams.delete('tab');
		return `${target.pathname}${target.search}${target.hash}` as PathnameWithSearchOrHash;
	}

	function handleMealUpdated(updatedMeal: Meal) {
		meals = meals.map((meal) => (meal.id === updatedMeal.id ? updatedMeal : meal));
	}
</script>

<svelte:head>
	<title>Journal · Trace</title>
	<meta name="description" content="Din samlade hälsojournal i Trace." />
</svelte:head>

<main class="journal-page">
	<header>
		<h1>Journal</h1>
		<nav class="tabs" aria-label="Journalfilter">
			<a
				class:active={activeTab === 'all'}
				href={resolve(allHref)}
				aria-current={activeTab === 'all' ? 'page' : undefined}>Alla</a
			>
			<a
				class:active={activeTab === 'meals'}
				href={resolve(mealsHref)}
				aria-current={activeTab === 'meals' ? 'page' : undefined}>Måltider</a
			>
			<button type="button" disabled>Symtom</button>
			<button type="button" disabled>Vikt</button>
			<button type="button" disabled>Sömn</button>
		</nav>
	</header>

	<section
		class="journal-content"
		aria-label={activeTab === 'meals' ? 'Måltider' : 'Alla journalposter'}
	>
		{#if meals.length > 0}
			<div class="meal-list">
				{#each meals as meal (meal.id)}
					<MealCard
						{meal}
						editable
						editorPresentation="inline"
						onUpdated={handleMealUpdated}
						onReloadRequested={() => void invalidateAll()}
					/>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				<h2>Inga måltider ännu</h2>
				<p>Måltider som du registrerar i chatten visas här.</p>
			</div>
		{/if}
	</section>
</main>

<style>
	.journal-page {
		display: flex;
		position: relative;
		width: min(100% - 2rem, 60rem);
		min-height: 100vh;
		flex-direction: column;
		justify-content: flex-start;
		box-sizing: border-box;
		margin: 0 auto;
		padding: 1rem 0 4rem;
	}

	header {
		display: flex;
		position: absolute;
		top: 4.75rem;
		left: calc((2.5rem - 1.2rem) / 2);
		width: min(calc(100% - (2.5rem - 1.2rem) / 2), 44rem);
		flex-direction: column;
		align-items: flex-start;
		gap: 1.5rem;
	}

	h1 {
		margin: 0;
		color: var(--text);
		font-size: clamp(1.6rem, 2.5vw, 2rem);
		font-weight: 400;
		letter-spacing: normal;
		line-height: 1.2;
	}

	.tabs {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar {
		display: none;
	}

	.tabs a,
	.tabs button {
		position: relative;
		flex: 0 0 auto;
		border: 0;
		padding: 0.65rem 0.8rem 0.75rem;
		background: transparent;
		color: var(--muted);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 435;
		line-height: 1.2;
		text-decoration: none;
	}

	.tabs a {
		cursor: pointer;
		transition: color 150ms ease;
	}

	.tabs a::after {
		position: absolute;
		right: 0.75rem;
		bottom: -1px;
		left: 0.75rem;
		height: 2px;
		border-radius: 999px;
		background: currentColor;
		content: '';
		opacity: 0;
		transform: scaleX(0.6);
		transition:
			opacity 150ms ease,
			transform 150ms ease;
	}

	.tabs a:hover,
	.tabs a.active {
		color: var(--text);
	}

	.tabs a.active::after {
		opacity: 1;
		transform: scaleX(1);
	}

	.tabs a:focus-visible {
		border-radius: 0.45rem;
		outline: 2px solid color-mix(in srgb, var(--text) 42%, transparent);
		outline-offset: -2px;
	}

	.tabs button:disabled {
		color: color-mix(in srgb, var(--muted) 58%, transparent);
		cursor: not-allowed;
	}

	.journal-content {
		width: min(calc(100% - (2.5rem - 1.2rem) / 2), 44rem);
		margin-left: calc((2.5rem - 1.2rem) / 2);
		padding-top: 12rem;
	}

	.meal-list {
		--meal-card-width: 100%;
		display: flex;
		width: min(100%, 44rem);
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty-state {
		padding: 3.5rem 0;
	}

	.empty-state h2,
	.empty-state p {
		margin: 0;
	}

	.empty-state h2 {
		font-size: 1.05rem;
		font-weight: 435;
	}

	.empty-state p {
		margin-top: 0.45rem;
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.journal-page {
			padding-top: 0;
		}

		.tabs a,
		.tabs button {
			padding-inline: 0.65rem;
		}
	}
</style>
