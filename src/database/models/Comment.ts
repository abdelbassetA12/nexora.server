import { Schema, model } from 'mongoose';

const commentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Single reply level: replies always point at the top-level comment.
    parent: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['published', 'deleted'], default: 'published' },
    replyCount: { type: Number, default: 0, min: 0 },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
commentSchema.index({ post: 1, parent: 1, _id: 1 });
commentSchema.index({ parent: 1, _id: 1 });

export const Comment = model('Comment', commentSchema);
