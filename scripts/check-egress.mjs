import net from 'node:net';
const socket=net.connect({host:'1.1.1.1',port:443});
socket.setTimeout(3000);
socket.on('connect',()=>{console.error('FAIL: external TCP connection unexpectedly allowed');socket.destroy();process.exitCode=1;});
socket.on('error',()=>console.log('PASS: external TCP blocked'));
socket.on('timeout',()=>{console.log('PASS: external TCP timed out');socket.destroy();});
