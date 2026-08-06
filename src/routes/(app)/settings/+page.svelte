<script lang="ts">
	import { currentTheme, setTheme, type Theme } from '$lib/theme';
	import { onMount } from 'svelte';

	const themes = [
		{ value: 'light', label: 'Ljust tema', previewClass: 'light-preview' },
		{ value: 'dark', label: 'Mörkt tema', previewClass: 'dark-preview' }
	] as const satisfies readonly { value: Theme; label: string; previewClass: string }[];

	let theme = $state<Theme>('light');
	onMount(() => (theme = currentTheme()));

	function chooseTheme(nextTheme: Theme) {
		if (theme === nextTheme) return;
		theme = nextTheme;
		setTheme(nextTheme);
	}
</script>

<svelte:head><title>Inställningar · Trace</title></svelte:head>

<main>
	<div class="settings-content">
		<h1>Inställningar</h1>

		<section aria-labelledby="appearance-heading">
			<h2 id="appearance-heading">Utseende</h2>

			<div class="theme-options" role="radiogroup" aria-label="Färgtema">
				{#each themes as option (option.value)}
					<button
						class="theme-option"
						type="button"
						role="radio"
						aria-label={option.label}
						aria-checked={theme === option.value}
						onclick={() => chooseTheme(option.value)}
					>
						<span class={['theme-preview', option.previewClass]} aria-hidden="true">
							<span class="preview-bar"><span class="preview-dots"></span></span>
							<span class="preview-body">
								<span class="preview-sidebar">
									<span class="preview-avatar"></span>
									<span class="preview-lines"></span>
								</span>
								<span class="preview-main">
									<span class="preview-heading"></span>
									<span class="preview-wide-card"></span>
									<span class="preview-card-grid">
										<span></span><span></span>
									</span>
								</span>
							</span>
						</span>
					</button>
				{/each}
			</div>
		</section>
	</div>
</main>

<style>
	main {
		position: relative;
		width: min(100% - 2rem, 60rem);
		min-height: 100vh;
		box-sizing: border-box;
		margin: 0 auto;
		padding: 4.75rem 0;
	}

	.settings-content {
		display: grid;
		width: min(100%, 44rem);
		gap: 2.75rem;
		margin-left: calc((2.5rem - 1.2rem) / 2);
	}

	h1 {
		margin: 0;
		color: var(--text);
		font-size: clamp(1.6rem, 2.5vw, 2rem);
		font-weight: 400;
		letter-spacing: normal;
		line-height: 1.2;
	}

	section {
		display: grid;
		gap: 1rem;
	}

	h2 {
		margin: 0;
		color: var(--muted);
		font-size: 1.15rem;
		font-weight: 400;
		line-height: 1.3;
	}

	.theme-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 13.5rem));
		gap: 1rem;
	}

	.theme-option {
		display: block;
		min-width: 0;
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}

	.theme-preview {
		--preview-background: #ffffff;
		--preview-surface: #ffffff;
		--preview-muted: #f5f6f7;
		--preview-strong: #7b8493;
		display: grid;
		width: 100%;
		aspect-ratio: 1.5;
		grid-template-rows: 1.1rem minmax(0, 1fr);
		box-sizing: border-box;
		border: 2px solid color-mix(in srgb, var(--text) 8%, transparent);
		border-radius: 0.9rem;
		background: var(--preview-background);
		overflow: hidden;
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.dark-preview {
		--preview-background: #000000;
		--preview-surface: #171717;
		--preview-muted: #222222;
		--preview-strong: #a6adb8;
	}

	.preview-bar {
		display: flex;
		align-items: center;
		border-bottom: 1px solid color-mix(in srgb, var(--preview-strong) 24%, transparent);
		padding-left: 0.55rem;
		background: var(--preview-surface);
	}

	.preview-dots,
	.preview-dots::before,
	.preview-dots::after {
		width: 0.25rem;
		aspect-ratio: 1;
		border-radius: 50%;
		background: #d98269;
	}

	.preview-dots {
		position: relative;
		flex: 0 0 0.25rem;
	}

	.preview-dots::before,
	.preview-dots::after {
		position: absolute;
		top: 0;
		content: '';
	}

	.preview-dots::before {
		left: 0.38rem;
		background: #deb866;
	}

	.preview-dots::after {
		left: 0.76rem;
		background: #78b987;
	}

	.preview-body {
		display: grid;
		min-height: 0;
		grid-template-columns: 32% minmax(0, 1fr);
	}

	.preview-sidebar {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
		border-right: 1px solid color-mix(in srgb, var(--preview-strong) 18%, transparent);
		padding: 0.7rem 0.55rem;
		background: var(--preview-surface);
	}

	.preview-avatar {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 999px;
		background: var(--preview-muted);
	}

	.preview-lines {
		width: 72%;
		height: 0.28rem;
		border-radius: 999px;
		background: var(--preview-muted);
		box-shadow:
			0 0.65rem 0 var(--preview-muted),
			0 1.3rem 0 var(--preview-muted);
	}

	.preview-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.7rem;
	}

	.preview-heading {
		width: 46%;
		height: 0.35rem;
		border-radius: 999px;
		background: var(--preview-strong);
	}

	.preview-wide-card,
	.preview-card-grid span {
		border-radius: 0.35rem;
		background: var(--preview-muted);
	}

	.preview-wide-card {
		flex: 0 0 38%;
	}

	.preview-card-grid {
		display: grid;
		flex: 0 0 28%;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.theme-option:hover .theme-preview {
		border-color: color-mix(in srgb, var(--text) 28%, transparent);
	}

	.theme-option[aria-checked='true'] .theme-preview {
		border-color: color-mix(in srgb, var(--text) 34%, transparent);
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--text) 7%, transparent),
			0 0.35rem 1rem color-mix(in srgb, var(--text) 6%, transparent);
	}

	.theme-option:focus-visible {
		outline: none;
	}

	.theme-option:focus-visible .theme-preview {
		outline: 2px solid color-mix(in srgb, var(--text) 45%, transparent);
		outline-offset: 3px;
	}
</style>
