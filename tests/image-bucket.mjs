export class MemoryBucket{
 constructor(){this.objects=new Map();}
 async put(key,value,options){const bytes=new Uint8Array(value);this.objects.set(key,{bytes,options});return{};}
 async get(key){const object=this.objects.get(key);return object?{body:new Blob([object.bytes]).stream()}:null;}
 async head(key){return this.objects.has(key)?{}:null;}
 async delete(key){this.objects.delete(key);}
}
