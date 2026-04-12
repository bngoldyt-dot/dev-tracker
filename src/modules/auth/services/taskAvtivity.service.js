const ApiError = require("../../../utils/apiErrors");
const TaskActivity = require('../schemas/taskActivity.schema');
const TaskActivityRepo = require('../repositories/taskActivty.repository');
const mongoose = require("mongoose");
const { findTaskById } = require("../repositories/task.repository");
const redis = require('../../../config/redis');
const { autoCompleteQueue, taskSyncQueue } = require('../../../utils/taskQueue');

async function startTask({ developerId, projectId, taskId, source = "MANUAL" }) {
  if (!developerId || !projectId || !taskId)
    throw new ApiError(401, "Unauthorized: missing developer, project or task id");

  const redisKey = `task:${taskId}`;
  const existingState = await redis.hgetall(redisKey);

  if (existingState && existingState.status === "completed") {
    throw new ApiError(400, "خلاص يا ريس التاسك دي خلصت، مينفعش تبدأ فيها تاني!");
  }

  if (existingState && existingState.status === "active") {
    throw new ApiError(400, "التاسك شغال بالفعل.");
  }

  const task = await findTaskById(taskId);
  if (!task) {
    throw new ApiError(404, "Task not found");
  }

  if (task.status === "done") {
    await redis.hset(redisKey, { status: 'completed' });
    throw new ApiError(400, "خلاص يا ريس التاسك دي خلصت، مينفعش تبدأ فيها تاني!");
  }

  const estimatedDuration = (task.estimatedHours || 0) * 3600000;
  let accumulatedDuration = parseInt(existingState.accumulatedDuration || "0", 10);

  if (!existingState || Object.keys(existingState).length === 0) {
    accumulatedDuration = (task.spentHours || 0) * 3600000;
  }

  const remainingTime = Math.max(0, estimatedDuration - accumulatedDuration);

  // Auto-complete timer
  let bullJobId = null;
  if (estimatedDuration > 0 && remainingTime > 0) {
    const job = await autoCompleteQueue.add('auto-complete', {
      developerId, projectId, taskId
    }, {
      delay: remainingTime,
      jobId: `autocomplete_${taskId}`
    });
    bullJobId = job.id;
  }

  await redis.hset(redisKey, {
    projectId: projectId.toString(),
    developerId: developerId.toString(),
    status: 'active',
    startTime: Date.now(),
    accumulatedDuration,
    estimatedDuration,
    ...(bullJobId && { bullJobId })
  });

  await taskSyncQueue.add('sync-start', {
    developerId, projectId, taskId, type: 'START', source
  });

  return { success: true, message: "Task started", taskId };
}

async function endTask({ developerId, projectId, taskId, source = "MANUAL" }) {
  if (!developerId || !projectId || !taskId)
    throw new ApiError(401, "Unauthorized: missing developer, project or task id");

  const redisKey = `task:${taskId}`;
  const taskState = await redis.hgetall(redisKey);

  if (!taskState || taskState.status !== 'active') {
    throw new ApiError(400, "Task is not active or already ended.");
  }

  const startTime = parseInt(taskState.startTime || Date.now(), 10);
  const accumulatedDuration = parseInt(taskState.accumulatedDuration || "0", 10);
  const elapsed = Date.now() - startTime;
  const newAccumulated = accumulatedDuration + elapsed;

  if (taskState.bullJobId) {
    const job = await autoCompleteQueue.getJob(taskState.bullJobId);
    if (job) await job.remove();
  }

  await redis.hset(redisKey, {
    status: 'paused',
    accumulatedDuration: newAccumulated
  });
  await redis.hdel(redisKey, 'startTime');
  await redis.hdel(redisKey, 'bullJobId');

  await taskSyncQueue.add('sync-end', {
    developerId, projectId, taskId, type: 'END', source
  });

  return { success: true, message: "Task paused/ended" };
}

async function pauseTask({ developerId, projectId, taskId }) {
  return endTask({ developerId, projectId, taskId, source: "MANUAL" });
}

async function resumeTask({ developerId, projectId, taskId }) {
  return startTask({ developerId, projectId, taskId, source: "MANUAL" });
}

