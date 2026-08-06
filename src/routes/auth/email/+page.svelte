<script lang="ts">
	import { resolve } from '$app/paths';
	import Wordmark from '$lib/components/brand/Wordmark.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let error = $derived(typeof form?.error === 'string' ? localizeAuthError(form.error) : '');
	let email = $derived(typeof form?.email === 'string' ? form.email : '');

	function localizeAuthError(value: string): string {
		const message = value.toLowerCase();
		if (message.includes('invalid login credentials')) return 'Felaktig e-post eller lösenord.';
		if (message.includes('email not confirmed')) return 'Bekräfta din e-postadress först.';
		if (message.includes('user already registered')) return 'E-postadressen används redan.';
		if (message.includes('password')) return 'Lösenordet uppfyller inte kraven.';
		return value;
	}
</script>

<svelte:head>
	<title>Logga in · Trace</title>
</svelte:head>

<main class="auth-page">
	<section class="auth-card">
		<Wordmark />
		<div class="heading">
			<h1>Logga in</h1>
			<p>Fortsätt till din privata Trace-journal.</p>
		</div>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<form method="POST">
			<input type="hidden" name="next" value={data.next} />
			<label for="email">E-post</label>
			<input id="email" name="email" type="email" value={email} autocomplete="email" required />

			<label for="password">Lösenord</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>

			<div class="form-actions">
				<Button type="submit" size="lg" formaction="?/signIn">Logga in</Button>
				<Button variant="secondary" type="submit" size="lg" formaction="?/signUp"
					>Skapa konto</Button
				>
			</div>
		</form>

		<form class="oauth-form" method="GET" action={resolve('/auth/login')}>
			<input type="hidden" name="next" value={data.next} />
			<Button variant="secondary" type="submit" size="lg">Fortsätt med Google</Button>
		</form>
	</section>
</main>

<style>
	.auth-page {
		display: grid;
		min-height: 100svh;
		place-items: center;
		box-sizing: border-box;
		padding: 1.5rem;
	}

	.auth-card {
		display: grid;
		width: min(100%, 25rem);
		gap: 1.5rem;
		box-sizing: border-box;
		border-radius: 1.75rem;
		padding: 2rem;
		background: var(--surface-elevated);
		box-shadow: var(--sheet-shadow);
	}

	.heading {
		display: grid;
		gap: 0.4rem;
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-size: 1.8rem;
		font-weight: 400;
	}

	.heading p {
		color: var(--muted);
		line-height: 1.5;
	}

	.error {
		border-radius: 0.8rem;
		padding: 0.75rem;
		background: color-mix(in srgb, #b44545 10%, transparent);
		color: #a43c3c;
		font-size: 0.9rem;
	}

	form {
		display: grid;
		gap: 0.75rem;
	}

	label {
		font-size: 0.9rem;
	}

	input {
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		padding: 0.8rem 0.9rem;
		background: var(--background);
		color: var(--text);
		font: inherit;
	}

	input:focus {
		border-color: color-mix(in srgb, var(--text) 35%, var(--border));
		outline: none;
	}

	.form-actions {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.4rem;
	}

	.oauth-form {
		display: grid;
	}
</style>
