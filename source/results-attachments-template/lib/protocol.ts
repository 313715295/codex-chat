export const keySchema = {type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'};
export const tools = [
 {name:'submit_review',description:'Save a synthetic Codex–Chat test result. This WRITE stores text only; it cannot edit project files, send chat messages, or wake Codex. Use the exact agreed taskId and revision. Identical retries return the same receipt; changed text for the same key is rejected. No real project data or secrets. result limit: 1048576 UTF-8 bytes.',inputSchema:{type:'object',properties:{taskId:keySchema,revision:keySchema,result:{type:'string',minLength:1,maxLength:1048576}},required:['taskId','revision','result'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'get_review',description:'Read the complete stored synthetic review result by exact taskId and revision for the signed-in user. Returns not_found if not submitted. This does not read Chat conversation history, inspect files, or wake Codex.',inputSchema:{type:'object',properties:{taskId:keySchema,revision:keySchema},required:['taskId','revision'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
export function validate(name:string, args:unknown): args is {taskId:string;revision:string;result:string} {
 if (!args || typeof args!=='object' || Array.isArray(args)) return false;
 const a=args as Record<string,unknown>; const write=name==='submit_review';
 const allowed=write?['taskId','revision','result']:['taskId','revision'];
 if(Object.keys(a).some(k=>!allowed.includes(k)) || allowed.some(k=>!(k in a))) return false;
 const key=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
 if(typeof a.taskId!=='string'||!key.test(a.taskId)||typeof a.revision!=='string'||!key.test(a.revision))return false;
 return !write || (typeof a.result==='string'&&a.result.length>0&&new TextEncoder().encode(a.result).length<=1048576);
}
