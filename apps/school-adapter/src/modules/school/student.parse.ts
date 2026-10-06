import {load} from 'cheerio';
import {SchoolError} from '../../utils/school-error.js';
// A missing/changed selector cannot be interpreted as "no classes/absences".
// The actual school's authenticated empty-state wording must be verified on login.
export function assertParsedRows(html:string,count:number){
 if(count)return;
 const $=load(html);const text=$('table.grid_view').text().replace(/\s+/g,'');
 if(!/查無資料|沒有資料|目前無資料|無課程資料|沒有課程|沒有公告|查無公告/.test(text))throw new SchoolError('SCHOOL_PAGE_CHANGED');
}
