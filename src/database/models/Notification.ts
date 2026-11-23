import { Schema, model } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'comment', 'reply', 'reaction', 'accepted_answer', 'membership_approved', 'join_request', 'follow',
  'exchange_request', 'exchange_accepted', 'exchange_declined', 'project_join_request', 'project_join_approved', 'task_assigned', 'event_cancelled',
] as const;

const schema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    resourceType: { type: String, enum: ['post', 'comment', 'community', 'user', 'exchange', 'project', 'task', 'event'], required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
schema.index({ recipient: 1, _id: -1 });
schema.index({ recipient: 1, readAt: 1 });

export const Notification = model('Notification', schema);
