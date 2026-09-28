import { expect, it } from 'vitest';
import { filterTagNames } from './tag-search';
const tags = [{tag:'Cloud Native', count:5}, {tag:'CI/CD', count:2}, {tag:'C++', count:1}, {tag:'한글 태그', count:1}];
it('matches partial names regardless of case and repeated whitespace', () => {
  expect(filterTagNames(tags,' CLOUD   native ')).toEqual([tags[0]]);
  expect(filterTagNames(tags,'native')).toEqual([tags[0]]);
});
it('treats punctuation literally', () => {
  expect(filterTagNames(tags,'CI/')).toEqual([tags[1]]);
  expect(filterTagNames(tags,'++')).toEqual([tags[2]]);
  expect(filterTagNames(tags,'.*')).toEqual([]);
});
it('normalizes decomposed Korean without modifying names', () => {
  expect(filterTagNames(tags,'한글'.normalize('NFD'))).toEqual([tags[3]]);
});
it('preserves original order, metadata and input for empty queries', () => {
  const original=structuredClone(tags);
  expect(filterTagNames(tags,' \t ')).toEqual(tags);
  expect(tags).toEqual(original);
});
it('handles missing matches, empty lists and long text', () => {
  expect(filterTagNames(tags,'missing')).toEqual([]);
  expect(filterTagNames([], 'cloud')).toEqual([]);
  const long = {tag:'긴태그'.repeat(100)};
  expect(filterTagNames([long], '태그긴')).toEqual([long]);
});
