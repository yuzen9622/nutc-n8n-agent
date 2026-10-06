import {DdddOcr} from 'ddddocr-node';
// OCR uses packaged local models only. Never enable library debug/image output.
globalThis.fetch=async()=>{throw new Error('OCR_NETWORK_DISABLED');};
process.once('message',async(message:unknown)=>{
 try{
  if(typeof message!=='string')throw new Error();
  const image=Buffer.from(message,'base64');
  // SAFETY: ddddocr-node 2.3.0 accepts Buffer at runtime; its declaration omits
  // that overload. Both four- and five-character school images are verified live.
  const ocr=new DdddOcr() as unknown as {classification(image:Buffer):Promise<string>};
  const code=String(await ocr.classification(image)).trim();
  process.send?.({code:/^[A-Za-z0-9]{4,5}$/.test(code)?code:''});
 }catch{process.send?.({error:'OCR_FAILED'});}
});
