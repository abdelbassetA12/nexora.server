import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
  },
  { timestamps: true },
);
schema.index({ user: 1, post: 1 }, { unique: true });
schema.index({ user: 1, _id: -1 });

export const SavedItem = model('SavedItem', schema);
