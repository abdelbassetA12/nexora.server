import { Router } from 'express';
import { createReportSchema } from '../../shared/index';
import { Comment } from '../../database/models/Comment';
import { Community } from '../../database/models/Community';
import { Post } from '../../database/models/Post';
import { Report } from '../../database/models/Report';
import { User } from '../../database/models/User';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, notFound } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { loadVisiblePost } from '../posts/posts.service';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createReportSchema }), asyncHandler(async (req, res) => {
  const userId = req.auth!.userId;
  const { targetType, targetId, reason, details } = req.body as { targetType: string; targetId: string; reason: string; details?: string };
  let community: unknown = null;

  if (targetType === 'post') {
    const post = await loadVisiblePost(targetId, userId); // only content the reporter can see
    if (String(post.author) === userId) throw badRequest('You cannot report your own content');
    community = post.community;
  } else if (targetType === 'comment') {
    const c = await Comment.findById(targetId).lean();
    if (!c) throw notFound('Comment not found');
    const post = await loadVisiblePost(String(c.post), userId);
    if (String(c.author) === userId) throw badRequest('You cannot report your own content');
    community = post.community;
  } else if (targetType === 'user') {
    if (targetId === userId) throw badRequest('You cannot report yourself');
    if (!(await User.exists({ _id: targetId }))) throw notFound('User not found');
  } else {
    const c = await Community.findById(targetId).select('visibility').lean();
    if (!c || c.visibility === 'private') throw notFound('Community not found');
    community = c._id;
  }

  // Idempotent: reporting the same target twice returns the existing report.
  const report = await Report.findOneAndUpdate(
    { reporter: userId, targetType, targetId },
    { $setOnInsert: { reporter: userId, targetType, targetId, community, reason, details, status: 'open' } },
    { upsert: true, new: true },
  );
  ok(res, { id: String(report._id), status: report.status }, 201);
}));

export default router;
