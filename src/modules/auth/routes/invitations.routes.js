const express = require('express');
const { sendInvite, getMyInvitations, respondToInvitation, getTeamMembers, removeTeamMember } = require('../controllers/teamscontrollers/teams');
const { protect } = require('../../../middlewares/auth.middleware');
const invitaionsRouter = express.Router();
invitaionsRouter.post('/sendinvitaions' ,protect ,sendInvite);
invitaionsRouter.get('/getallinetations' ,protect ,getMyInvitations);
invitaionsRouter.post("/respond/:invitationId",protect , respondToInvitation)
invitaionsRouter.get("/members", protect, getTeamMembers)
invitaionsRouter.delete("/members/:memberId",  protect , removeTeamMember)
module.exports = {invitaionsRouter}