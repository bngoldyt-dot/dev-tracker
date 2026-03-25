const ApiError = require("../../../../utils/apiErrors");
const { createTaskSchema } = require("../../schemas/auth.schema");
const {
  createTaskService,
  completeTaskService,
  getProjectFinancialsService,
  getAllTasks,
  deleteAllTasks,
} = require("../../services/task.service");

const createDevtask = async (req, res, next) => {
  try {
    const { error } = createTaskSchema.validate(req.body);
    if (error) return next(new ApiError(400, error.details[0].message));
    const developerId = req.user._id;
    const projectId = req.params["id"];
    const data = req.body;
    const task = await createTaskService(developerId, projectId, data);
    res.status(201).json({
      message: "Task created successfully",
      task,
    });
  } catch (error) {
    next(error);
  }
};

const completeDevTask = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const projectId = req.params.projectId;
    const taskId = req.params.taskId;

    const task = await completeTaskService(developerId, projectId, taskId);

    res.status(200).json({
      status: "success",
      task,
      message: "Task completed successfully",
    });
  } catch (err) {
    next(err);
  }
};

// controllers/project.controller.js
const getProjectFinancialsController = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const developerId = req.user.id; // جاية من الـ Auth Middleware

    const financials = await getProjectFinancialsService(projectId, developerId);

    res.status(200).json({
      status: "success",
      financials,
    });
  } catch (err) {
    next(err);
  }
};

const getAllProjectTasks = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const projectId = req.params["id"];

    const tasks = await getAllTasks(projectId, developerId);

    res.status(200).json({
      message: "Tasks retrieved successfully",
      results: tasks.length,
      tasks,
    });
  } catch (error) {
    next(error);
  }
};

const deleteAllProjectTasks = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const projectId = req.params["id"];
    const deltedTask = await deleteAllTasks(projectId , developerId)
   
    if (deltedTask.deletedCount === 0) {
      return res.status(200).json({ 
        message: 'No completed tasks found to delete', 
        count: 0 
      });
    }
      res.status(200).json({message:'Tasks Removed successfully'})
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDevtask,
  completeDevTask,
  getProjectFinancialsController,
  getAllProjectTasks,
  deleteAllProjectTasks
};
