// GitHub device authorization: access tokens are used once for identity and never persisted.
const SESSION='__Host-synapse-session', CHALLENGE='__Host-synapse-github';
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const readCookie=(r,name)=>r.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const json=(data,status=200,cookies=[])=>{const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});for(const c of cookies)headers.append('Set-Cookie',c);return new Response(JSON.stringify(data),{status,headers});};
const error=(message,status=400)=>json({error:{message}},status);
export async function sessionUser(request,db){const token=readCookie(request,SESSION);if(!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT u.*, \'github\' AS auth_provider FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first();}
export async function githubConnection(db,userId){return !!await db.prepare('SELECT github_id FROM github_identities WHERE user_id=?').bind(userId).first();}
const safeWrite=r=>r.headers.get('Origin')===new URL(r.url).origin&&r.headers.get('Sec-Fetch-Site')!=='cross-site';
async function githubFetch(url,options,fetcher){return fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}
export async function handleGithubAuth(request,env,fetcher=fetch){
 const path=new URL(request.url).pathname,db=env.DB;
 if(path==='/auth/config'&&request.method==='GET')return json({github:!!env.GITHUB_CLIENT_ID});
 if(request.method!=='POST')return error('지원하지 않는 요청입니다.',405);
 if(!safeWrite(request))return error('같은 사이트에서 다시 시도해주세요.',403);
 try{
 if(path==='/auth/logout'){const token=readCookie(request,SESSION);if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();return json({ok:true},200,[cookie(SESSION,'',0),cookie(CHALLENGE,'',0)]);}
 if(path==='/auth/github/cancel'){const token=readCookie(request,CHALLENGE);if(token)await db.prepare('DELETE FROM github_challenges WHERE token_hash=?').bind(await digest(token)).run();return json({ok:true},200,[cookie(CHALLENGE,'',0)]);}
 if(!env.GITHUB_CLIENT_ID)return error('GitHub 로그인 앱 설정이 아직 완료되지 않았어요.',503);
 if(path==='/auth/github/start'){
  if(!request.headers.get('Content-Type')?.includes('application/json'))return error('JSON 요청이 필요합니다.',415);
  const body=await request.json();let linkUser=null;
  if(body.link){linkUser=(await sessionUser(request,db))?.id||request.headers.get('oai-authenticated-user-id');if(!linkUser)return error('기존 계정에 먼저 로그인해주세요.',401);if(!await db.prepare('SELECT id FROM users WHERE id=?').bind(linkUser).first())return error('지도를 먼저 불러와주세요.',401);}
  // One active browser challenge at a time; the cookie binds polling to its initiating browser.
  const old=readCookie(request,CHALLENGE);if(old)await db.prepare('DELETE FROM github_challenges WHERE token_hash=?').bind(await digest(old)).run();
  const r=await githubFetch('https://github.com/login/device/code',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID})},fetcher);const d=await r.json();
  if(!r.ok||!d.device_code||!d.user_code)return error('GitHub 기기 인증을 시작하지 못했어요. 앱의 Enable Device Flow 설정을 확인해주세요.',502);
  const token=random(),interval=Math.max(5,Number(d.interval)||5),expires=Math.min(900,Number(d.expires_in)||900),ts=Date.now();
  await db.batch([db.prepare('DELETE FROM github_challenges WHERE expires_at<?').bind(ts),db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(ts),db.prepare('INSERT INTO github_challenges (token_hash,device_code,link_user_id,expires_at,next_poll_at,interval_seconds) VALUES (?,?,?,?,?,?)').bind(await digest(token),d.device_code,linkUser,ts+expires*1000,ts+interval*1000,interval)]);
  return json({user_code:d.user_code,verification_uri:'https://github.com/login/device',expires_in:expires,interval},200,[cookie(CHALLENGE,token,expires)]);
 }
 if(path==='/auth/github/poll'){
  const token=readCookie(request,CHALLENGE);if(!token)return error('로그인을 다시 시작해주세요.',401);const key=await digest(token),ts=Date.now();
  const c=await db.prepare('SELECT * FROM github_challenges WHERE token_hash=? AND expires_at>?').bind(key,ts).first();if(!c)return error('인증 시간이 만료됐어요. 다시 시작해주세요.',401);
  if(c.next_poll_at>ts)return json({status:'pending',interval:Math.max(1,Math.ceil((c.next_poll_at-ts)/1000))});
  const gate=await db.prepare('UPDATE github_challenges SET next_poll_at=? WHERE token_hash=? AND next_poll_at=?').bind(ts+Math.max(20,c.interval_seconds)*1000,key,c.next_poll_at).run();if(!gate.meta.changes)return json({status:'pending',interval:c.interval_seconds});
  const r=await githubFetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,device_code:c.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'})},fetcher);const d=await r.json();
  if(d.error==='authorization_pending'||d.error==='slow_down'){const interval=c.interval_seconds+(d.error==='slow_down'?5:0);await db.prepare('UPDATE github_challenges SET next_poll_at=?,interval_seconds=? WHERE token_hash=?').bind(Date.now()+interval*1000,interval,key).run();return json({status:'pending',interval});}
  if(!r.ok||!d.access_token){await db.prepare('DELETE FROM github_challenges WHERE token_hash=?').bind(key).run();return error(d.error==='access_denied'?'GitHub에서 승인이 취소됐어요.':'GitHub 인증이 만료되었거나 실패했어요. 다시 시작해주세요.',401);}
  const profile=await githubFetch('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${d.access_token}`,'User-Agent':'Synapse','X-GitHub-Api-Version':'2022-11-28'}},fetcher);const gh=await profile.json();if(!profile.ok||!Number.isSafeInteger(gh.id)||gh.id<=0||typeof gh.login!=='string')return error('GitHub 계정을 확인하지 못했어요.',502);
  // Recheck cancellation after the network calls. A cancelled challenge cannot create a session.
  const active=await db.prepare('DELETE FROM github_challenges WHERE token_hash=? AND expires_at>? RETURNING token_hash').bind(key,Date.now()).first();if(!active)return error('취소되거나 만료된 인증입니다.',401);
  const identity=await db.prepare('SELECT * FROM github_identities WHERE github_id=?').bind(String(gh.id)).first();if(c.link_user_id&&identity&&identity.user_id!==c.link_user_id)return error('이 GitHub 계정은 다른 지식 공간에 연결되어 있어요. 기존 계정으로 로그인해주세요.',409);
  const userId=c.link_user_id||identity?.user_id||`github:${gh.id}`,name=String(gh.name||gh.login).slice(0,300);
  await db.batch([db.prepare('INSERT INTO users (id,name,created_at,demo_loaded) VALUES (?,?,?,0) ON CONFLICT(id) DO NOTHING').bind(userId,name,new Date().toISOString()),db.prepare('INSERT INTO github_identities (github_id,user_id,login,created_at) VALUES (?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET login=excluded.login').bind(String(gh.id),userId,gh.login,new Date().toISOString())]);
  const owner=await db.prepare('SELECT user_id FROM github_identities WHERE github_id=?').bind(String(gh.id)).first();if(owner.user_id!==userId)return error('다른 계정에 연결된 GitHub 계정입니다.',409);
  const session=random(),age=30*24*60*60;await db.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(session),userId,Date.now()+age*1000).run();
  return json({status:'authenticated',linked:!!c.link_user_id},200,[cookie(SESSION,session,age),cookie(CHALLENGE,'',0)]);
 }
 return error('경로를 찾을 수 없습니다.',404);
 }catch{return error('GitHub 연결을 처리하지 못했어요. 잠시 후 다시 시도해주세요.',502);}
}
