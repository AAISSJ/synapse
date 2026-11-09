export const imageTypes=['image/png','image/jpeg','image/webp','image/gif'];
export function imageMarkdown(image){const alt=(image.filename||'이미지').replace(/[\[\]\\\r\n]/g,' ').slice(0,100);return `![${alt}](${image.url})`;}
export async function uploadImage(file,signal){
 if(!imageTypes.includes(file.type))throw Error('PNG·JPG·WebP·GIF 이미지만 첨부할 수 있어요.');
 if(file.size>5*1024*1024)throw Error('이미지는 장당 5MB까지 첨부할 수 있어요.');
 const r=await fetch('/api/v1/images',{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name||'image')},body:file,signal});
 const data=await r.json();if(!r.ok)throw Error(data.error?.message||'이미지를 업로드하지 못했어요.');return data;
}
export const localImageUrl=src=>/^\/api\/v1\/images\/image_[a-f0-9]{32}$/.test(src||'');
