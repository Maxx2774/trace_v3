<script lang="ts">
	import { resolve } from '$app/paths';
	import logoUrl from '$lib/assets/logo.svg';
</script>

<a class="wordmark" href={resolve('/')} aria-label="Trace startsida">
	<img src={logoUrl} alt="" />
	<span>trace</span>
</a>

<style>
	.wordmark {
		display: inline-flex;
		width: fit-content;
		align-items: center;
		gap: 0.55rem;
		color: color-mix(in oklch, var(--muted) 75%, var(--background));
		font-size: 1.3rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1;
		text-decoration: none;
	}

	img {
		display: block;
		width: auto;
		height: 1.75rem;
		flex: 0 0 auto;
		opacity: 0.75;
	}

	:global(:root[data-theme='dark']) .wordmark {
		color: color-mix(in oklch, var(--muted) 36%, var(--background));
	}
</style>
