import {expect,it} from 'vitest';
import {groupByMonth,monthHref,monthLabel} from './month-archive';
const post=(slug:string,date:string)=>({slug,date,title:slug});
it('연도 경계·월별 합계·최신순을 보존한다',()=>{
 const g=groupByMonth([post('a','2025-12-31'),post('b','2026-01-01'),post('c','2026-01-03')]);
 expect(g.map(x=>[x.month,x.posts.map(p=>p.slug)])).toEqual([['2026-01',['c','b']],['2025-12',['a']]]);
 expect(g.reduce((n,x)=>n+x.posts.length,0)).toBe(3);
});
it('잘못된 날짜·중복을 제외하고 빈 월은 만들지 않는다',()=>{
 expect(groupByMonth([post('a','2026-02-30'),post('b','bad')])).toEqual([]);
 expect(groupByMonth([post('a','2026-03-01'),post('a','2026-03-01')])[0].posts).toHaveLength(1);
 expect(groupByMonth([])).toEqual([]);
});
it('같은 날짜는 slug로 정렬하고 날짜의 월을 시간대와 무관하게 사용한다',()=>{
 const g=groupByMonth([post('b','2026-03-01T00:00:00+09:00'),post('a','2026-03-01T00:00:00+09:00')]);
 expect(g[0].month).toBe('2026-03');expect(g[0].posts.map(p=>p.slug)).toEqual(['a','b']);
 expect(monthHref('2026-03')).toBe('/archive/month/2026-03/');expect(monthLabel('2026-03')).toBe('2026년 3월');
});
