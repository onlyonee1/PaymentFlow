'use strict';

function activeFeeFilter(at = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ activeFrom: null }, { activeFrom: { $lte: at } }] },
      { $or: [{ activeTo: null }, { activeTo: { $gt: at } }] },
    ],
  };
}

function feeScheduleFields(body, previous = {}) {
  const fields = {};
  function invalid(message) {
    return Object.assign(new Error(message), { code: 'VALIDATION_ERROR', status: 400 });
  }

  for (const name of ['activeFrom', 'activeTo']) {
    if (body[name] === undefined) continue;
    if (body[name] === null || body[name] === '') {
      fields[name] = null;
      continue;
    }
    const value = body[name];
    const date = new Date(typeof value === 'string' ? value : NaN);
    if (!Number.isFinite(date.getTime())) throw invalid(`${name} must be a valid date`);
    fields[name] = date;
  }

  const from = fields.activeFrom === undefined ? previous.activeFrom : fields.activeFrom;
  const to = fields.activeTo === undefined ? previous.activeTo : fields.activeTo;
  if (from && to && from >= to) throw invalid('activeTo must be later than activeFrom');
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw invalid('isActive must be a boolean');
    fields.isActive = body.isActive;
  }
  return fields;
}

module.exports = { activeFeeFilter, feeScheduleFields };
