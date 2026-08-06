import { describe, expect, it } from 'vitest';
import { renderAssistantMarkdown } from '$lib/features/chat/markdown';

describe('renderAssistantMarkdown', () => {
	it('renders common assistant formatting', () => {
		const html = renderAssistantMarkdown(
			'## Förslag\n\n- Första punkten\n- Andra med **viktig text** och `kod`.'
		);

		expect(html).toContain('<h2>Förslag</h2>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>Första punkten</li>');
		expect(html).toContain('<strong>viktig text</strong>');
		expect(html).toContain('<code>kod</code>');
	});

	it('does not render raw HTML, unsafe links, or images', () => {
		const html = renderAssistantMarkdown(
			'<script>alert(1)</script>\n\n[Öppna](javascript:alert(1))\n\n![Bild](https://example.com/image.png)'
		);

		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain('<img');
	});
});
