import { Schema, model } from 'mongoose';
import { COMMUNITY_ROLES } from '../../shared/index';

const schema = new Schema(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: COMMUNITY_ROLES, default: 'member' },
    status: { type: String, enum: ['active', 'pending', 'banned'], default: 'active' },
  },
  { timestamps: true },
);
// Prevents duplicate membership at the database level.
schema.index({ community: 1, user: 1 }, { unique: true });
schema.index({ user: 1, status: 1 });
schema.index({ community: 1, status: 1, _id: -1 });

export const CommunityMembership = model('CommunityMembership', schema);
