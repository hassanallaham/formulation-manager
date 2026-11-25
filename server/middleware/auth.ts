import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SESSION_COOKIE_NAME = 'formulab_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// In-memory runtime fallback if SESSION_SECRET is not provided in env
const SIGNING_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export interface SessionPayload {
  userId: number;
  username: string;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: SessionPayload;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuffer = Buffer.from(keyHex, 'hex');

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== keyBuffer.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, keyBuffer));
    });
  });
}

export function createSessionToken(userId: number, username: string): string {
  const payload: SessionPayload = {
    userId,
    username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || typeof parsed.userId !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isHttps) {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  } else {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
  });
}

export function extractSessionFromRequest(req: Request): {
  payload: SessionPayload | null;
  viaCookie: boolean;
} {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifySessionToken(token);
    if (payload) return { payload, viaCookie: false };
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    const payload = verifySessionToken(cookieToken);
    if (payload) return { payload, viaCookie: true };
  }

  return { payload: null, viaCookie: false };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const { payload, viaCookie } = extractSessionFromRequest(req);
  if (!payload) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // CSRF check for cookie-authenticated mutations
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const xrw = req.headers['x-requested-with'];
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;

    if (!xrw && origin) {
      try {
        const originHost = new URL(origin).host;
        if (host && originHost !== host) {
          res.status(403).json({ error: 'Invalid request origin' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid request origin' });
        return;
      }
    }
  }

  req.user = payload;
  next();
}
