import { Schema, model } from 'mongoose';
import { EVENT_TYPES } from '../../shared/index';

const eventSchema = new Schema(
  {
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    community: { type: Schema.Types.ObjectId, ref: 'Community', default: null },
    visibility: { type: String, enum: ['public', 'community'], default: 'public' }, // derived from the community
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 3000 },
    type: { type: String, enum: EVENT_TYPES, default: 'discussion' },
    startsAt: { type: Date, required: true }, // absolute instant (UTC)
    timeZone: { type: String, required: true }, // IANA zone the host intended; display only, never shifts the instant
    durationMinutes: { type: Number, default: 60, min: 15, max: 720 },
    capacity: { type: Number, default: null, min: 1 },
    registeredCount: { type: Number, default: 0, min: 0 },
    resourceLinks: { type: [String], default: [] },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
eventSchema.index({ status: 1, visibility: 1, startsAt: 1, _id: 1 });
eventSchema.index({ community: 1, startsAt: 1 });
export const Event = model('Event', eventSchema);

const registrationSchema = new Schema(
  { event: { type: Schema.Types.ObjectId, ref: 'Event', required: true }, user: { type: Schema.Types.ObjectId, ref: 'User', required: true } },
  { timestamps: true },
);
registrationSchema.index({ event: 1, user: 1 }, { unique: true });
registrationSchema.index({ user: 1, _id: -1 });
export const EventRegistration = model('EventRegistration', registrationSchema);
