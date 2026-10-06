import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

// Only bytes received over IPC are opened. No viewer, scripts, attachments or URLs.
process.once('message',async(value:unknown)=>{
  let task:ReturnType<typeof getDocument>|undefined;
  try{
    if(typeof value!=='string'||value.length>1400000)throw Error('invalid input');
    const bytes=Buffer.from(value,'base64');
    if(bytes.length>1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('invalid PDF');
    task=getDocument({data:new Uint8Array(bytes),disableFontFace:true,
      useSystemFonts:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,
      stopAtErrors:true,verbosity:0});
    const document=await task.promise;
    if(document.numPages<1||document.numPages>30)throw Error('page limit');
    const pages:{page:number;text:string}[]=[];
    let size=0;
    for(let page=1;page<=document.numPages;page++){
      const current=await document.getPage(page);
      const content=await current.getTextContent();
      const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('')
        .replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').trim();
      size+=Buffer.byteLength(text);
      // Empty/image-only pages require OCR review; never silently omit a page.
      if(text.length<10||text.includes('\uFFFD')||size>120000)throw Error('unreadable text');
      pages.push({page,text});current.cleanup();
    }
    await task.destroy();task=undefined;
    process.send?.({pages});
  }catch{process.send?.({error:'SOURCE_PDF_UNREADABLE'});}
  finally{await task?.destroy();process.disconnect?.();}
});
