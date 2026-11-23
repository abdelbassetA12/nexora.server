import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { GOAL_INTENTS } from '../../shared/index';

const userSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, maxlength: 254 },
    emailNormalized: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 30 },
    usernameNormalized: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    avatarUrl: { type: String, default: null, maxlength: 500 },
    bio: { type: String, default: '', maxlength: 500 },
    country: { type: String, default: null, uppercase: true, minlength: 2, maxlength: 2 },
    languages: { type: [String], default: [], validate: [(v: string[]) => v.length <= 10, 'Too many languages'] },
    locale: { type: String, enum: ['en', 'ar'], default: 'en' },
    interests: { type: [String], default: [], validate: [(v: string[]) => v.length <= 30, 'Too many interests'] },
    goals: { type: [String], enum: GOAL_INTENTS, default: [] },
    onboarding: {
      step: { type: Number, default: 0, min: 0, max: 6 },
      completed: { type: Boolean, default: false },
    },
    role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    privacy: {
      showOnlineStatus: { type: Boolean, default: true },
      profileVisibility: { type: String, enum: ['public', 'members'], default: 'public' },
      dmPermission: { type: String, enum: ['everyone', 'following', 'nobody'], default: 'everyone' },
    },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);
