const mongoose = require("mongoose");
const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    clientName: {
      type: String,
      trim: true,
      default: null,
    },

    hourlyRate: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Set when a project is auto-created from a linked GitHub repository
    githubRepoId: {
      type: Number,
      default: null,
      index: true,
    },

    // True when this project was imported from GitHub (not manually created)
    isGithubImport: {
      type: Boolean,
      default: false,
    },

    description: String,

    status: {
      type: String,
      enum: ["active", "paused", "completed"],
      default: "active",
    },

    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Developer",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
projectSchema.index({ name: 1, owner: 1 }, { unique: true });
// Prevent duplicate auto-created GitHub projects for the same owner
projectSchema.index({ githubRepoId: 1, owner: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Project", projectSchema);
