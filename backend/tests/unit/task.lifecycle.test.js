const mongoose = require('mongoose');
const Task = require('../../models/Task.model');

const id = () => new mongoose.Types.ObjectId();
const makeTask = () => new Task({ title: 'Prepare venue', club: id(), createdBy: id(), assignedTo: [], status: 'todo' });

describe('task lifecycle model methods', () => {
  test('records status transitions and completion metadata', async () => {
    const task = makeTask(); task.save = jest.fn().mockResolvedValue(task); const actor = id();
    await task.updateStatus(actor, 'completed');
    expect(task.status).toBe('completed');
    expect(task.completedBy.toString()).toBe(actor.toString());
    expect(task.history.at(-1)).toMatchObject({ action: 'status_changed', oldValue: 'todo', newValue: 'completed' });
  });

  test('adds comments and attachments with history', async () => {
    const task = makeTask(); task.save = jest.fn().mockResolvedValue(task); const actor = id();
    await task.addComment(actor, 'Venue is booked');
    await task.addAttachment(actor, { filename: 'confirmation.pdf', fileType: 'application/pdf' });
    expect(task.comments).toHaveLength(1); expect(task.attachments).toHaveLength(1);
    expect(task.history.map((entry) => entry.action)).toEqual(expect.arrayContaining(['commented', 'attachment_added']));
  });
});
