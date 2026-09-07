import { describe, expect, it } from 'vitest';
import { highlightHtml } from './search-highlight';
const mark = (text: string) => `<mark class="rounded bg-cyan-300/20 px-1 text-cyan-50">${text}</mark>`;

describe('search result highlighting', () => {
  it('does not match later terms against generated mark tags', () => {
    expect(highlightHtml('AI and architecture', 'AI a')).toBe(`${mark('AI')} ${mark('a')}nd ${mark('a')}rchitecture`);
  });
  it('preserves HTML entities while highlighting original symbols', () => {
    expect(highlightHtml('R&D <tag>', '& <')).toBe(`R${mark('&amp;')}D ${mark('&lt;')}tag&gt;`);
    expect(highlightHtml('R&D', 'amp')).toBe('R&amp;D');
  });
  it('treats regular expression symbols as literal terms', () => {
    expect(highlightHtml('C++ [AI] a.b', 'C++ [AI] a.b')).toBe(`${mark('C++')} ${mark('[AI]')} ${mark('a.b')}`);
  });
  it('prefers the longest match and keeps source casing', () => {
    expect(highlightHtml('AI Agent ai', 'ai agent AI')).toBe(`${mark('AI')} ${mark('Agent')} ${mark('ai')}`);
  });
  it('escapes both matching and nonmatching untrusted text', () => {
    expect(highlightHtml('<img src=x onerror="alert(1)">', 'img')).toBe(`&lt;${mark('img')} src=x onerror=&quot;alert(1)&quot;&gt;`);
    expect(highlightHtml('<script>alert(1)</script>', '')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('handles empty and unmatched queries without changing visible text', () => {
    expect(highlightHtml('검색 결과', '   ')).toBe('검색 결과');
    expect(highlightHtml('검색 결과', '없는말')).toBe('검색 결과');
  });
});
