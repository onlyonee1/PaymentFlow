'use strict';

function classAssignment(className, from, assignedBy = null) {
  return { class: className, from, to: null, assignedBy };
}

function getClassHistory(student) {
  if (student.classHistory?.length) return student.classHistory;
  if (!student.class) return [];

  const from = student.createdAt ?? student._id?.getTimestamp?.() ?? new Date(0);
  return [classAssignment(student.class, from)];
}

function classAtDate(student, date) {
  if (!student) return null;
  return getClassHistory(student).findLast(({ from, to }) =>
    new Date(from) <= date && (to == null || date < new Date(to))
  )?.class ?? null;
}

module.exports = { classAssignment, getClassHistory, classAtDate };
