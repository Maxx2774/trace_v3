<script lang="ts">
	import ChatIcon from '$lib/components/icons/ChatIcon.svelte';
	import GaugeIcon from '$lib/components/icons/GaugeIcon.svelte';
	import MealIcon from '$lib/components/icons/MealIcon.svelte';
	import PulseIcon from '$lib/components/icons/PulseIcon.svelte';
	import SleepIcon from '$lib/components/icons/SleepIcon.svelte';
	import { getConversationCategoryPresentation } from '../conversation-category';
	import type { ConversationCategory } from '../contracts';

	let {
		category,
		filledOnHover = false
	}: { category?: ConversationCategory; filledOnHover?: boolean } = $props();
	let presentation = $derived(getConversationCategoryPresentation(category));
</script>

<span
	class="category-icon"
	style:--category-color={presentation.color}
	role="img"
	aria-label={presentation.label}
>
	<span class="outline-variant">
		{#if category === 'meal'}
			<MealIcon />
		{:else if category === 'symptom'}
			<PulseIcon />
		{:else if category === 'sleep'}
			<SleepIcon />
		{:else if category === 'weight'}
			<GaugeIcon />
		{:else}
			<ChatIcon />
		{/if}
	</span>
	{#if filledOnHover}
		<span class="filled-variant">
			{#if category === 'meal'}
				<MealIcon filled />
			{:else if category === 'symptom'}
				<PulseIcon filled />
			{:else if category === 'sleep'}
				<SleepIcon filled />
			{:else if category === 'weight'}
				<GaugeIcon filled />
			{:else}
				<ChatIcon filled />
			{/if}
		</span>
	{/if}
</span>

<style>
	.category-icon {
		--icon-size: 1.2rem;

		position: relative;
		display: inline-flex;
		width: var(--icon-size);
		height: var(--icon-size);
		flex: none;
		align-items: center;
		justify-content: center;
		color: var(--category-color);
		line-height: 1;
	}

	.outline-variant,
	.filled-variant {
		position: absolute;
		inset: 0;
		display: inline-flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
	}

	.outline-variant {
		opacity: var(--conversation-category-outline-opacity, 1);
	}

	.filled-variant {
		opacity: var(--conversation-category-filled-opacity, 0);
	}
</style>
