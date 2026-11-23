import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true },
    title: { type: String, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Sorted "idA:idB" for direct chats: a unique index guarantees one conversation per pair, even under races.
    directKey: { type: String },
    lastMessage: {
      id: { type: Schema.Types.ObjectId },
      preview: { type: String, maxlength: 140 },
      sender: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } });

export const Conversation = model('Conversation', schema);
