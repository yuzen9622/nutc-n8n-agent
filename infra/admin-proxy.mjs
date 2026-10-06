import net from 'node:net';
// Fixed TCP forwarding only: no CONNECT, arbitrary destinations or external clients.
const server=net.createServer(client=>{
  const upstream=net.connect({host:'n8n',port:5678});
  client.pipe(upstream);upstream.pipe(client);
  client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());
  client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
  client.setTimeout(300_000,()=>client.destroy());
});
server.listen(5678,'0.0.0.0');
