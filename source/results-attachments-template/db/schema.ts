import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';
export const reviews = sqliteTable('reviews', {
  userId: text('user_id').notNull(),
  taskId: text('task_id').notNull(),
  revision: text('revision').notNull(),
  result: text('result').notNull(),
  receipt: text('receipt').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.taskId, table.revision] })]);
