import { fixtures } from './media-fixtures';
export const mediaTools=['image','audio'].map(type=>({
 name:`read_test_${type}`,
 description:`Return one fixed synthetic ${type} fixture as a native MCP ${type} content block. Describe only what you actually perceive. If the client shows only metadata or an inaccessible reference, say so. Do not infer contents from the tool name. No project files or answer hints are returned.`,
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
}));
export function readTestMedia(name:string,args:unknown) {
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return {content:[{type:'text',text:'Empty arguments required.'}],isError:true};
 const type=name==='read_test_image'?'image':'audio';const fixture=fixtures[type];
 return {content:[{type,data:fixture.data,mimeType:fixture.mimeType}]};
}
