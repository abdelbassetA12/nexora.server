import { Schema, model } from 'mongoose';

const refreshSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: ['rotated', 'logout', 'reuse_detected', 'password_reset'], default: null },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);
// Documents are removed automatically once expired.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSession = model('RefreshSession', refreshSessionSchema);
