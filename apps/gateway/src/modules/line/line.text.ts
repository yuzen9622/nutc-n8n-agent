// LINE text messages have no Markdown renderer. Convert common model formatting
// at the transport boundary; protect URLs and literal code rather than deleting
// every asterisk/underscore (which would corrupt links and ordinary text).
export function linePlainText(input:string):string {
  let marker='\u0000';
  while(input.includes(marker))marker+='\u0000';
  const literals:string[]=[];
  const protect=(value:string)=>`${marker}${literals.push(value)-1}${marker}`;
  let text=input.replace(/\r\n?/g,'\n')
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,(_all,_fence,body:string)=>protect(body.replace(/\n$/,'')))
    .replace(/(`+)([^\n]*?)\1/g,(_all,_ticks,body:string)=>protect(body))
    .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g,(_all,value:string)=>protect(value))
    .replace(/!?\[([^\]\n]*)\]\((https?:\/\/(?:[^\s()]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g,
      (_all,label:string,url:string)=>label===url?protect(url):`${label}（${protect(url)}）`)
    .replace(/<(https?:\/\/[^>\s]+)>/g,(_all,url:string)=>protect(url))
    .replace(/https?:\/\/[^\s<>]+/g,(url:string,offset:number,source:string)=>{
      // A bold-wrapped bare link must keep its URL but not closing markup.
      for(const delimiter of ['**','__','~~'])if(source.slice(0,offset).endsWith(delimiter)&&url.endsWith(delimiter))
        return protect(url.slice(0,-delimiter.length))+delimiter;
      return protect(url);
    });
  text=text.split('\n').flatMap(line=>{
    if(/^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+\s*$/.test(line))return [];
    if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))return [];
    const heading=/^[ \t]{0,3}#{1,6}[ \t]+/.test(line);
    const content=heading?line.replace(/^[ \t]{0,3}#{1,6}[ \t]+/,'').replace(/[ \t]+#+[ \t]*$/,''):line;
    const stripped=content.replace(/^[ \t]*>+[ \t]?/,'').replace(/^[ \t]*[-+*][ \t]+/,'• ');
    return /^\s*\|.*\|\s*$/.test(stripped)?[stripped.trim().slice(1,-1).split('|').map(cell=>cell.trim()).join('　')]:[stripped];
  }).join('\n');
  for(let i=0;i<2;i++)text=text
    .replace(/\*\*([^\n]*?)\*\*/g,'$1').replace(/__([^\n]*?)__/g,'$1')
    .replace(/~~([^\n]*?)~~/g,'$1')
    .replace(/(?<!\*)\*(?!\s)([^*\n]*?\S)\*(?!\*)/g,'$1')
    .replace(/(?<![\p{L}\p{N}_])_(?!\s)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu,'$1');
  return text.split(marker).map((part,index)=>index%2?literals[Number(part)]??part:part).join('').trim();
}
