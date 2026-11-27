'use strict';

const FeeStructure = require('../models/feeStructureModel');
const { activeFeeFilter } = require('../utils/feeSchedule');
const logger = require('../utils/logger');

let timer;
let refreshing = false;

async function refreshFeeActivation() {
  if (refreshing) return;
  refreshing = true;
  try {
    const active = { ...activeFeeFilter(), deletedAt: null };
    await FeeStructure.updateMany(
      { ...active, isCurrentlyActive: { $ne: true } },
      { $set: { isCurrentlyActive: true } },
      { _bypassTenantScope: true },
    );
    await FeeStructure.updateMany(
      { $nor: [active], isCurrentlyActive: { $ne: false } },
      { $set: { isCurrentlyActive: false } },
      { _bypassTenantScope: true },
    );
  } catch (err) {
    logger.error('Fee activation refresh failed', { error: err.message });
  } finally {
    refreshing = false;
  }
}

function startFeeActivationScheduler() {
  if (timer) return;
  void refreshFeeActivation();
  timer = setInterval(refreshFeeActivation, 3600000);
  timer.unref();
}

function stopFeeActivationScheduler() {
  clearInterval(timer);
  timer = null;
}

module.exports = { startFeeActivationScheduler, stopFeeActivationScheduler };
