import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blocked: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ blocker: 1, blocked: 1 }, { unique: true });
schema.index({ blocked: 1 });

export const Block = model('Block', schema);
