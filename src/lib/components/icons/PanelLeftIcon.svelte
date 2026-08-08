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
	style="width: var(--icon-size, 1em); height: var(--icon-size, 1em);"
	aria-hidden="true"
>
	<path
		fill="currentColor"
		d="M2 7.25C2 5.455 3.455 4 5.25 4h13.5C20.545 4 22 5.455 22 7.25v9.5C22 18.545 20.545 20 18.75 20H5.25C3.455 20 2 18.545 2 16.75v-9.5ZM9.5 5.5v13h9.25c.967 0 1.75-.783 1.75-1.75v-9.5c0-.967-.783-1.75-1.75-1.75H9.5Zm-1.5 0H5.25c-.967 0-1.75.783-1.75 1.75v9.5c0 .967.783 1.75 1.75 1.75H8v-13Z"
	></path>
</svg>
