// Local preview only. Production uses the Sites-provisioned R2 BUCKET binding.
import {mkdir,writeFile,readFile,unlink,stat} from 'node:fs/promises';import {join} from 'node:path';
export class LocalBucket{
 constructor(root){this.root=root;}
 path(key){return join(this.root,Buffer.from(key).toString('hex'));}
 async put(key,value){await mkdir(this.root,{recursive:true});await writeFile(this.path(key),new Uint8Array(value));return{};}
 async get(key){try{return{body:new Blob([await readFile(this.path(key))]).stream()};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async head(key){try{await stat(this.path(key));return{};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async delete(key){try{await unlink(this.path(key));}catch(e){if(e.code!=='ENOENT')throw e;}}
}
