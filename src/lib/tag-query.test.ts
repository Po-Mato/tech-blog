import {expect,it} from 'vitest';
import {readTagQuery,tagQueryHref} from './tag-query';
it('첫 q와 특수문자 원문을 복원한다',()=>{
 expect(readTagQuery('?q=cloud&q=other')).toBe('cloud');
 for(const q of [' 한글 / % & + ','','CI/CD']){
  expect(readTagQuery(new URL(tagQueryHref('https://example.com/tags/?x=1#list',q),'https://example.com').search)).toBe(q);
 }
});
it('초기화는 q만 지우고 다른 조건과 fragment를 보존한다',()=>{
 expect(tagQueryHref('https://example.com/tags/?x=1&q=a&q=b#list','')).toBe('/tags/?x=1#list');
 expect(tagQueryHref('https://example.com/tags/?q=a&q=b','new')).toBe('/tags/?q=new');
});
