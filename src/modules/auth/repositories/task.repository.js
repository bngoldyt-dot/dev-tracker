const taskSchema = require("../schemas/task.schema");
const mongoose = require("mongoose");

const creatTaske = (data) => {
  return taskSchema.create(data);
};

const completeTaskById = (taskId) => {
  return taskSchema.findByIdAndUpdate(
    taskId,
    { status: "done" },
    { new: true },
  );
};

const findTaskById = (taskId) =>
  taskSchema.findById(taskId).populate("project");

// repositories/task.repository.js
const getProjectFinancials = async (projectId) => {
  const result = await taskSchema.aggregate([
    {
      $match: {
        project: new mongoose.Types.ObjectId(projectId),
      },
    },
    {
      $lookup: {
        from: "projects",
        localField: "project",
        foreignField: "_id",
        as: "projectData",
      },
    },
    { $unwind: "$projectData" },
    {
      $group: {
        _id: "$project",
        earned: {
          $sum: {
            $cond: [
              { $eq: ["$status", "done"] },
              { $multiply: ["$estimatedHours", "$projectData.hourlyRate"] },
              0,
            ],
          },
        },
        remaining: {
          $sum: {
            $cond: [
              { $ne: ["$status", "done"] },
              { $multiply: ["$estimatedHours", "$projectData.hourlyRate"] },
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        earned: 1,
        remaining: 1,
        total: { $add: ["$earned", "$remaining"] },
      },
    },
  ]);

  return result[0] || { earned: 0, remaining: 0, total: 0 };
};

const findAllTasksByProjectId = (projectId) => {
  return taskSchema.find({ project: projectId })
    .sort({ createdAt: -1 }); 
};

const deleteCompletedTasks = async (projectId) => {
  
  return taskSchema.deleteMany({
    project: projectId,
    status: 'done'
  });
};
module.exports = {
  creatTaske,
  completeTaskById,
  findTaskById,
  getProjectFinancials,
  findAllTasksByProjectId,
  deleteCompletedTasks
};
