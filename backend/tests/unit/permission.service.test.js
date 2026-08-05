const { can, PERMISSIONS } = require('../../services/permission.service');

const ids = { club: '507f1f77bcf86cd799439011', member: '507f1f77bcf86cd799439012', leader: '507f1f77bcf86cd799439013', outsider: '507f1f77bcf86cd799439014' };
const club = { _id: ids.club, members: [{ user: ids.member, role: 'member' }, { user: ids.leader, role: 'president' }] };
const task = { club, createdBy: ids.leader, assignedTo: [ids.member] };

describe('RBAC', () => {
  test('permits a task assignee to submit proof', async () => {
    await expect(can({ _id: ids.member }, PERMISSIONS.PROOF_SUBMIT, { club, task })).resolves.toMatchObject({ allowed: true, role: 'member' });
  });

  test('prevents a member from approving proof', async () => {
    await expect(can({ _id: ids.member }, PERMISSIONS.PROOF_REVIEW, { club, task })).resolves.toMatchObject({ allowed: false });
  });

  test('rejects a user with no club membership', async () => {
    await expect(can({ _id: ids.outsider }, PERMISSIONS.TASK_VIEW, { club, task })).resolves.toMatchObject({ allowed: false, reason: 'Club membership required' });
  });
});
