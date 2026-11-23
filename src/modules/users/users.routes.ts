import { Router } from 'express';
import { idParamSchema, replaceSkillsSchema, updateProfileSchema, usernameParamSchema } from '../../shared/index';
import * as social from '../social/social.service';
import { listUserProjects } from '../projects/projects.routes';
import { userAchievementsHandler } from '../achievements/achievements';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import * as users from './users.service';

const router = Router();
router.use(authenticate);

// NOTE: "/me" routes are registered before "/:username" so "me" is never treated as a username.
router.patch('/me', validate({ body: updateProfileSchema }), asyncHandler(async (req, res) => {
  ok(res, await users.updateMe(req.auth!.userId, req.body));
}));

router.get('/me/skills', asyncHandler(async (req, res) => {
  ok(res, await users.getMySkills(req.auth!.userId));
}));

router.put('/me/skills', validate({ body: replaceSkillsSchema }), asyncHandler(async (req, res) => {
  ok(res, await users.replaceMySkills(req.auth!.userId, req.body));
}));

router.get('/:id/projects', validate({ params: idParamSchema }), asyncHandler(async (req, res) => ok(res, await listUserProjects(req.params.id as string, req.auth!.userId))));
router.get('/:id/achievements', ...(userAchievementsHandler as unknown as never[]));
router.post('/:id/follow', validate({ params: idParamSchema }), asyncHandler(async (req, res) => ok(res, await social.follow(req.auth!.userId, req.params.id as string))));
router.delete('/:id/follow', validate({ params: idParamSchema }), asyncHandler(async (req, res) => ok(res, await social.unfollow(req.auth!.userId, req.params.id as string))));
router.post('/:id/block', validate({ params: idParamSchema }), asyncHandler(async (req, res) => ok(res, await social.block(req.auth!.userId, req.params.id as string))));
router.delete('/:id/block', validate({ params: idParamSchema }), asyncHandler(async (req, res) => ok(res, await social.unblock(req.auth!.userId, req.params.id as string))));

router.get('/:username', validate({ params: usernameParamSchema }), asyncHandler(async (req, res) => {
  ok(res, await users.getPublicProfile(req.params.username as string, req.auth!.userId));
}));

export default router;