async function getTaskStatus({ developerId, taskId }) {
  const redisKey = `task:${taskId}`;
  const taskState = await redis.hgetall(redisKey);

  if (taskState && Object.keys(taskState).length > 0) {
    const isWorking = taskState.status === 'active';
    let durationMs = parseInt(taskState.accumulatedDuration || "0", 10);

    if (isWorking && taskState.startTime) {
      durationMs += (Date.now() - parseInt(taskState.startTime, 10));
    }

    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs / (1000 * 60)) % 60);

    return {
      isWorking,
      duration: `${hours}h ${minutes}m`,
      status: taskState.status
    };
  }

  const lastStart = await TaskActivityRepo.findLastStart({ developerId, taskId });
  if (!lastStart) return { isWorking: false, duration: "0h 0m" };

  const lastEnd = await TaskActivityRepo.findLastEndAfterStart({
    developerId,
    taskId,
    startDate: lastStart.createdAt
  });

  let isWorking = false;
  let duration = 0;

  if (!lastEnd) {
    isWorking = true;
    duration = new Date() - new Date(lastStart.createdAt);
  } else {
    duration = new Date(lastEnd.createdAt) - new Date(lastStart.createdAt);
  }

  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration / (1000 * 60)) % 60);

  return {
    isWorking,
    duration: `${hours}h ${minutes}m`,
    lastStart: lastStart.createdAt,
    lastEnd: lastEnd?.createdAt || null
  };
}
async function getAllSessions({ developerId, taskId }) {
  return TaskActivityRepo.findAllSessions({ developerId, taskId });
}

async function getAllSessionsService({ developerId, projectId, taskId }) {
  if (!developerId || !projectId || !taskId)
    throw new ApiError(401, "Unauthorized: missing developer, project or task id")

  return TaskActiviTaskActivityRepoty.findAllSessions({ developerId, taskId })
}
const getWeeklyTotalHours = async (developerId) => {
  const now = new Date();
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const stats = await TaskActivity.aggregate([
    {
      $match: {
        developer: new mongoose.Types.ObjectId(developerId),
        createdAt: { $gte: startOfWeek }
      }
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$task",
        activities: { $push: { type: "$type", time: "$createdAt" } }
      }
    }
  ]);

  let totalMs = 0;

  stats.forEach(task => {
    const logs = task.activities;
    for (let i = 0; i < logs.length; i++) {
      if (logs[i].type === 'START') {
        const startTime = new Date(logs[i].time);
        let endTime;

        if (logs[i + 1] && logs[i + 1].type === 'END') {
          endTime = new Date(logs[i + 1].time);
        } else {
          endTime = new Date();
        }

        totalMs += (endTime - startTime);
      }
    }
  });

  const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);
  return totalHours;
};

const getWeeklyProductivityStats = async (developerId) => {
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  return await TaskActivity.aggregate([
    {
      $match: {
        developer: new mongoose.Types.ObjectId(developerId),
        createdAt: { $gte: startOfWeek }
      }
    },
    { $sort: { task: 1, createdAt: 1 } },
    {
      $group: {
        _id: {
          task: "$task",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
        },
        activities: { $push: { type: "$type", time: "$createdAt" } }
      }
    },
    {
      $project: {
        day: "$_id.day",
        totalHours: {
          $reduce: {
            input: { $range: [0, { $size: "$activities" }] },
            initialValue: 0,
            in: {
              $let: {
                vars: {
                  current: { $arrayElemAt: ["$activities", "$$this"] },
                  next: { $arrayElemAt: ["$activities", { $add: ["$$this", 1] }] }
                },
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$$current.type", "START"] },
                        { $eq: ["$$next.type", "END"] }
                      ]
                    },
                    {
                      $add: [
                        "$$value",
                        {
                          $let: {
                            vars: {
                              diff: { $subtract: ["$$next.time", "$$current.time"] }
                            },
                            in: {
                              $cond: [
                                { $or: [{ $gt: ["$$diff", 86400000] }, { $lt: ["$$diff", 0] }] },
                                0,
                                { $divide: ["$$diff", 3600000] }
                              ]
                            }
                          }
                        }
                      ]
                    },
                    "$$value"
                  ]
                }
              }
            }
          }
        }
      }
    },
    {
      $group: {
        _id: "$day",
        hours: { $sum: "$totalHours" }
      }
    },
    {
      $project: {
        _id: 0,
        date: "$_id",
        hours: { $min: [24, { $round: ["$hours", 2] }] }
      }
    },
    { $sort: { date: 1 } }
  ]);
};
module.exports = {
  startTask,
  endTask,
  pauseTask,
  resumeTask,
  getTaskStatus,
  getAllSessions,
  getAllSessionsService,
  getWeeklyTotalHours,
  getWeeklyProductivityStats
};
