const ApiError = require("../../../../utils/apiErrors");
const { createProjectSchema } = require("../../schemas/auth.schema");
const {
  createDevProject,
  completedDevProject,
  getDevProjectArchived,
  getAllDevProjects,
  deleteDevProject,
  deleteAllDevProject,
} = require("../../services/project.service");

const createProjectDev = async (req, res, next) => {
  try {
    const { error } = createProjectSchema.validate(req.body);
    if (error) return next(new ApiError(400, error.details[0].message));

    const { name, clientName, hourlyRate, description } = req.body;
    const developerId = req.user._id;

    const project = await createDevProject({
      name,
      clientName,
      hourlyRate,
      description,
      developerId,
    });

    res.status(201).json({
      status: "success",
      message: "Project created successfully",
      data: project,
    });
  } catch (error) {
    // هنا الـ error اللي راجع من الـ Service (سواء 403 limit أو غيره) هيمر للـ Middleware
    next(error);
  }
};

const completedProjectDev = async (req, res, next) => {
  try {
    const projectId = req.params["id"];
    const developerId = req.user._id;
    const deletedProject = await completedDevProject(developerId, projectId);
    res.status(201).json({
      message: "project completed and archived successfully",
      deletedProject,
    });
  } catch (error) {
    next(error);
  }
};

const getAllArchivedProjects = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const page = Math.max(0, Number(req.query.page) || 0);
    const limit = 10;

    const { archivedProjects, totalHistory } = await getDevProjectArchived(
      developerId,
      page,
      limit,
    );

    res.status(200).json({
      page,
      limit,
      totalHistory,
      archivedProjects,
    });
  } catch (error) {
    next(error);
  }
};

const getAllProjects = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const page = Math.max(0, Number(req.query.page) || 0);
    const limit = 10;

    const { Projects, totalActiveProjects } = await getAllDevProjects(
      developerId,
      page,
      limit,
    );

    res.status(200).json({
      page,
      limit,
      total: totalActiveProjects,
      Projects,
    });
  } catch (error) {
    next(error);
  }
};

const deleteProject = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const projectId = req.params["id"];
    await deleteDevProject(developerId, projectId);
    res.status(203).json({ message: "project deleted successfully" });
  } catch (error) {
    next(error);
  }
};

const deleteAllProjects = async (req, res, next) => {
  try {
    const developerId = req.user._id;
    const removedProjects = await deleteAllDevProject(developerId);
    if (!removedProjects)
      return next(new ApiError(404, "No projects found in history"));
    res.status(201).json({ messsage: "history cleared successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProjectDev,
  completedProjectDev,
  getAllArchivedProjects,
  getAllProjects,
  deleteProject,
  deleteAllProjects,
};
