'use strict';

const mongoose = require('mongoose');

const version = '034_seed_student_class_history';

async function up() {
  const students = mongoose.connection.collection('students');
  await students.updateMany(
    { class: { $type: 'string', $ne: '' }, 'classHistory.0': { $exists: false } },
    [{
      $set: {
        classHistory: [{
          class: '$class',
          from: { $ifNull: ['$createdAt', { $convert: { input: '$_id', to: 'date', onError: new Date(0) } }] },
          to: null,
          assignedBy: null,
        }],
      },
    }],
  );
}

async function down() {
  // Class history contains promotion records after rollout. Keep that data
  // during rollback so older application versions can use the class field.
}

module.exports = { version, up, down };
