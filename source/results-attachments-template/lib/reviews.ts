import { env } from 'cloudflare:workers';
function db() { if (!env.DB) throw new Error('STORAGE_UNAVAILABLE'); return env.DB; }
export async function getReview(user: string, taskId: string, revision: string) {
  return db().prepare('SELECT task_id AS taskId, revision, result, receipt, created_at AS createdAt FROM reviews WHERE user_id = ? AND task_id = ? AND revision = ?').bind(user, taskId, revision).first<{taskId:string;revision:string;result:string;receipt:string;createdAt:string}>();
}
export async function submitReview(user: string, taskId: string, revision: string, result: string) {
  await db().prepare('INSERT INTO reviews (user_id, task_id, revision, result, receipt, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, task_id, revision) DO NOTHING').bind(user, taskId, revision, result, crypto.randomUUID(), new Date().toISOString()).run();
  const row = await getReview(user, taskId, revision);
  if (!row) throw new Error('STORAGE_UNAVAILABLE');
  if (row.result !== result) return {status: 'conflict', message: 'This task and revision already have a different result. Existing result was not modified.'};
  return {status: 'stored', taskId, revision, receipt: row.receipt, createdAt: row.createdAt};
}
