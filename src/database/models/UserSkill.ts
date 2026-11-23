import { Schema, model } from 'mongoose';
import { SKILL_LEVELS } from '../../shared/index';

// One row per (user, skill, kind). Kept out of the User document to stay bounded and indexable for matching.
const userSkillSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skillKey: { type: String, required: true, lowercase: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ['teach', 'learn'], required: true },
    level: { type: String, enum: SKILL_LEVELS, default: 'beginner' },
    // Self-declared only. Never treated as verified expertise.
    selfDeclared: { type: Boolean, default: true },
  },
  { timestamps: true },
);
userSkillSchema.index({ user: 1, skillKey: 1, kind: 1 }, { unique: true });
// Matching: who can teach X / who wants to learn X.
userSkillSchema.index({ skillKey: 1, kind: 1 });

export const UserSkill = model('UserSkill', userSkillSchema);
