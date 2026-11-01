import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export async function cliArchive() {
  const target=resolve('.build/synapse-cli');
  await rm(target,{recursive:true,force:true});
  await mkdir(target,{recursive:true});
  await cp('cli',`${target}/cli`,{recursive:true,filter:p=>!p.endsWith('.test.mjs')});
  await cp('shared',`${target}/shared`,{recursive:true});
  await cp('CLI_README.md',`${target}/README.md`);
  await cp('Dockerfile.worker',`${target}/Dockerfile.worker`);
  // Keep the full lockfile compatible with npm ci in the worker image.
  await cp('package.json',`${target}/package.json`);
  await cp('package-lock.json',`${target}/package-lock.json`);
  const archive=resolve('.build/synapse-cli.zip');
  await rm(archive,{force:true});
  const zipped=spawnSync('zip',['-qr',archive,'.'],{cwd:target,encoding:'utf8'});
  if(zipped.status!==0)throw new Error('CLI archive could not be built');
  return (await readFile(archive)).toString('base64');
}
