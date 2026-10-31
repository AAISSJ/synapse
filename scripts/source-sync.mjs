import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:'inherit'});
console.log('Ready for source credential JSON on stdin (input is hidden).');
const rl=createInterface({input:process.stdin,terminal:false});
for await(const line of rl){
  try {
    const {credential}=JSON.parse(line);
    const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
    if(credential.auth_mode!=='work_proxy') {
      env.GIT_CONFIG_COUNT='1';
      env.GIT_CONFIG_KEY_0=`http.${credential.remote_url}.extraHeader`;
      env.GIT_CONFIG_VALUE_0=`Authorization: Bearer ${credential.token}`;
    }
    const git=(args)=>{
      const r=spawnSync('git',args,{env,encoding:'utf8'});
      if(r.status!==0)throw new Error(`Git ${args[0]} failed: ${r.stderr.replaceAll(credential.token||'__absent__','[redacted]')}`);
      return r.stdout.trim();
    };
    const remotes=git(['remote']);
    git(remotes.split('\n').includes('origin')?['remote','set-url','origin',credential.remote_url]:['remote','add','origin',credential.remote_url]);
    git(['push','origin',`HEAD:${credential.branch}`]);
    console.log(JSON.stringify({commit_sha:git(['rev-parse','HEAD']),pushed:true}));
  }catch(error){console.error(error.message);process.exitCode=1;}
  break;
}
rl.close();
