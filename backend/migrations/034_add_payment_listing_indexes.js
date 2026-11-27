'use strict';

const mongoose = require('mongoose');

const VERSION = '034_add_payment_listing_indexes';
const indexes = [
  ['payments', { schoolId: 1, status: 1, createdAt: -1, _id: -1 }, { name: 'payment_status_listing_idx' }],
  ['payments', { schoolId: 1, createdAt: -1, _id: -1 }, { name: 'payment_history_listing_idx' }],
  ['payments', { studentId: 1, schoolId: 1 }, { name: 'payment_student_school_idx' }],
  ['payments', { memoHash: 1 }, {
    name: 'payment_memo_hash_idx',
    unique: true,
    partialFilterExpression: { memoHash: { $type: 'string' } },
  }],
  ['outboxes', { processed: 1, deadLettered: 1, scheduledAfter: 1 }, { name: 'outbox_retry_schedule_idx' }],
];

async function up() {
  for (const [collection, key, options] of indexes) {
    await mongoose.connection.db.collection(collection).createIndex(key, options);
  }
}

async function down() {
  for (const [collection, , { name }] of indexes) {
    try {
      await mongoose.connection.db.collection(collection).dropIndex(name);
    } catch (err) {
      if (err.code !== 26 && err.code !== 27) throw err;
    }
  }
}

module.exports = { version: VERSION, up, down };
