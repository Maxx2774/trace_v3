<script lang="ts">
	let {
		width = '100%',
		height = '1rem',
		radius = '0.45rem',
		class: className
	}: {
		width?: string;
		height?: string;
		radius?: string;
		class?: string;
	} = $props();
</script>

<span
	class={['skeleton', className]}
	style:--skeleton-width={width}
	style:--skeleton-height={height}
	style:--skeleton-radius={radius}
	aria-hidden="true"
></span>

<style>
	.skeleton {
		display: block;
		width: var(--skeleton-width);
		height: var(--skeleton-height);
		flex: none;
		border-radius: var(--skeleton-radius);
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--text) 6%, transparent) 20%,
			color-mix(in srgb, var(--text) 11%, transparent) 50%,
			color-mix(in srgb, var(--text) 6%, transparent) 80%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes skeleton-shimmer {
		from {
			background-position: 200% 0;
		}

		to {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
	}
</style>
