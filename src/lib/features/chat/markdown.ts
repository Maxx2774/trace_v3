import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
	html: false,
	linkify: false,
	breaks: false,
	typographer: false
}).disable(['image']);

export function renderAssistantMarkdown(content: string): string {
	return markdown.render(content);
}
