import { Schema, model } from 'mongoose';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../shared/index';

const projectSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 3000 },
    category: { type: String, required: true, lowercase: true },
    skills: { type: [String], default: [] },
    goals: { type: [String], default: [] },
    deliverables: { type: [String], default: [] },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    deadline: { type: Date, default: null },
    status: { type: String, enum: ['planning', 'active', 'completed', 'archived'], default: 'planning' },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
projectSchema.index({ visibility: 1, status: 1, _id: -1 });
projectSchema.index({ skills: 1 });
export const Project = model('Project', projectSchema);

const membershipSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'maintainer', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'pending'], default: 'active' },
    message: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);
membershipSchema.index({ project: 1, user: 1 }, { unique: true });
membershipSchema.index({ user: 1, status: 1 });
export const ProjectMembership = model('ProjectMembership', membershipSchema);

const taskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: '', maxlength: 2000 },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
taskSchema.index({ project: 1, status: 1, _id: -1 });
taskSchema.index({ assignee: 1, status: 1 });
export const ProjectTask = model('ProjectTask', taskSchema);

const taskCommentSchema = new Schema(
  { task: { type: Schema.Types.ObjectId, ref: 'ProjectTask', required: true }, author: { type: Schema.Types.ObjectId, ref: 'User', required: true }, body: { type: String, required: true, maxlength: 2000 } },
  { timestamps: true },
);
taskCommentSchema.index({ task: 1, _id: 1 });
export const TaskComment = model('TaskComment', taskCommentSchema);

const activitySchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'ProjectTask', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['created', 'status_changed', 'assigned', 'edited'], required: true },
    from: String, to: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
activitySchema.index({ task: 1, _id: 1 });
export const TaskActivity = model('TaskActivity', activitySchema);
