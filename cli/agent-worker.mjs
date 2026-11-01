import {planGraph} from './graph-planner.mjs';import {redact} from './api.mjs';
export async function runAgentOnce(api,config,workerId,{planner=planGraph,signal}={}){
 let result;try{result=await api('/agent/claim',{method:'POST',body:{worker_id:workerId},signal});}catch(e){if(/API 404/.test(e.message))return false;throw e;}
 const request=result.request;if(!request)return false;
 process.stderr.write('그래프 구성 시작\n');
 try{const plan=await planner(request,{signal});await api(`/agent/requests/${encodeURIComponent(request.id)}/complete`,{method:'POST',body:{lease_token:request.lease_token,plan},signal});process.stderr.write('그래프 구성 완료\n');return true;}
 catch(e){const detail=redact(e.message||'그래프 생성 실패',config).slice(0,1200);try{await api(`/agent/requests/${encodeURIComponent(request.id)}/fail`,{method:'POST',body:{lease_token:request.lease_token,error:detail}});}catch{}if(signal?.aborted)return true;throw new Error(detail);}
}
