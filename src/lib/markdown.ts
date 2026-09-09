import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export type PostHeading = { id: string; title: string; depth: 2 | 3 };

type HtmlNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};

function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'img') return String(node.properties?.alt ?? '');
  return (node.children ?? []).map(textContent).join('');
}

export async function renderMarkdown(markdown: string) {
  const headings: PostHeading[] = [];

  // Run after sanitization: only our generated, namespaced IDs and links are added.
  function headingLinks() {
    return (tree: HtmlNode) => {
      const usedIds = new Set<string>();
      function collectIds(node: HtmlNode) {
        if (node.properties?.id) usedIds.add(String(node.properties.id));
        node.children?.forEach(collectIds);
      }
      collectIds(tree);

      function visit(node: HtmlNode) {
        // GFM's generated footnote section has its own accessible heading/links.
        if (node.properties?.dataFootnotes !== undefined) return;
        if (node.tagName === 'h2' || node.tagName === 'h3') {
          const title = textContent(node).replace(/\s+/g, ' ').trim();
          if (!title) return;
          const slug = title.normalize('NFKC').toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'heading';
          const base = `section-${slug}`;
          let id = base;
          let suffix = 2;
          while (usedIds.has(id)) id = `${base}-${suffix++}`;
          usedIds.add(id);
          node.properties = { ...node.properties, id, tabIndex: -1 };
          headings.push({ id, title, depth: node.tagName === 'h2' ? 2 : 3 });
          node.children = [...(node.children ?? []), {
            type: 'element', tagName: 'a',
            properties: {
              href: `#${encodeURIComponent(id)}`,
              className: ['heading-anchor'],
              ariaLabel: `${title} 항목 링크`,
            },
            children: [{ type: 'text', value: '#' }],
          }];
          return;
        }
        node.children?.forEach(visit);
      }
      visit(tree);
    };
  }

  const file = await unified()
    .use(remarkParse).use(remarkGfm).use(remarkRehype)
    .use(rehypeSanitize).use(headingLinks).use(rehypeStringify)
    .process(markdown);

  return { contentHtml: String(file), headings };
}
