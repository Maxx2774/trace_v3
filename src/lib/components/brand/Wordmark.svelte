<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<a class="wordmark" href={resolve('/')} aria-label="Trace startsida">Trace</a>

<style>
	.wordmark {
		width: fit-content;
		color: color-mix(in oklch, var(--muted) 60%, var(--background));
		font-size: 1.4rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1;
		text-decoration: none;
	}

	:global(:root[data-theme='dark']) .wordmark {
		color: color-mix(in oklch, var(--muted) 42%, var(--background));
	}
</style>
