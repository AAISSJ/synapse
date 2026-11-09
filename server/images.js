export const MAX_IMAGE_BYTES=5*1024*1024;
const signatures={
 'image/png':b=>b.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v),
 'image/jpeg':b=>b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255,
 'image/gif':b=>b.length>=13&&['GIF87a','GIF89a'].includes(new TextDecoder().decode(b.slice(0,6))),
 'image/webp':b=>b.length>=16&&new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP',
};
export async function routeImages(request,env,user,path,method,{fail,response}){
 const match=path.match(/^\/images\/(image_[a-f0-9]{32})$/);
 if(path!=='/images'&&!match)return null;
 if(!env.BUCKET)fail(503,'image_storage_unavailable','이미지 저장소가 아직 준비되지 않았습니다.');
 const db=env.DB;
 if(path==='/images'&&method==='POST'){
  const mime=(request.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!signatures[mime])fail(415,'unsupported_image','PNG·JPG·WebP·GIF 이미지만 첨부할 수 있어요.');
  if(Number(request.headers.get('content-length'))>MAX_IMAGE_BYTES)fail(413,'image_too_large','이미지는 장당 5MB까지 첨부할 수 있어요.');
  const reader=request.body?.getReader();if(!reader)fail(400,'empty_image','이미지 파일을 선택해주세요.');
  const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_IMAGE_BYTES){await reader.cancel();fail(413,'image_too_large','이미지는 장당 5MB까지 첨부할 수 있어요.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  if(!signatures[mime](bytes))fail(415,'invalid_image','이미지 파일의 형식과 내용이 일치하지 않아요.');
  let name='image';try{name=decodeURIComponent(request.headers.get('x-file-name')||'image').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||'image';}catch{fail(400,'invalid_filename','파일 이름을 확인해주세요.');}
  const id='image_'+crypto.randomUUID().replaceAll('-',''),key='images/'+user.id+'/'+id,created=new Date().toISOString();
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}});
  try{await db.prepare('INSERT INTO images (id,user_id,object_key,filename,mime,size,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,user.id,key,name,mime,size,created).run();}catch(e){await env.BUCKET.delete(key).catch(()=>{});throw e;}
  return response({id,url:'/api/v1/images/'+id,filename:name,mime,size,created_at:created},201);
 }
 if(match&&['GET','HEAD','DELETE'].includes(method)){
  const image=await db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').bind(match[1],user.id).first();if(!image)fail(404,'image_not_found','이미지를 찾을 수 없어요.');
  if(method==='DELETE'){await env.BUCKET.delete(image.object_key);await db.prepare('DELETE FROM images WHERE id=? AND user_id=?').bind(image.id,user.id).run();return response({deleted:true});}
  const object=method==='HEAD'?await env.BUCKET.head(image.object_key):await env.BUCKET.get(image.object_key);if(!object)fail(404,'image_not_found','이미지를 찾을 수 없어요.');
  return new Response(method==='HEAD'?null:object.body,{headers:{'Content-Type':image.mime,'Content-Length':String(image.size),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(image.filename),'Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 fail(405,'method_not_allowed','지원하지 않는 이미지 요청입니다.');
}
