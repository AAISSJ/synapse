import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { SQLiteD1 } from '../tests/d1.mjs';
import worker from '../dist/server/index.js';
mkdirSync('.sites-runtime',{recursive:true});
const DB = new SQLiteD1('.sites-runtime/dev.sqlite').migrate();
const server=createServer(async(req,res)=>{
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4173');
    const headers = new Headers(req.headers);
    // This server binds loopback only and is never included in the deployed Worker.
    headers.set('oai-authenticated-user-id','local_atlas');
    headers.set('oai-authenticated-user-full-name','Synapse');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const request=new Request(url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body})});
    const response=await worker.fetch(request,{DB},{});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error(error);res.writeHead(500);res.end('Local preview error');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Synapse local preview: http://127.0.0.1:4173'));
process.on('SIGINT',()=>server.close(()=>{DB.close();process.exit(0)}));
process.on('SIGTERM',()=>server.close(()=>{DB.close();process.exit(0)}));
