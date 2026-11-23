import { Router } from 'express';
import {
  acceptAnswerSchema, createCommentSchema, createPostSchema, cursorQuerySchema, feedQuerySchema, idParamSchema,
  reactionSchema, updatePostSchema,
} from '../../shared/index';
import { Comment } from '../../database/models/Comment';
import { authenticate } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import * as comments from './comments.service';
import * as engage from './engagement.service';
import * as posts from './posts.service';

const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
const idp = validate({ params: idParamSchema });

export const postsRouter = Router();
postsRouter.use(authenticate);

postsRouter.get('/', validate({ query: feedQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await posts.getFeed(uid(req), req.query as never);
  ok(res, items, 200, meta);
}));
postsRouter.post('/', validate({ body: createPostSchema }), asyncHandler(async (req, res) => ok(res, await posts.createPost(uid(req), req.body), 201)));
postsRouter.get('/:id', idp, asyncHandler(async (req, res) => ok(res, await posts.getPost(uid(req), req.params.id as string))));
postsRouter.patch('/:id', idp, validate({ body: updatePostSchema }), asyncHandler(async (req, res) => ok(res, await posts.updatePost(uid(req), req.params.id as string, req.body))));
postsRouter.delete('/:id', idp, asyncHandler(async (req, res) => {
  await posts.deletePost(uid(req), req.params.id as string);
  ok(res, { deleted: true });
}));

postsRouter.post('/:id/reactions', idp, validate({ body: reactionSchema }), asyncHandler(async (req, res) => ok(res, await engage.react(uid(req), req.params.id as string, req.body.type))));
postsRouter.delete('/:id/reactions', idp, asyncHandler(async (req, res) => ok(res, await engage.unreact(uid(req), req.params.id as string))));
postsRouter.post('/:id/save', idp, asyncHandler(async (req, res) => ok(res, await engage.save(uid(req), req.params.id as string))));
postsRouter.delete('/:id/save', idp, asyncHandler(async (req, res) => ok(res, await engage.unsave(uid(req), req.params.id as string))));

postsRouter.get('/:id/comments', idp, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await comments.listComments(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));
postsRouter.post('/:id/comments', idp, validate({ body: createCommentSchema }), asyncHandler(async (req, res) => {
  ok(res, await comments.addComment(uid(req), req.params.id as string, req.body.body), 201);
}));

export const commentsRouter = Router();
commentsRouter.use(authenticate);
commentsRouter.get('/:id/replies', idp, validate({ query: cursorQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await comments.listReplies(uid(req), req.params.id as string, req.query as never);
  ok(res, items, 200, meta);
}));
commentsRouter.post('/:id/replies', idp, validate({ body: createCommentSchema }), asyncHandler(async (req, res) => {
  const parent = await Comment.findById(req.params.id).select('post').lean();
  if (!parent) throw notFound('Comment not found');
  ok(res, await comments.addComment(uid(req), String(parent.post), req.body.body, req.params.id as string), 201);
}));
commentsRouter.patch('/:id', idp, validate({ body: createCommentSchema }), asyncHandler(async (req, res) => ok(res, await comments.editComment(uid(req), req.params.id as string, req.body.body))));
commentsRouter.delete('/:id', idp, asyncHandler(async (req, res) => {
  await comments.deleteComment(uid(req), req.params.id as string);
  ok(res, { deleted: true });
}));

export const questionsRouter = Router();
questionsRouter.use(authenticate);
questionsRouter.post('/:id/accept-answer', idp, validate({ body: acceptAnswerSchema }), asyncHandler(async (req, res) => {
  ok(res, await engage.acceptAnswer(uid(req), req.params.id as string, req.body.commentId));
}));

export const savedRouter = Router();
savedRouter.use(authenticate);
savedRouter.get('/', validate({ query: feedQuerySchema }), asyncHandler(async (req, res) => {
  const { items, meta } = await engage.listSaved(uid(req), req.query as never);
  ok(res, items, 200, meta);
}));
