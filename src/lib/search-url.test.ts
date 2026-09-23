import { expect, it } from 'vitest';
import { readSearchConditions, updateSearchUrl } from './search-url';
it('preserves Korean, whitespace and reserved characters', () => {
  const q = ' 한글 + & # / % ';
  const path = updateSearchUrl('https://example.com/search/', {q, tag:'CI/CD',sort:'new'});
  expect(readSearchConditions(new URL(path,'https://example.com').searchParams)).toEqual({q,tag:'CI/CD',sort:'new'});
});
it('preserves pending tags and normalizes aliases before validation', () => {
  const p = new URLSearchParams('tag=Cloud-Native');
  expect(readSearchConditions(p).tag).toBe('Cloud Native');
  expect(readSearchConditions(p,['Cloud Native']).tag).toBe('Cloud Native');
  expect(readSearchConditions(p,[]).tag).toBe('all');
});
it('falls back for invalid values and supports legacy q-only links', () => {
  expect(readSearchConditions(new URLSearchParams('q=AI&tag=missing&sort=no'),['MCP'])).toEqual({q:'AI',tag:'all',sort:'relevance'});
  expect(readSearchConditions(new URLSearchParams('q=AI'))).toEqual({q:'AI',tag:'all',sort:'relevance'});
});
it('removes defaults while retaining unrelated parameters and fragments', () => {
  expect(updateSearchUrl('https://example.com/search/?q=AI&tag=MCP&sort=new&ref=test#top',{q:'',tag:'all',sort:'relevance'})).toBe('/search/?ref=test#top');
});
it('updates from the current URL without losing prior fast changes', () => {
  const first=updateSearchUrl('https://example.com/search/?q=cloud',{tag:'Cloud Native'});
  const second=updateSearchUrl(new URL(first,'https://example.com').href,{sort:'new'});
  expect(readSearchConditions(new URL(second,'https://example.com').searchParams)).toEqual({q:'cloud',tag:'Cloud Native',sort:'new'});
});
