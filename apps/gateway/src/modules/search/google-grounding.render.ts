import {load} from 'cheerio';
import {Fault} from '../../utils/fault.js';
import type {GroundedAnswer} from './google-grounding.provider.js';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// Reject active markup instead of silently changing Google's required suggestions.
export function renderGroundedAnswer(result:GroundedAnswer):string{
 const $=load(result.suggestionsHtml);
 const allowed=new Set(['html','head','body','style','div','span','a','p','br','strong','b','em','i','ul','li','svg','path','g','circle','rect','title']);
 $('*').each((_index,element)=>{if('name' in element&&!allowed.has(element.name))throw new Fault(503,'UNSAFE_SEARCH_SUGGESTIONS');});
 $('*').each((_index,element)=>{for(const [name,value]of Object.entries('attribs' in element?element.attribs:{})){
  if(/^on/i.test(name)||['src','srcset','action','formaction','srcdoc'].includes(name)||(/style/i.test(name)&&/url\s*\(|@import|expression\s*\(/i.test(value)))throw new Fault(503,'UNSAFE_SEARCH_SUGGESTIONS');
  if(name==='href'||name==='xlink:href'){let url:URL;try{url=new URL(value);}catch{throw new Fault(503,'UNSAFE_SEARCH_SUGGESTIONS');}if(url.protocol!=='https:'||url.username||url.password)throw new Fault(503,'UNSAFE_SEARCH_SUGGESTIONS');}
 }});
 if(/url\s*\(|@import|expression\s*\(/i.test($('style').text()))throw new Fault(503,'UNSAFE_SEARCH_SUGGESTIONS');
 return `<article><div style="white-space:pre-wrap">${escape(result.answer)}</div><nav aria-label="來源">${result.sources.map(source=>`<p><a href="${escape(source.uri)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a></p>`).join('')}</nav>${result.suggestionsHtml}</article>`;
}
