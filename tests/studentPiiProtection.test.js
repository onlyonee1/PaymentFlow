'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Keypair } = require('@stellar/stellar-sdk');

process.env.JWT_SECRET ||= 'student-export-test-jwt-secret-long-enough';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../backend/src/app');
const Student = require('../backend/src/models/studentModel');
const School = require('../backend/src/models/schoolModel');
const User = require('../backend/src/models/userModel');

let mongoServer;
const schoolId = 'SCH-TEST-PII';
const walletAddress = Keypair.random().publicKey();
const TEST_DB = 'student_pii_test';
const USE_EXTERNAL_MONGO = !!process.env.MONGO_URI;

beforeAll(async () => {
  if (USE_EXTERNAL_MONGO) {
    const baseUri = process.env.MONGO_URI.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
    await mongoose.connect(baseUri);
  } else {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Student.deleteMany({ schoolId }).includeDeleted();
  await School.deleteMany({ schoolId });
  await User.deleteMany({ schoolId });

  await School.create({
    schoolId,
    name: 'Test School',
    slug: 'student-pii-test',
    stellarAddress: walletAddress,
  });

  await Student.create({
    schoolId,
    studentId: 'STU001',
    name: 'Alice Johnson',
    class: 'Grade 5A',
    feeAmount: 250,
    parentEmail: 'alice@example.com',
    parentPhone: '555-1234',
    feePaid: false,
    totalPaid: 0,
  });
});

describe('Student PII Protection', () => {
  test('GET /api/students/:studentId should require admin authentication', async () => {
    const res = await request(app)
      .get('/api/students/STU001')
      .set('X-School-Id', schoolId);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('authentication');
  });

  test('GET /api/students/public/:studentId should return only non-PII fields', async () => {
    const res = await request(app)
      .get('/api/students/public/STU001')
      .set('X-School-Id', schoolId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('class');
    expect(res.body).toHaveProperty('feePaid');
    
    // Should NOT contain PII
    expect(res.body).not.toHaveProperty('parentEmail');
    expect(res.body).not.toHaveProperty('parentPhone');
    expect(res.body).not.toHaveProperty('totalPaid');
    expect(res.body).not.toHaveProperty('remainingBalance');
    expect(res.body).not.toHaveProperty('feeAmount');
  });

  test('public endpoint should return correct field values', async () => {
    const res = await request(app)
      .get('/api/students/public/STU001')
      .set('X-School-Id', schoolId);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Johnson');
    expect(res.body.class).toBe('Grade 5A');
    expect(res.body.feePaid).toBe(false);
  });

  test('public endpoint should return 404 for non-existent student', async () => {
    const res = await request(app)
      .get('/api/students/public/NONEXISTENT')
      .set('X-School-Id', schoolId);

    expect(res.status).toBe(404);
  });

  test('public endpoint should not expose student ID in response', async () => {
    const res = await request(app)
      .get('/api/students/public/STU001')
      .set('X-School-Id', schoolId);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('studentId');
  });

  test('admin endpoint should return full student record with auth', async () => {
    const token = jwt.sign({ role: 'admin', userId: 'super_admin' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/students/STU001')
      .set('X-School-Id', schoolId)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('parentEmail', 'alice@example.com');
  });

  test('viewer export rejects PII columns and defaults to student ID and class', async () => {
    const viewer = await User.create({
      schoolId, email: 'viewer@example.com', passwordHash: 'unused', roles: ['read_only'],
    });
    const token = jwt.sign({
      schoolId, userId: viewer.id, roles: viewer.roles,
    }, process.env.JWT_SECRET);
    const exportCsv = (query = '') => request(app)
      .get(`/api/students/export${query}`)
      .set('X-School-Id', schoolId)
      .set('Authorization', `Bearer ${token}`);

    const rejected = await exportCsv('?columns=studentId,parentEmail');
    expect(rejected.status).toBe(400);
    expect(rejected.body.allowedColumns).toEqual(['studentId', 'class']);
    const csv = await exportCsv();
    expect(csv.status).toBe(200);
    expect(csv.text).toBe('studentId,class\nSTU001,Grade 5A\n');
  });
});
