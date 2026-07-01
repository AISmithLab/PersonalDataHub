import { createGuiRoutes } from './dist/gateway/gui/routes.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const mockStore = {
  getSettings: () => ({}), setSettings: () => {},
  listSkills: () => [], insertSkill: () => {}, updateSkill: () => {}, activateSkill: () => {}, deleteSkill: () => {},
  getSources: () => [], getSource: () => null, upsertSource: () => {},
  getFilter: () => null, getFilters: () => [], upsertFilter: () => {},
  getActions: () => [], getAction: () => null, insertAction: () => {}, updateAction: () => {},
  getAuditLog: () => [], insertAuditEntry: () => {},
  getMemories: () => [], insertMemory: () => {}, updateMemory: () => {}, deleteMemory: () => {},
  getUsers: () => [], upsertUser: () => ({ id: 'u1' }), getUser: () => null, listUsers: () => [],
  getSessions: () => [], upsertSession: () => {}, deleteSession: () => {},
  getSessionByToken: () => ({ user_id: 'u1', expires_at: new Date(Date.now() + 86400000).toISOString() }),
  insertGithubRepo: () => {}, getGithubRepos: () => [], updateGithubRepo: () => {},
};

const app = new Hono();
app.route('/', createGuiRoutes({ store: mockStore, hub: '/tmp' }));
serve({ fetch: app.fetch, port: 3097 }, () => console.log('OK:3097'));
