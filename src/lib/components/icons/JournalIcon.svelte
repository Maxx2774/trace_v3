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
		d="M7 6C7 5.44772 7.44772 5 8 5H16C16.5523 5 17 5.44772 17 6V8C17 8.55228 16.5523 9 16 9H8C7.44772 9 7 8.55228 7 8V6ZM8.5 7.5H15.5V6.5H8.5V7.5ZM4 4.5C4 3.11929 5.11929 2 6.5 2H18C19.3807 2 20.5 3.11929 20.5 4.5V18.75C20.5 19.1642 20.1642 19.5 19.75 19.5H5.5C5.5 20.0523 5.94772 20.5 6.5 20.5H19.75C20.1642 20.5 20.5 20.8358 20.5 21.25C20.5 21.6642 20.1642 22 19.75 22H6.5C5.11929 22 4 20.8807 4 19.5V4.5ZM5.5 18H19V4.5C19 3.94772 18.5523 3.5 18 3.5H6.5C5.94772 3.5 5.5 3.94772 5.5 4.5V18Z"
	/>
</svg>
