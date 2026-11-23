import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ follower: 1, following: 1 }, { unique: true });
schema.index({ following: 1 });

export const Follow = model('Follow', schema);
