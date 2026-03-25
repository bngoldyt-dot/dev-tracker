const ApiError = require("../../../utils/apiErrors");
const { findUserById } = require("../repositories/auth.repository");
const { getOneActiveProjects } = require("../repositories/project.repository");
const { creatTaske, findTaskById, getProjectFinancials, findAllTasksByProjectId, deleteCompletedTasks } = require("../repositories/task.repository");
const { developerRouter } = require("../routes/developer.routes");
const projectSchema = require("../schemas/project.schema");
const taskActivityService = require('./taskAvtivity.service')

const createTaskService = async (developerId, projectId, data) => {
  if (!developerId || !projectId)
    throw new ApiError(401, "Unauthorized: missing developer or project id");

  // 1. نجيب المشروع
  const project = await projectSchema.findById(projectId);
  if (!project) throw new ApiError(404, "Project not found");

  // 2. التحقق من الصلاحية
  const isOwner = project.owner.toString() === developerId.toString();
  
  const user = await findUserById(developerId);
  // بندور هل المطور ده عضو في تيم صاحب المشروع؟
  const teamContext = user.teams.find(t => t.adminId.toString() === project.owner.toString());

  // لو مش صاحب المشروع ومش عضو في التيم ومعاه صلاحية إدارة التاكات.. ارفض
  if (!isOwner && (!teamContext || !teamContext.permissions.canManageTasks)) {
    throw new ApiError(403, "You don't have permission to add tasks to this project");
  }

  // 3. إنشاء التاسك
  const task = await creatTaske({ ...data, project: projectId });
  return task;
};


const completeTaskService = async (developerId, projectId, taskId) => {
  const task = await findTaskById(taskId);
  if (!task) throw new ApiError(404, "Task not found");

  // التأكد إن التاسك تابعة للمشروع ده أصلاً
  if (String(task.project._id) !== String(projectId)) {
    throw new ApiError(400, "Task does not belong to this project");
  }

  // التحقق من الصلاحية
  const isOwner = task.project.owner.toString() === developerId.toString();
  const user = await findUserById(developerId);
  const teamContext = user.teams.find(t => t.adminId.toString() === task.project.owner.toString());

  if (!isOwner && (!teamContext || !teamContext.permissions.canManageTasks)) {
    throw new ApiError(403, "Access denied: You cannot modify tasks in this team");
  }

  // الـ Logic بتاع الـ Activity اللي إنت عامله (جميل جداً)
  const status = await taskActivityService.getTaskStatus({ developerId, taskId });
  if (status.isWorking) {
    await taskActivityService.endTask({
      developerId,
      projectId,
      taskId,
      source: "STATUS_CHANGE"
    });
  }

  task.status = "done";
  task.completedAt = new Date();
  
  // ملاحظة: لو المطور مش هو الأونر، هل مسموح له يشوف الـ hourlyRate؟ 
  // إنت عامل في الـ Schema صلاحية canSeeFinancials، ممكن تستخدمها هنا
  if (isOwner || (teamContext && teamContext.permissions.canSeeFinancials)) {
     task.earnedMoney = (task.spentHours || 0) * task.project.hourlyRate;
  }

  await task.save();
  return task;
};

// services/project.service.js
const getProjectFinancialsService = async (projectId, developerId) => {
  if (!developerId || !projectId)
    throw new ApiError(401, "Unauthorized: missing ids");

  // 1. نجيب المشروع عشان نعرف الأونر
  const project = await projectSchema.findById(projectId);
  if (!project) throw new ApiError(404, "Project not found");

  // 2. التحقق من الصلاحية
  const isOwner = project.owner.toString() === developerId.toString();
  
  const user = await findUserById(developerId);
  // بندور هل المطور ده في تيم الأونر ومسموح له يشوف الفلوس؟
  const teamContext = user.teams.find(t => t.adminId.toString() === project.owner.toString());

  // لو مش صاحب المشروع ومعندوش صلاحية canSeeFinancials
  if (!isOwner && (!teamContext || !teamContext.permissions.canSeeFinancials)) {
    throw new ApiError(403, "Access Denied: You don't have permission to view project financials");
  }

  // 3. لو الصلاحية تمام.. نكلم الـ Repository يجيب الداتا
  return await getProjectFinancials(projectId);
};

const getAllTasks = async (projectId, developerId) => {
    if (!developerId || !projectId)
        throw new ApiError(401, "Unauthorized: missing developer or project id");

    // 1. نجيب المشروع الأول عشان نعرف مين صاحبه
    const project = await projectSchema.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Project not found");
    }

    // 2. التحقق من الصلاحية: هل هو الصاحب؟ أو عضو في فريق الصاحب؟
    const isOwner = project.owner.toString() === developerId.toString();
    
    // نجيب بيانات المطور عشان نشوف الفرق بتاعته
    const developer = await findUserById(developerId);
    const isMember = developer.teams.some(t => t.adminId.toString() === project.owner.toString());

    if (!isOwner && !isMember) {
        throw new ApiError(403, "You don't have permission to access tasks for this project");
    }

    // 3. لو عدى من الـ Check، هات التاكات عادي
    const tasks = await findAllTasksByProjectId(projectId);
    return tasks;
}
const deleteAllTasks = async(projectId  , developerId) => {
    if (!developerId || !projectId)
    throw new ApiError(401, "Unauthorized: missing developer or project id");
    
    const project = await projectSchema.findOne({ 
        _id: projectId,   
        owner: developerId 
    });

    if (!project) {
        throw new ApiError(403, "You don't have permission to access tasks for this project");
    }
    const deletedTask = await deleteCompletedTasks(projectId);
    
    return deletedTask;
}




module.exports = { createTaskService , completeTaskService , getProjectFinancialsService  , getAllTasks , deleteAllTasks};
