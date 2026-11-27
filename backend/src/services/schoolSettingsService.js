'use strict';

const School = require('../models/schoolModel');
const SystemConfig = require('../models/systemConfigModel');
const schoolCache = require('./schoolCacheInvalidator');

const SETTING_KEYS = new Set([
  'maxSyncBatchSize',
  'reminderEnabled',
  'reminderIntervalMs',
  'maintenanceMode',
  'betaFeatures',
]);

const SYSTEM_CONFIG_MAP = {
  maxSyncBatchSize: 'maxSyncBatchSize',
  reminderEnabled: 'reminderEnabled',
  reminderIntervalMs: 'reminderIntervalMs',
  maintenanceMode: 'maintenanceMode',
};

const DEFAULTS = {
  maxSyncBatchSize: 20,
  reminderEnabled: true,
  reminderIntervalMs: 86400000,
  maintenanceMode: false,
  betaFeatures: [],
};

/**
 * Retrieves school setting from schoolSettingsService.
 * @param {string} schoolId - Value used by getSchoolSetting.
 * @param {string} key - Value used by getSchoolSetting.
 * @returns {Promise<*>} Result produced by getSchoolSetting.
 */
async function getSchoolSetting(schoolId, key) {
  if (!SETTING_KEYS.has(key)) return undefined;

  const school = await School.findOne({ schoolId }, { settings: 1 }).lean();
  if (school && school.settings && school.settings[key] !== undefined) {
    return school.settings[key];
  }

  const systemKey = SYSTEM_CONFIG_MAP[key];
  if (systemKey) {
    const sysVal = await SystemConfig.get(systemKey);
    if (sysVal !== null && sysVal !== undefined) return sysVal;
  }

  return DEFAULTS[key];
}

/**
 * Updates school setting in schoolSettingsService.
 * @param {string} schoolId - Value used by setSchoolSetting.
 * @param {string} key - Value used by setSchoolSetting.
 * @param {*} value - Value used by setSchoolSetting.
 * @returns {Promise<*>} Result produced by setSchoolSetting.
 */
async function setSchoolSetting(schoolId, key, value) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  const updated = await School.findOneAndUpdate(
    { schoolId },
    { $set: { [`settings.${key}`]: value } },
    { new: true },
  ).lean();
  if (updated) schoolCache.invalidate(updated);
  return updated;
}

/**
 * Retrieves school settings from schoolSettingsService.
 * @param {string} schoolId - Value used by getSchoolSettings.
 * @returns {Promise<*>} Result produced by getSchoolSettings.
 */
async function getSchoolSettings(schoolId) {
  const school = await School.findOne({ schoolId }, { settings: 1 }).lean();
  const schoolOverrides = school?.settings || {};
  const merged = { ...DEFAULTS };

  for (const key of Object.keys(SYSTEM_CONFIG_MAP)) {
    const sysVal = await SystemConfig.get(SYSTEM_CONFIG_MAP[key]);
    if (sysVal !== null && sysVal !== undefined) {
      merged[key] = sysVal;
    }
  }

  Object.assign(merged, schoolOverrides);
  return merged;
}

/**
 * Updates school setting in schoolSettingsService.
 * @param {string} schoolId - Value used by clearSchoolSetting.
 * @param {string} key - Value used by clearSchoolSetting.
 * @returns {Promise<*>} Result produced by clearSchoolSetting.
 */
async function clearSchoolSetting(schoolId, key) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  const updated = await School.findOneAndUpdate(
    { schoolId },
    { $unset: { [`settings.${key}`]: '' } },
    { new: true },
  ).lean();
  if (updated) schoolCache.invalidate(updated);
  return updated;
}

module.exports = {
  getSchoolSetting,
  setSchoolSetting,
  getSchoolSettings,
  clearSchoolSetting,
  SETTING_KEYS,
};
