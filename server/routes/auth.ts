import { Router } from 'express';
import { db } from '../db.js';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  createSessionToken,
  extractSessionFromRequest,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../middleware/auth.js';

export const authRouter = Router();

authRouter.get('/status', async (req, res) => {
  try {
    const countRow = await db('users').count<{ count: number }[]>('id as count').first();
    const userCount = Number(countRow?.count ?? 0);
    const needsSetup = userCount === 0;

    if (needsSetup) {
      res.json({ needsSetup: true, authenticated: false, user: null });
      return;
    }

    const { payload } = extractSessionFromRequest(req);
    if (!payload) {
      res.json({ needsSetup: false, authenticated: false, user: null });
      return;
    }

    res.json({
      needsSetup: false,
      authenticated: true,
      user: { id: payload.userId, username: payload.username },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

authRouter.post('/setup', async (req, res) => {
  try {
    const countRow = await db('users').count<{ count: number }[]>('id as count').first();
    if (Number(countRow?.count ?? 0) > 0) {
      res.status(403).json({ error: 'Account has already been initialized' });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (username.length < 2 || username.length > 64) {
      res.status(400).json({ error: 'Username must be between 2 and 64 characters' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [userId] = await db('users').insert({
      username,
      password_hash: passwordHash,
    });

    const token = createSessionToken(userId, username);
    setSessionCookie(req, res, token);
    res.status(201).json({
      token,
      user: { id: userId, username },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await db('users').where('username', username).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = createSessionToken(user.id, user.username);
    setSessionCookie(req, res, token);
    res.json({
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (newPassword.length < 4) {
      res.status(400).json({ error: 'New password must be at least 4 characters' });
      return;
    }

    const user = await db('users').where('id', req.user!.userId).first();
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db('users')
      .where('id', user.id)
      .update({ password_hash: passwordHash, updated_at: db.fn.now() });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
