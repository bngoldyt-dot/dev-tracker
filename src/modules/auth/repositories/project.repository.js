const ApiError = require("../../../utils/apiErrors");
const Project = require("../schemas/project.schema");
const Developer = require("../schemas/developer.schema");
const mongoose = require("mongoose")
const createProject = async ({
  name,
  clientName,
  hourlyRate,
  description,
  owner,
}) => {
  return await Project.create({
    name,
    clientName,
    hourlyRate,
    description,
    owner,
  });
};
const isProjectExists = async (name, ownerId) => {
  const isExists = await Project.findOne({ name, owner: ownerId });
  return isExists;
};

const completeProject = async (ownerId, projectId) => {
  const project = await Project.findOneAndUpdate(
    { _id: projectId, owner: ownerId },
    {
      status: "completed",
      isArchived: true,
      archivedAt: new Date(),
    },
    { new: true },
  );

  if (!project) throw new ApiError(404, "Project not found or not authorized");

  return project;
};

const getArchivedProjects = async (ownerId, page, limit) => {
  return await Project.find({
    owner: ownerId,
    isArchived: true,
  })
    .sort({ archivedAt: -1 })
    .limit(limit)
    .skip(page * limit);
};

const findAllProjects = async (ownerIds, page, limit) => {
  // 1. تصحيح حساب الـ skip (لو الـ page بيبدأ من 1)
  // لو page = 1 و limit = 10، وعملت 1 * 10 هيعمل skip لـ 10 عناصر ويجيب من الصفحة التانية علطول!
  const skip = (page - 1) * limit;

  // 2. تشغيل الـ Find والـ Count بالتوازي بـ Promise.all لتقليل الـ Response Time للنص
  const [projects, totalActiveProjects] = await Promise.all([
    Project.find({
      owner: { $in: ownerIds },
      isArchived: false,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'owner',          // اسم الحقل اللي رابط المشروع بالـ Admin
        select: 'name email avatar', // 🔥 الأوبتميزايشن: هات الحقول دي بس من المطور/الأدمن
      })
      .lean(), // 🔥 الكينج بتاع الـ Optimization: بيرجع JSON عادي أسرع وأخف 10 مرات من الـ Mongoose Document

    Project.countDocuments({
      owner: { $in: ownerIds },
      isArchived: false,
    })
  ]);

  return { projects, totalActiveProjects };
};

const deleteOneProject = async (ownerId, projectId) => {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID");
  }

  const project = await Project.findOneAndDelete({
    _id: projectId,
    owner: ownerId,
  },


  );

  return project;
};

// src/modules/projects/repositories/auth.repository.js

const incrementDeveloperProjectCount = async (developerId) => {
  return await Developer.findByIdAndUpdate(
    developerId,
    { $inc: { projectCount: 1 } },
    { new: true }
  );
};
const countAllProjects = async (developerId) => {
  return await Project.countDocuments({
    owner: developerId,
    isArchived: false
  })
}

const countAllArchivedProjects = async (developerId) => {
  return await Project.countDocuments({
    owner: developerId,
    isArchived: true
  })
}

const getOneProject = async (projectId) => {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID");
  }

  const project = await Project.findById(projectId)
  return project;
}

const getOneActiveProjects = async (developerId, projectId) => {
  const project = await Project.findOne({
    _id: projectId,
    owner: developerId,
    isArchived: false,
  });

  return project
}

const deleteProjects = async (ownerId) => {
  const deletedProjects = await Project.deleteMany({ owner: ownerId, isArchived: true, })
  return deletedProjects;
}

module.exports = {
  createProject,
  isProjectExists,
  completeProject,
  getArchivedProjects,
  findAllProjects,
  deleteOneProject,
  getOneProject,
  deleteProjects,
  countAllProjects,
  countAllArchivedProjects,
  getOneActiveProjects,
  incrementDeveloperProjectCount

};
