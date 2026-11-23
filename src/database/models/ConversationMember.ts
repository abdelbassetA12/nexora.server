import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'left'], default: 'active' },
    muted: { type: Boolean, default: false },
    lastReadMessage: { type: Schema.Types.ObjectId, default: null },
    lastReadAt: { type: Date, default: null },
    // Denormalized so the conversation list can sort/paginate with a single indexed query.
    conversationLastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ conversation: 1, user: 1 }, { unique: true });
schema.index({ user: 1, status: 1, conversationLastMessageAt: -1 });

export const ConversationMember = model('ConversationMember', schema);
