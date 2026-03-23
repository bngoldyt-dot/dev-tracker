const { tryCatch } = require("bullmq");
const teamService = require("../../services/team.service");
const sendInvite = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { email } = req.body;

    const invitation = await teamService.sendInvite(adminId, email);

    res.status(201).json({
      status: "success",
      message:
        "Invitation sent successfully. The developer will see it in their dashboard.",
      data: {
        invitation,
      },
    });
  } catch (error) {
    next(error);
  }
};

// في ملف controllers/team.controller.js

const respondToInvitation = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { invitationId } = req.params;
    const { decision } = req.body;

    const result = await teamService.respondToInvite(
      userId,
      invitationId,
      decision,
    );

    res.status(200).json({
      status: "success",
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all developers in the admin's team
 * @route   GET /api/v1/teams/members
 * @access  Private (Admin Only)
 */
const getTeamMembers = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const members = await teamService.getTeamMembers(adminId);

    res.status(200).json({
      status: "success",
      results: members.length,
      data: {
        members,
      },
    });
  } catch (error) {
    next(error);
  }
};
/**
 * @desc    Get all pending invitations for the logged-in developer
 * @route   GET /api/v1/teams/my-invitations
 * @access  Private (Logged-in Developer)
 */
const getMyInvitations = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const invitations = await teamService.getMyInvitations(userId);

    res.status(200).json({
      status: "success",
      results: invitations.length,
      data: {
        invitations,
      },
    });
  } catch (error) {
    next(error);
  }
};

const removeTeamMember = async (req, res, next) => {
  try {
    const adminId = req.user._id;
    const { memberId } = req.params;
    const result = await teamService.removeMember(adminId, memberId);
    res.status(200).json({
      status: "success",
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  sendInvite,
  getMyInvitations,
  respondToInvitation,
  getTeamMembers,
  removeTeamMember
};
