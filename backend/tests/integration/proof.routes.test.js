jest.mock('../../middleware/auth', () => ({ protect: (_req, _res, next) => next() }));
jest.mock('../../models/Task.model', () => ({ findById: jest.fn() }));
jest.mock('../../models/ProofSubmission.model', () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock('../../services/permission.service', () => ({ can: jest.fn(), PERMISSIONS: { PROOF_SUBMIT: 'proof:submit', PROOF_REVIEW: 'proof:review', TASK_VIEW: 'task:view' }, idsMatch: (left, right) => String(left) === String(right) }));
jest.mock('../../services/activity.service', () => ({ createActivity: jest.fn() }));
jest.mock('../../services/audit.service', () => ({ recordAudit: jest.fn() }));

const request = require('supertest');
const router = require('../../routes/proof.routes');
const Task = require('../../models/Task.model');
const ProofSubmission = require('../../models/ProofSubmission.model');
const { can } = require('../../services/permission.service');
const { createAuthenticatedApp } = require('../helpers/http');

const userId = '507f1f77bcf86cd799439011';
const task = { _id: 'task-1', club: 'club-1', title: 'Prepare venue', createdBy: userId, assignedTo: [userId], attachments: [] };
const app = () => createAuthenticatedApp(router, { _id: userId, role: 'member' });

describe('proof approval API', () => {
  beforeEach(() => {
    Task.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(task) });
    can.mockResolvedValue({ allowed: true, role: 'member' });
  });

  test('accepts a participant proof submission', async () => {
    const proof = { _id: 'proof-1', status: 'pending' }; ProofSubmission.create.mockResolvedValue(proof);
    const response = await request(app()).post('/tasks/task-1/proofs').send({ comment: 'Photos are attached in the task.' });
    expect(response.status).toBe(201); expect(response.body.data).toEqual(proof);
    expect(ProofSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ task: 'task-1', submittedBy: userId }));
  });

  test('requires a rejection reason', async () => {
    const proof = { _id: 'proof-1', task: 'task-1', status: 'pending' }; ProofSubmission.findById.mockResolvedValue(proof);
    const response = await request(app()).post('/proofs/proof-1/review').send({ decision: 'rejected' });
    expect(response.status).toBe(400); expect(response.body.message).toMatch(/rejection comment/i);
  });
});
