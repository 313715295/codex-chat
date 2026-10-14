// Phase 1: discovery only. No callback is accepted and no secret is retained.
export const events = [{
 name: 'review.submitted',
 description: 'Discovery preview: a synthetic test record was submitted for an exact taskId and revision. Subscription delivery is not enabled yet; attempts fail explicitly. Existing result read/write tools remain available.',
 delivery: ['webhook'],
 inputSchema: {type:'object',properties:{taskId:{type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'},revision:{type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'}},required:['taskId','revision'],additionalProperties:false},
 payloadSchema:{type:'object',properties:{taskId:{type:'string'},revision:{type:'string'},receipt:{type:'string'}},required:['taskId','revision','receipt'],additionalProperties:false}
}];
