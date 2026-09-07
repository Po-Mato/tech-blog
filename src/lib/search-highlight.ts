function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function getQueryTerms(query: string): string[] {
  return query.split(/\s+/).map((term) => term.trim()).filter(Boolean).slice(0, 6);
}

export function highlightHtml(text: string, query: string): string {
  const terms = [...new Set(getQueryTerms(query))].sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(text);
  const pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let result = '';
  let offset = 0;
  // Match only the source text; never match generated tags or escaped entities.
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    result += escapeHtml(text.slice(offset, start));
    result += `<mark class="rounded bg-cyan-300/20 px-1 text-cyan-50">${escapeHtml(match[0])}</mark>`;
    offset = start + match[0].length;
  }
  return result + escapeHtml(text.slice(offset));
}
