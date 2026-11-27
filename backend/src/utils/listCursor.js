'use strict';

const crypto = require('crypto');

const CURSOR_TTL_MS = 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

function cursorError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_CURSOR', status: 400 });
}

function sign(data) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for cursor signing');

  const key = crypto.createHmac('sha256', secret).update('PaymentFlow/list-cursor/v1').digest();
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

function fingerprint(scope, filters) {
  const data = JSON.stringify([scope, filters], (_key, value) => (
    value instanceof RegExp ? { source: value.source, flags: value.flags } : value
  ));
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encodeListCursor(record, scope, filters, direction, timestamp = 'createdAt') {
  const data = Buffer.from(JSON.stringify({
    id: String(record._id),
    ts: new Date(record[timestamp]).toISOString(),
    schoolId: filters.schoolId == null ? null : String(filters.schoolId),
    fingerprint: fingerprint(scope, filters),
    direction,
    expiresAt: Date.now() + CURSOR_TTL_MS,
  })).toString('base64url');

  return `${data}.${sign(data)}`;
}

function decodeListCursor(token, scope, filters) {
  if (typeof token !== 'string' || token.length > 2048 || !TOKEN_FORMAT.test(token)) {
    throw cursorError('Cursor is malformed');
  }

  const [data, signature] = token.split('.');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(data)))) {
    throw cursorError('Cursor signature is invalid');
  }

  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (payload.expiresAt <= Date.now()) throw cursorError('Cursor has expired');
  if (payload.schoolId !== (filters.schoolId == null ? null : String(filters.schoolId)) ||
      payload.fingerprint !== fingerprint(scope, filters)) {
    throw cursorError('Cursor does not match the current tenant or filters');
  }
  if (!/^[a-f\d]{24}$/i.test(payload.id) || !Number.isFinite(Date.parse(payload.ts)) ||
      !['next', 'prev'].includes(payload.direction)) {
    throw cursorError('Cursor position is invalid');
  }
  return payload;
}

async function paginateList({ find, scope, filter, cursor, limit, timestamp = 'createdAt' }) {
  const position = cursor == null ? null : decodeListCursor(cursor, scope, filter);
  const backwards = position?.direction === 'prev';
  const order = backwards ? 1 : -1;
  let query = filter;
  if (position) {
    const operator = backwards ? '$gt' : '$lt';
    const date = new Date(position.ts);
    query = {
      ...filter,
      $and: [
        ...(filter.$and || []),
        { $or: [
          { [timestamp]: { [operator]: date } },
          { [timestamp]: date, _id: { [operator]: position.id } },
        ] },
      ],
    };
  }

  const results = await find(query).sort({ [timestamp]: order, _id: order }).limit(limit + 1);
  const extra = results.length > limit;
  const items = results.slice(0, limit);
  if (backwards) items.reverse();

  const hasMore = backwards ? Boolean(items.length) : extra;
  const hasPrevious = backwards ? extra : Boolean(position && items.length);
  return {
    items,
    pagination: {
      limit,
      nextCursor: hasMore ? encodeListCursor(items[items.length - 1], scope, filter, 'next', timestamp) : null,
      prevCursor: hasPrevious ? encodeListCursor(items[0], scope, filter, 'prev', timestamp) : null,
      hasMore,
    },
  };
}

module.exports = { paginateList, encodeListCursor, decodeListCursor, CURSOR_TTL_MS };
