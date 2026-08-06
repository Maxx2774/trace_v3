<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	let { class: className = '' }: { class?: SVGAttributes<SVGSVGElement>['class'] } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="1em"
	height="1em"
	viewBox="0 0 24 24"
	class={className}
	style="width: var(--icon-size, 1em); height: var(--icon-size, 1em); opacity: var(--icon-opacity, 1);"
	aria-hidden="true"
>
	<path
		fill="currentColor"
		d="M7.75 12A1.75 1.75 0 1 1 4.25 12a1.75 1.75 0 0 1 3.5 0m6 0a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 0 1 3.5 0M18 13.75A1.75 1.75 0 1 0 18 10.25a1.75 1.75 0 0 0 0 3.5"
	/>
</svg>
