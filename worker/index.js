import { handleApi } from '../server/api.js';
import { js, css, cliZip, sourceZip } from '../.build/assets.js';
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f7f8f5"><meta name="description" content="Synapse — 개념을 연결하고, 시간과 함께 이해를 쌓는 나만의 지식 지도"><title>Synapse — 나의 지식 지도</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script src="/assets/app.js" defer></script></body></html>`;
export default {
  async fetch(request,env,ctx) {
    const path = new URL(request.url).pathname;
    try {
      if(path.startsWith('/api/')) return await handleApi(request,env);
      if(path==='/downloads/synapse-source.zip') return new Response(Uint8Array.from(atob(sourceZip),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="synapse-source.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      if(path==='/health') return Response.json({status:'ok',app:'synapse'});
      if(path==='/downloads/synapse-cli.zip'||path==='/downloads/atlas-cli.zip') return new Response(Uint8Array.from(atob(cliZip),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="synapse-cli.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"};
      if(path==='/assets/app.js') return new Response(js,{headers:{...security,'Content-Type':'application/javascript; charset=utf-8'}});
      if(path==='/assets/app.css') return new Response(css,{headers:{...security,'Content-Type':'text/css; charset=utf-8'}});
      if(path==='/') return new Response(html,{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
      return new Response('Not found',{status:404});
    } catch(error) {
      console.error('Synapse request failed',error?.name);
      return Response.json({error:{code:'INTERNAL_ERROR',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'}},{status:500,headers:{'Cache-Control':'no-store'}});
    }
  }
};
