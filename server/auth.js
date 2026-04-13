const jwt = require('jsonwebtoken');
const { getDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sanitizeUser(user) {
  return {
    id: user.id,
    displayName: user.name,
    name: user.name,
    email: user.email,
    role: user.role,
    isBanned: Boolean(user.is_banned),
    bannedAt: user.banned_at || null,
    bannedReason: user.banned_reason || null,
  };
}

function generateToken(user) {
  return jwt.sign(sanitizeUser(user), JWT_SECRET, { expiresIn: '7d' });
}

function resolveAuthenticatedUser(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  const db = getDb();
  const user = db
    .prepare('SELECT id, name, email, role, is_banned, banned_at, banned_reason FROM users WHERE id = ?')
    .get(payload.id);

  if (!user || user.is_banned) {
    return null;
  }

  return sanitizeUser(user);
}

function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = resolveAuthenticatedUser(token);
  } catch (_err) {
    req.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = resolveAuthenticatedUser(token);
    if (!req.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permission' });
    }

    return next();
  };
}

module.exports = {
  generateToken,
  sanitizeUser,
  optionalAuth,
  requireAuth,
  requireRole,
};
