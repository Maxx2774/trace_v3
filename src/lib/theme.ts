export type Theme = 'light' | 'dark';

let transitionFrame = 0;

export function currentTheme(): Theme {
	return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
	const root = document.documentElement;
	cancelAnimationFrame(transitionFrame);
	root.classList.add('theme-changing');
	root.dataset.theme = theme;
	localStorage.setItem('trace-theme', theme);

	transitionFrame = requestAnimationFrame(() => {
		transitionFrame = requestAnimationFrame(() => root.classList.remove('theme-changing'));
	});
}
