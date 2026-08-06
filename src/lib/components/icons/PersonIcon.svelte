<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	let { class: className = '' }: { class?: SVGAttributes<SVGSVGElement>['class'] } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="1em"
	height="1em"
	viewBox="0 0 20 20"
	class={className}
	style="width: var(--icon-size, 1em); height: var(--icon-size, 1em); opacity: var(--icon-opacity, 1);"
	aria-hidden="true"
>
	<path
		fill="currentColor"
		d="M10 2a4 4 0 1 0 0 8a4 4 0 0 0 0-8M7 6a3 3 0 1 1 6 0a3 3 0 0 1-6 0m-1.99 5A2 2 0 0 0 3 13c0 1.69.83 2.97 2.13 3.8C6.42 17.61 8.15 18 10 18s3.58-.39 4.87-1.2A4.3 4.3 0 0 0 17 13a2 2 0 0 0-2-2zm-1.01 2c0-.55.45-1 1.01-1H15c.55 0 1 .45 1 1c0 1.31-.62 2.28-1.67 2.95C13.26 16.64 11.74 17 10 17s-3.26-.36-4.33-1.05A3.3 3.3 0 0 1 4 13"
	/>
</svg>
