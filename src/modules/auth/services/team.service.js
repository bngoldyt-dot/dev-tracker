const Developer = require("../repositories/auth.repository")
const ApiError = require("../../../utils/apiErrors")
const InvitationRepo = require("../repositories/invitations.repository");
const sendInvite = async (adminId, recipientEmail) => {
  const emailLower = recipientEmail.toLowerCase().trim();

  // 1. Validation
  if (!adminId || !emailLower) {
    throw new ApiError(400, "Admin ID and developer email are required");
  }

  const admin = await Developer.findUserById(adminId);
  if (admin.email === emailLower) {
    throw new ApiError(400, "You cannot send an invitation to yourself");
  }

  // 2. التحقق من وجود المستخدم المستقبل
  const recipient = await Developer.findUserByEmail(emailLower);
  if (!recipient) {
    throw new ApiError(404, "Cannot find user with this email");
  }

  // 3. التحقق هل هو عضو فعلاً؟
  const isAlreadyMember = recipient.teams.some(
    (t) => t.adminId.toString() === adminId.toString()
  );
  if (isAlreadyMember) {
    throw new ApiError(400, "This developer is already in your team");
  }

  const existingInvite = await InvitationRepo.findPendingInvite(adminId, emailLower);
  if (existingInvite) {
    throw new ApiError(400, "An invitation is already pending for this developer");
  }

  const invitation = await InvitationRepo.createInvitation(adminId, emailLower);


  if (global.io) {
    global.io.to(recipient._id.toString()).emit("new_invitation", {
      message: `You have been invited to join ${admin.name}'s team`,
      invitationId: invitation._id,
      senderName: admin.name,
      sentAt: invitation.createdAt
    });
  }

  return invitation;
};


const respondToInvite = async (userId, invitationId, decision) => {
  if (!decision || !invitationId) {
    throw new ApiError(400, "Decision and Invitation ID are required");
  }

  // 1. البحث عن الدعوة
  const invitation = await InvitationRepo.findInviteById(invitationId);
  if (!invitation || invitation.status !== "pending") {
    throw new ApiError(400, "This invitation is no longer valid or has already been processed.");
  }

  // 2. التأكد أن المطور الحالي هو صاحب الدعوة
  const user = await Developer.findUserById(userId);
  if (user.email !== invitation.recipientEmail) {
    throw new ApiError(403, "You are not authorized to respond to this invitation.");
  }

  if (decision === "accept") {
    // 3. إضافة المطور لفريق الأدمن (بناءً على خطتك: صلاحيات لإدارة المشاريع)
    const alreadyInTeam = user.teams.some(t => t.adminId.toString() === invitation.sender.toString());
    
    if (!alreadyInTeam) {
      user.teams.push({ 
        adminId: invitation.sender,

      });
      await user.save();
    }

    await InvitationRepo.updateInvitationStatus(invitationId, "accepted");

    // --- ⚡ إشعار للأدمن إن الدعوة اتقبلت ⚡ ---
    if (global.io) {
      global.io.to(invitation.sender.toString()).emit("invitation_accepted", {
        developerName: user.name,
        developerId: user._id,
        message: `${user.name} has joined your team!`
      });
    }

    return { message: "Invitation accepted. You are now part of the team!" };
  } 
  
  else if (decision === "reject") {
    await InvitationRepo.updateInvitationStatus(invitationId, "rejected");

    // --- ⚡ إشعار للأدمن بالرفض ⚡ ---
    if (global.io) {
      global.io.to(invitation.sender.toString()).emit("invitation_rejected", {
        developerEmail: user.email,
        message: `${user.name} declined your invitation.`
      });
    }

    return { message: "Invitation rejected." };
  }

  throw new ApiError(400, "Invalid decision. Must be 'accept' or 'reject'.");
};

const getTeamMembers = async (adminId) => {
  // 1. التأكد من وجود الأدمن (خطوة اختيارية لزيادة الأمان)
  const admin = await Developer.findUserById(adminId);
  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  // 2. جلب الأعضاء من الريبوزيتوري
  const members = await InvitationRepo.findTeamMembers(adminId);

  // 3. تنسيق البيانات (اختياري) عشان نرجع الصلاحيات بشكل أوضح
  const formattedMembers = members.map(member => ({
    id: member._id,
    name: member.name,
    email: member.email,
    joinedAt: member.teams[0].joinedAt,
    permissions: member.teams[0].permissions
  }));

  return formattedMembers;
};

const getMyInvitations = async (userId) => {
  const user = await Developer.findUserById(userId);
  if (!user) {
    throw new ApiError(404, "user not found");
  }

  const invitations = await InvitationRepo.findInvitesForUser(user.email);

  return invitations;
};

const removeMember = async (adminId , memberId) => {
  if(!adminId , memberId){
    throw new ApiError(400, "Admin ID and Member ID are required");
  }

  const member = await Developer.findUserById(memberId);
  const isInTeam = member.teams.some(
    (t) => t.adminId.toString() === adminId.toString()
  );

  if (!isInTeam) {
    throw new ApiError(400, "This developer is not a member of your team");
  }
  await InvitationRepo.removeMemberFromTeam(adminId, memberId);

  if (global.io) {
    global.io.to(memberId.toString()).emit("removed_from_team", {
      message: "You have been removed from the team by the admin.",
      adminId: adminId,
    });
  }

  return { message: "Member removed successfully from your team" };
}
module.exports = {sendInvite , getMyInvitations , respondToInvite , getTeamMembers , removeMember}