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
		d="M4.397 4.554l.073-.084a.75.75 0 0 1 .976-.073l.084.073L12 10.939l6.47-6.469a.75.75 0 1 1 1.06 1.06L13.061 12l6.469 6.47a.75.75 0 0 1 .073.976l-.073.084a.75.75 0 0 1-.976.073l-.084-.073L12 13.061 5.53 19.53a.75.75 0 0 1-1.06-1.06L10.939 12 4.47 5.53a.75.75 0 0 1-.073-.976l.073-.084z"
	></path>
</svg>
