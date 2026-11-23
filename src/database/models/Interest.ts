import { Schema, model } from 'mongoose';

const interestSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    // Localized labels for curated entries; custom entries only have `name`.
    labels: { type: Map, of: String, default: {} },
    isCustom: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Interest = model('Interest', interestSchema);
