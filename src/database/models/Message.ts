import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 4000 },
    clientMsgId: { type: String, required: true },
    replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    status: { type: String, enum: ['sent', 'deleted'], default: 'sent' },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
schema.index({ conversation: 1, _id: -1 });
// Idempotency: a retried send with the same clientMsgId can never create a duplicate.
schema.index({ conversation: 1, sender: 1, clientMsgId: 1 }, { unique: true });

export const Message = model('Message', schema);
