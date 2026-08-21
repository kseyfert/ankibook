import { Hono } from 'hono';
import { createUser, listUsers } from '../../library/users.js';

export const users = new Hono();

users.get('/', (c) => c.json({ users: listUsers() }));

users.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  try {
    const name = createUser(body.name ?? '');
    return c.json({ name, users: listUsers() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
