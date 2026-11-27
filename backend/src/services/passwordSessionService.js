'use strict';

async function isPasswordSessionCurrent(claims) {
  if (!claims.userId || claims.userId === 'super_admin') return true;

  const User = require('../models/userModel');
  const user = await User.findById(claims.userId);
  if (!user || user.isActive === false) return false;

  const changedAt = user.passwordChangedAt?.getTime() ?? 0;
  if (claims.passwordVersion !== undefined) return claims.passwordVersion === changedAt;
  return changedAt === 0 || Number(claims.iat) * 1000 >= changedAt;
}

module.exports = { isPasswordSessionCurrent };
