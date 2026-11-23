import { Schema, model } from 'mongoose';
import { REPORT_REASONS, REPORT_TARGETS } from '../../shared/index';

const schema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    // Set when the target belongs to a community so community moderators can review it.
    community: { type: Schema.Types.ObjectId, ref: 'Community', default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, maxlength: 1000 },
    status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open' },
  },
  { timestamps: true },
);
schema.index({ status: 1, _id: -1 });
schema.index({ community: 1, status: 1 });
// A user can have only one open report per target.
schema.index({ reporter: 1, targetType: 1, targetId: 1 }, { unique: true });

export const Report = model('Report', schema);
