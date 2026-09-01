const jwt = require('jsonwebtoken');
require('dotenv').config();

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

const { ApprovalRule } = require('../models');

async function analyticsScope(req, res, next) {
  try {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'officer')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const rules = await ApprovalRule.findAll({
      attributes: ['department'],
      group: ['department']
    });

    const canonicalDepts = new Set();
    for (const rule of rules) {
      if (rule.department && rule.department.trim() !== '') {
        canonicalDepts.add(rule.department.trim());
      }
    }

    const queryDept = req.query.department;

    if (req.user.role === 'admin') {
      if (queryDept === undefined || queryDept === null) {
        req.analyticsScope = { department: null };
        return next();
      }
      const trimmedQuery = String(queryDept).trim();
      if (!canonicalDepts.has(trimmedQuery)) {
        return res.status(400).json({ error: 'Unknown or invalid department' });
      }
      req.analyticsScope = { department: trimmedQuery };
      return next();
    }

    if (req.user.role === 'officer') {
      const userDept = req.user.department;
      if (userDept === undefined || userDept === null || String(userDept).trim() === '') {
        return res.status(403).json({ error: 'Officer has no assigned department' });
      }
      const trimmedUserDept = String(userDept).trim();
      if (!canonicalDepts.has(trimmedUserDept)) {
        return res.status(403).json({ error: 'Officer department is not a recognized canonical department' });
      }

      if (queryDept !== undefined && queryDept !== null) {
        const trimmedQuery = String(queryDept).trim();
        if (trimmedQuery !== trimmedUserDept) {
          return res.status(403).json({ error: 'Cannot query analytics outside assigned department' });
        }
      }

      req.analyticsScope = { department: trimmedUserDept };
      return next();
    }
  } catch (err) {
    console.error('[analyticsScope] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { authenticate, authorize, analyticsScope };
