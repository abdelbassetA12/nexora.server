import { Schema, model } from 'mongoose';

const definitionSchema = new Schema({ key: { type: String, required: true, unique: true }, name: { type: Schema.Types.Mixed, required: true }, description: { type: Schema.Types.Mixed, required: true } }, { timestamps: true });
export const AchievementDefinition = model('AchievementDefinition', definitionSchema);

const userAchievementSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    source: { type: String, enum: ['goal', 'answer', 'exchange', 'task'], required: true }, // the verifiable event that earned it
    sourceId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: 'earnedAt', updatedAt: false } },
);
userAchievementSchema.index({ user: 1, key: 1 }, { unique: true }); // each achievement is earned once
export const UserAchievement = model('UserAchievement', userAchievementSchema);
