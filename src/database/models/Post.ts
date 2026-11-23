import { Schema, model } from 'mongoose';
import { POST_TYPES } from '../../shared/index';

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    community: { type: Schema.Types.ObjectId, ref: 'Community', default: null },
    // 'community' = only visible to members of a private community. Derived from the community, never from the client.
    visibility: { type: String, enum: ['public', 'community'], default: 'public' },
    type: { type: String, enum: POST_TYPES, default: 'discussion' },
    title: { type: String, trim: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 5000 },
    tags: { type: [String], default: [] },
    linkUrl: { type: String, maxlength: 500 },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    pinned: { type: Boolean, default: false },
    acceptedComment: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    commentCount: { type: Number, default: 0, min: 0 },
    reactionCount: { type: Number, default: 0, min: 0 },
    editedAt: { type: Date, default: null },
    isSeed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
postSchema.index({ community: 1, status: 1, _id: -1 });
postSchema.index({ author: 1, status: 1, _id: -1 });
postSchema.index({ status: 1, visibility: 1, _id: -1 });
postSchema.index({ title: 'text', body: 'text', tags: 'text' });

export const Post = model('Post', postSchema);
