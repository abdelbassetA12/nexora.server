import { Schema, model } from 'mongoose';
import { COMMUNITY_VISIBILITY, JOIN_POLICIES } from '../../shared/index';

const communitySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '', maxlength: 500 },
    category: { type: String, required: true, lowercase: true, index: true },
    tags: { type: [String], default: [], validate: [(v: string[]) => v.length <= 10, 'Too many tags'] },
    language: { type: String, enum: ['en', 'ar'], default: 'en' },
    visibility: { type: String, enum: COMMUNITY_VISIBILITY, default: 'public' },
    joinPolicy: { type: String, enum: JOIN_POLICIES, default: 'open' },
    rules: { type: [String], default: [] },
    iconUrl: { type: String, default: null },
    coverUrl: { type: String, default: null },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized counters, only ever changed with atomic $inc after the underlying write succeeded.
    memberCount: { type: Number, default: 0, min: 0 },
    postCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
communitySchema.index({ name: 'text', description: 'text', tags: 'text' });
communitySchema.index({ visibility: 1, status: 1, _id: -1 });

export const Community = model('Community', communitySchema);
