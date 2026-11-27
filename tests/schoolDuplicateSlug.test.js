'use strict';

/**
 * Tests for POST /api/schools duplicate slug — issue #609
 * Verifies that creating a school with a duplicate slug returns 409 DUPLICATE_SCHOOL.
 */

const { createSchool, updateSchool } = require('../backend/src/controllers/schoolController');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../backend/src/models/schoolModel', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  distinct: jest.fn().mockResolvedValue([]),
}));

jest.mock('../backend/src/services/auditService', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../backend/src/services/stellarAccountVerificationService', () => ({
  verifyStellarAccountFunding: jest.fn().mockResolvedValue({ isFunded: true, warning: null }),
}));

const School = require('../backend/src/models/schoolModel');

// Valid Stellar public key for tests
const VALID_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockReq(body = {}) {
  return {
    body: {
      name: 'Lincoln High School',
      slug: 'lincoln-high',
      stellarAddress: VALID_ADDRESS,
      network: 'testnet',
      ...body,
    },
    auditContext: null,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/schools — duplicate slug — issue #609', () => {
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  it('returns 201 when slug is unique', async () => {
    const schoolDoc = { schoolId: 'SCH-AAAA', name: 'Lincoln High School', slug: 'lincoln-high', toObject: () => ({}) };
    School.create.mockResolvedValue(schoolDoc);

    const req = mockReq();
    const res = mockRes();
    await createSchool(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with 409 DUPLICATE_SCHOOL when slug already exists', async () => {
    const dupError = new Error('E11000 duplicate key error collection: test.schools index: slug_1 dup key: { slug: "lincoln-high" }');
    dupError.code = 11000;
    School.create.mockRejectedValue(dupError);

    const req = mockReq();
    const res = mockRes();
    await createSchool(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.code).toBe('DUPLICATE_SCHOOL');
    expect(err.status).toBe(409);
    expect(err.details.suggestions).toEqual(['lincoln-high-2', 'lincoln-high-3', 'lincoln-high-4']);
  });

  it('calls next with 409 DUPLICATE_SCHOOL when schoolId collides (non-slug 11000)', async () => {
    const dupError = new Error('E11000 duplicate key error collection: test.schools index: schoolId_1 dup key: { schoolId: "SCH-AAAA" }');
    dupError.code = 11000;
    School.create.mockRejectedValue(dupError);

    const req = mockReq({ slug: 'unique-slug-xyz' });
    const res = mockRes();
    await createSchool(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.code).toBe('DUPLICATE_SCHOOL');
    expect(err.status).toBe(409);
  });

  it.each([
    ['Lincoln High!', 'lincoln-high'],
    ['lincoln high school', 'lincoln-high-school'],
    ['école-primaire', 'ecole-primaire'],
  ])('normalizes %s to %s before creating the school', async (slug, normalized) => {
    School.create.mockResolvedValue({ schoolId: 'SCH-AAAA', slug: normalized });
    const res = mockRes();
    await createSchool(mockReq({ slug }), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(School.create).toHaveBeenCalledWith(expect.objectContaining({ slug: normalized }));
  });

  it('reserves inactive slugs on update and skips reserved suggestions', async () => {
    const req = mockReq({ slug: ' Lincoln High ' });
    req.params = { schoolId: 'SCH-AAAA' };
    School.findOne.mockReturnValue({ lean: async () => ({ slug: 'old-slug', timezone: 'Africa/Lagos' }) });
    School.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { slug: 1 },
    }));
    School.distinct.mockResolvedValueOnce(['lincoln-high-2']);

    await updateSchool(req, mockRes(), next);

    expect(School.distinct).toHaveBeenCalledWith('slug', expect.objectContaining({ slug: expect.any(Object) }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 409,
      code: 'DUPLICATE_SCHOOL',
      details: { suggestions: ['lincoln-high-lagos', 'lincoln-high-3', 'lincoln-high-4'] },
    }));
  });
});
