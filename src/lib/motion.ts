export function getRevealMotion(element: Element) {
	const styles = getComputedStyle(element);
	const duration = Number.parseFloat(styles.getPropertyValue('--motion-reveal-duration'));

	return {
		duration: Number.isFinite(duration) ? duration : 0,
		easing: styles.getPropertyValue('--motion-reveal-easing').trim() || 'ease',
		blur: styles.getPropertyValue('--motion-reveal-blur').trim() || '0px'
	};
}
