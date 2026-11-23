import { Schema, model } from 'mongoose';
import { SKILL_FORMATS } from '../../shared/index';

const base = {
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, maxlength: 1000 },
  skill: { type: String, required: true, trim: true, maxlength: 60 },
  skillKey: { type: String, required: true, lowercase: true },
  format: { type: String, enum: SKILL_FORMATS, default: 'text' },
  language: { type: String, enum: ['en', 'ar'], default: 'en' },
  availability: { type: String, default: '', maxlength: 200 },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
};
const offerSchema = new Schema(base, { timestamps: true });
offerSchema.index({ status: 1, skillKey: 1, _id: -1 });
offerSchema.index({ owner: 1, _id: -1 });
export const SkillOffer = model('SkillOffer', offerSchema);

const requestSchema = new Schema(
  { ...base, audience: { type: String, enum: ['open', 'direct', 'community'], default: 'open' }, targetUser: { type: Schema.Types.ObjectId, ref: 'User', default: null }, community: { type: Schema.Types.ObjectId, ref: 'Community', default: null } },
  { timestamps: true },
);
requestSchema.index({ status: 1, audience: 1, skillKey: 1, _id: -1 });
requestSchema.index({ owner: 1, _id: -1 });
requestSchema.index({ targetUser: 1 });
export const SkillRequest = model('SkillRequest', requestSchema);

const exchangeSchema = new Schema(
  {
    initiator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    responder: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    offer: { type: Schema.Types.ObjectId, ref: 'SkillOffer', default: null },
    request: { type: Schema.Types.ObjectId, ref: 'SkillRequest', default: null },
    skill: { type: String, required: true, maxlength: 60 },
    message: { type: String, required: true, maxlength: 1000 },
    offeredInReturn: { type: String, default: '', maxlength: 200 },
    status: { type: String, enum: ['proposed', 'accepted', 'declined', 'scheduled', 'completed', 'cancelled'], default: 'proposed' },
    scheduledAt: { type: Date, default: null },
    confirmedBy: { type: [Schema.Types.ObjectId], default: [] }, // bounded: the two participants
    feedback: { type: [{ from: Schema.Types.ObjectId, rating: Number, comment: String, createdAt: Date }], default: [] },
  },
  { timestamps: true },
);
exchangeSchema.index({ initiator: 1, _id: -1 });
exchangeSchema.index({ responder: 1, _id: -1 });
export const SkillExchange = model('SkillExchange', exchangeSchema);
