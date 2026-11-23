import { Schema, model } from 'mongoose';
import { REACTION_TYPES } from '../../shared/index';

const schema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: REACTION_TYPES, default: 'like' },
  },
  { timestamps: true },
);
schema.index({ post: 1, user: 1 }, { unique: true }); // one reaction per user per post

export const Reaction = model('Reaction', schema);
