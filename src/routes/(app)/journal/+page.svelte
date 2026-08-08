<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import AppPageLayout from '$lib/components/ui/AppPageLayout.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { formatSwedishLongDate } from '$lib/date-time';
	import { groupMealsByDate } from '$lib/features/journal/meal-groups';
	import MealCard from '$lib/features/meals/components/MealCard.svelte';
	import type { Meal } from '$lib/features/meals/contracts';
	import type { PageProps } from './$types';

	type JournalTab = 'all' | 'meals';

	let { data }: PageProps = $props();
	const date = formatSwedishLongDate(new Date());
	let meals = $derived(data.meals);
	let mealGroups = $derived(groupMealsByDate(meals));
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

<AppPageLayout>
	{#snippet header()}
		<PageHeader title="Journal" subtitle={date} />
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
	{/snippet}

	<section
		class="journal-content"
		hidden={activeTab === 'meals'}
		aria-label={activeTab === 'meals' ? 'Måltider' : 'Alla journalposter'}
	>
		{#if meals.length > 0}
			<div class="meal-groups">
				{#each mealGroups as group (group.key)}
					<section class="meal-group" aria-labelledby={`meal-group-${group.key}`}>
						<h2 id={`meal-group-${group.key}`}>{group.label}</h2>
						<div class="meal-list">
							{#each group.meals as meal (meal.id)}
								<MealCard
									{meal}
									editable
									editorPresentation="inline"
									variant="journal"
									onUpdated={handleMealUpdated}
									onReloadRequested={() => void invalidateAll()}
								/>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				<h2>Inga måltider ännu</h2>
				<p>Måltider som du registrerar i chatten visas här.</p>
			</div>
		{/if}
	</section>
</AppPageLayout>

<style>
	.tabs {
		display: flex;
		width: calc(100% + 1rem);
		align-items: center;
		box-sizing: border-box;
		gap: 0.25rem;
		margin: 1rem -0.5rem -0.5rem;
		overflow-x: auto;
		padding: 0.5rem;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar {
		display: none;
	}

	.tabs a,
	.tabs button {
		display: inline-flex;
		height: 2rem;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		position: relative;
		flex: 0 0 auto;
		border: 1px solid transparent;
		border-radius: 0.55rem;
		padding: 0 0.65rem;
		background: transparent;
		color: var(--muted);
		font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 435;
		line-height: 1.2;
		text-decoration: none;
	}

	.tabs a {
		cursor: pointer;
		transition:
			background 150ms ease,
			border-color 150ms ease,
			box-shadow 150ms ease,
			color 150ms ease;
	}

	.tabs a:hover,
	.tabs a.active {
		color: var(--text);
	}

	.tabs a.active {
		border-color: var(--border);
		background: var(--surface-hover);
		box-shadow: 0 0.16rem 0.5rem rgb(23 32 51 / 7%);
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

	:global(:root[data-theme='dark']) .tabs a.active {
		box-shadow: 0 0.16rem 0.5rem rgb(0 0 0 / 24%);
	}

	.journal-content {
		padding-top: 14rem;
	}

	.meal-groups,
	.meal-group,
	.meal-list {
		--meal-card-width: 100%;
		display: flex;
		width: min(100%, 44rem);
		flex-direction: column;
	}

	.meal-groups {
		gap: 1.5rem;
	}

	.meal-group {
		display: grid;
		gap: 0.5rem;
	}

	.meal-group h2 {
		margin: 0;
		padding: 0.25rem 0.65rem 0.2rem 0;
		color: var(--muted);
		font-family: 'General Sans', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 400;
		line-height: 1.25;
	}

	.meal-list {
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
		.tabs a,
		.tabs button {
			padding-inline: 0.65rem;
		}
	}
</style>
