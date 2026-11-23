import { Schema, model } from 'mongoose';
import { GOAL_CATEGORIES } from '../../shared/index';

const goalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    category: { type: String, enum: GOAL_CATEGORIES, default: 'other' },
    startDate: { type: Date, default: Date.now },
    targetDate: { type: Date, default: null },
    status: { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },
    completedAt: { type: Date, default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    community: { type: Schema.Types.ObjectId, ref: 'Community', default: null },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
goalSchema.index({ user: 1, status: 1, _id: -1 });
export const Goal = model('Goal', goalSchema);

const milestoneSchema = new Schema(
  { goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true }, user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, title: { type: String, required: true, trim: true, maxlength: 120 }, dueDate: { type: Date, default: null }, completedAt: { type: Date, default: null } },
  { timestamps: true },
);
milestoneSchema.index({ goal: 1, _id: 1 });
export const GoalMilestone = model('GoalMilestone', milestoneSchema);

const progressSchema = new Schema(
  { goal: { type: Schema.Types.ObjectId, ref: 'Goal', required: true }, type: { type: String, enum: ['milestone_completed', 'milestone_reopened', 'goal_completed'], required: true }, milestone: { type: Schema.Types.ObjectId, default: null } },
  { timestamps: { createdAt: true, updatedAt: false } },
);
progressSchema.index({ goal: 1, _id: -1 });
export const GoalProgress = model('GoalProgress', progressSchema);
