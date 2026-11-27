'use strict';

const slugify = require('slugify');

const MAX_LENGTH = 60;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSchoolSlug(value) {
  if (typeof value !== 'string') return '';
  return slugify(value, { lower: true, strict: true })
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidSchoolSlug(value) {
  return value.length >= 2 && value.length <= MAX_LENGTH && SLUG_PATTERN.test(value);
}

function withSuffix(slug, suffix) {
  return `${slug.slice(0, MAX_LENGTH - suffix.length - 1).replace(/-$/, '')}-${suffix}`;
}

async function suggestSchoolSlugs(School, slug, timezone) {
  const suggestions = [];
  const location = normalizeSchoolSlug(timezone?.split('/').pop()?.replace(/_/g, ' '));
  let number = 2;
  while (suggestions.length < 3) {
    const candidates = [];
    if (number === 2 && location && location !== 'utc' && location !== 'gmt') {
      candidates.push(withSuffix(slug, location.slice(0, 30).replace(/-$/, '')));
    }
    for (let i = 0; i < 8; i += 1) {
      candidates.push(withSuffix(slug, String(number++)));
    }
    const taken = new Set(await School.distinct('slug', { slug: { $in: candidates } }));
    for (const candidate of candidates) {
      if (!taken.has(candidate) && !suggestions.includes(candidate)) suggestions.push(candidate);
      if (suggestions.length === 3) break;
    }
  }
  return suggestions;
}

module.exports = { normalizeSchoolSlug, isValidSchoolSlug, suggestSchoolSlugs };
