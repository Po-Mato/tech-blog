import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('article section navigation', () => {
  it('links Korean headings and nested inline formatting to matching sections', async () => {
    const { headings, contentHtml } = await renderMarkdown('# 제목\n\n## 시작 & **설정**\n\n### `코드`와 [예시](https://example.com)');
    expect(headings).toEqual([
      { id: 'section-시작-설정', title: '시작 & 설정', depth: 2 },
      { id: 'section-코드와-예시', title: '코드와 예시', depth: 3 },
    ]);
    for (const heading of headings) {
      expect(contentHtml).toContain(`id="${heading.id}" tabindex="-1"`);
      expect(contentHtml).toContain(`href="#${encodeURIComponent(heading.id)}"`);
    }
    expect(contentHtml).toContain('시작 &#x26; <strong>설정</strong>');
  });

  it('keeps repeated, suffix-like and punctuation-only headings uniquely addressable', async () => {
    const source = '## API\n\n## API\n\n## API-2\n\n## !!!\n\n## ???';
    const first = await renderMarkdown(source);
    expect(first.headings.map((heading) => heading.id)).toEqual([
      'section-api', 'section-api-2', 'section-api-2-2', 'section-heading', 'section-heading-2',
    ]);
    expect(await renderMarkdown(source)).toEqual(first);
  });

  it('does not mistake code, raw HTML or footnote labels for article sections', async () => {
    const { headings, contentHtml } = await renderMarkdown('## 본문\n\n설명[^1]\n\n```md\n## 코드 속 제목\n```\n\n<h2 onclick="alert(1)">raw</h2>\n\n[^1]: 출처');
    expect(headings.map((heading) => heading.title)).toEqual(['본문']);
    expect(contentHtml).toContain('id="user-content-footnote-label"');
    expect(contentHtml).toContain('## 코드 속 제목');
    expect(contentHtml).not.toContain('onclick');
  });

  it('retains sanitization and escapes generated link labels', async () => {
    const { contentHtml } = await renderMarkdown('## [Unsafe](javascript:alert%281%29) "quote" & safe\n\n<script>alert(1)</script>');
    expect(contentHtml).not.toContain('javascript:');
    expect(contentHtml).not.toContain('<script>');
    expect(contentHtml).toContain('aria-label="Unsafe &#x22;quote&#x22; &#x26; safe 항목 링크"');
  });

  it('returns no navigation entries for plain text or a title-only article', async () => {
    expect((await renderMarkdown('# 제목\n\n본문입니다.')).headings).toEqual([]);
  });
});
