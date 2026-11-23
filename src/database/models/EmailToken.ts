import { Schema, model } from 'mongoose';

const emailTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['verify_email', 'reset_password'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailToken = model('EmailToken', emailTokenSchema);
