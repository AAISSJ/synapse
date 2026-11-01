import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), name: text('name').notNull(), createdAt: text('created_at').notNull(),
  demoLoaded: integer('demo_loaded').notNull().default(0),
});
export const concepts = sqliteTable('concepts', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(), aliases: text('aliases').notNull().default('[]'),
  category: text('category').notNull().default('일반'), color: text('color').notNull().default('#2c7168'),
  x: real('x').notNull().default(0), y: real('y').notNull().default(0),
  description: text('description').notNull().default(''), createdAt: text('created_at').notNull(),
  revision: integer('revision').notNull().default(0),
}, t => [index('concepts_user_idx').on(t.userId)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull().default(''), content: text('content').notNull().default(''),
  url: text('url').notNull().default(''), recordedAt: text('recorded_at').notNull(),
  subjectPeriod: text('subject_period').notNull().default(''), source: text('source').notNull().default('web'),
}, t => [index('entries_user_idx').on(t.userId)]);
export const entryConcepts = sqliteTable('entry_concepts', {
  entryId: text('entry_id').notNull().references(() => entries.id),
  conceptId: text('concept_id').notNull().references(() => concepts.id),
}, t => [primaryKey({columns: [t.entryId, t.conceptId]})]);
export const relations = sqliteTable('relations', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  sourceId: text('source_id').notNull().references(() => concepts.id),
  targetId: text('target_id').notNull().references(() => concepts.id),
  type: text('type').notNull().default('관련됨'),
}, t => [uniqueIndex('relations_unique').on(t.userId, t.sourceId, t.targetId, t.type)]);
export const summaryRevisions = sqliteTable('summary_revisions', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  conceptId: text('concept_id').notNull().references(() => concepts.id), revision: integer('revision').notNull(),
  payload: text('payload').notNull(), generatedAt: text('generated_at').notNull(),
}, t => [uniqueIndex('summary_concept_revision').on(t.conceptId, t.revision)]);
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  conceptId: text('concept_id').notNull().references(() => concepts.id), revision: integer('revision').notNull(),
  status: text('status').notNull().default('pending'), attempts: integer('attempts').notNull().default(0),
  workerId: text('worker_id'), leaseToken: text('lease_token'), leaseUntil: text('lease_until'),
  error: text('error'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('jobs_concept_revision').on(t.conceptId, t.revision), index('jobs_user_status').on(t.userId, t.status)]);
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(), tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('token_hash_unique').on(t.tokenHash)]);
export const idempotency = sqliteTable('idempotency', {
  userId: text('user_id').notNull().references(() => users.id), key: text('key').notNull(),
  requestHash: text('request_hash').notNull(), entryId: text('entry_id').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [primaryKey({columns: [t.userId, t.key]})]);

export const agentThreads = sqliteTable('agent_threads', {
 id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>users.id),title:text('title').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('agent_threads_user').on(t.userId)]);
export const agentRequests = sqliteTable('agent_requests', {
 id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>users.id),threadId:text('thread_id').notNull().references(()=>agentThreads.id),clientId:text('client_id').notNull(),prompt:text('prompt').notNull(),status:text('status').notNull().default('pending'),reply:text('reply').notNull().default(''),resultJson:text('result_json'),error:text('error'),workerId:text('worker_id'),leaseToken:text('lease_token'),leaseUntil:text('lease_until'),attempts:integer('attempts').notNull().default(0),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('agent_request_client').on(t.userId,t.clientId),index('agent_requests_user_status').on(t.userId,t.status),index('agent_requests_thread').on(t.threadId)]);
