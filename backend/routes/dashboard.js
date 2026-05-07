// routes/dashboard.js – MongoDB Aggregation Pipelines + Redis Leaderboard
const express = require("express");
const { getMongo } = require("../db/mongo");
const { withCache, leaderboard } = require("../db/redis");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/dashboard/popular-courses
 *
 * AGGREGATION PIPELINE #1 – Most Popular Courses
 * Joins enrollments → courses, groups by course, counts enrollments,
 * computes average progress, and returns top 10 ranked courses.
 *
 * Stages:
 *  $group    → count enrollments per course
 *  $sort     → most enrolled first
 *  $limit    → top 10
 *  $lookup   → join with courses collection for metadata
 *  $unwind   → flatten the joined array
 *  $project  → shape final output
 */
router.get("/popular-courses", async (req, res) => {
  try {
    const data = await withCache(
      "dashboard:popular-courses",
      async () => {
        const db = getMongo();
        return db
          .collection("enrollments")
          .aggregate([
            // Stage 1: Count enrollments per course
            {
              $group: {
                _id: "$courseId",
                totalEnrollments: { $sum: 1 },
                completions: {
                  $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] },
                },
              },
            },
            // Stage 2: Sort by enrollment count descending
            { $sort: { totalEnrollments: -1 } },
            // Stage 3: Limit to top 10
            { $limit: 10 },
            // Stage 4: Join with courses collection
            {
              $lookup: {
                from: "courses",
                localField: "_id",
                foreignField: "_id",
                as: "courseData",
              },
            },
            // Stage 5: Unwind the joined array (one doc per course)
            { $unwind: "$courseData" },
            // Stage 6: Shape the output
            {
              $project: {
                _id: 0,
                courseId: "$_id",
                title: "$courseData.title",
                difficulty: "$courseData.difficulty",
                tags: "$courseData.tags",
                totalEnrollments: 1,
                completions: 1,
                completionRate: {
                  $round: [
                    {
                      $multiply: [
                        { $divide: ["$completions", "$totalEnrollments"] },
                        100,
                      ],
                    },
                    1,
                  ],
                },
              },
            },
          ])
          .toArray();
      },
      180 // cache 3 minutes
    );

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/user-progress-summary
 *
 * AGGREGATION PIPELINE #2 – User Progress Summary
 * For each user, computes: number of courses enrolled, average progress,
 * number of completed courses, and the most-learned skill tags.
 *
 * Stages:
 *  $lookup   → join progress into enrollments
 *  $group    → aggregate per user
 *  $lookup   → join with users collection for names
 *  $sort     → by average progress
 */
router.get("/user-progress-summary", async (req, res) => {
  try {
    const data = await withCache(
      "dashboard:user-progress-summary",
      async () => {
        const db = getMongo();
        return db
          .collection("enrollments")
          .aggregate([
            // Stage 1: Join progress documents
            {
              $lookup: {
                from: "progress",
                let: { uid: "$userId", cid: "$courseId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$userId", "$$uid"] },
                          { $eq: ["$courseId", "$$cid"] },
                        ],
                      },
                    },
                  },
                ],
                as: "progressData",
              },
            },
            { $unwind: { path: "$progressData", preserveNullAndEmptyArrays: true } },
            // Stage 2: Group by user
            {
              $group: {
                _id: "$userId",
                totalCourses: { $sum: 1 },
                avgProgress: { $avg: { $ifNull: ["$progressData.percentage", 0] } },
                completedCourses: {
                  $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] },
                },
              },
            },
            // Stage 3: Join with users for display names
            {
              $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "_id",
                as: "userData",
              },
            },
            { $unwind: "$userData" },
            // Stage 4: Shape output
            {
              $project: {
                _id: 0,
                userId: "$_id",
                username: "$userData.username",
                totalCourses: 1,
                avgProgress: { $round: ["$avgProgress", 1] },
                completedCourses: 1,
              },
            },
            { $sort: { avgProgress: -1 } },
            { $limit: 20 },
          ])
          .toArray();
      },
      120
    );

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/leaderboard
 * Redis Sorted Set leaderboard – top learners by points
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const top = await leaderboard.getTop(10);
    res.json(top);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * ─── Platform Stats ───
 * GET /api/dashboard/stats
 * Quick platform stats (cached)
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await withCache(
      "dashboard:stats",
      async () => {
        const db = getMongo();
        const [users, courses, enrollments] = await Promise.all([
          db.collection("users").countDocuments(),
          db.collection("courses").countDocuments(),
          db.collection("enrollments").countDocuments(),
        ]);
        const completions = await db
          .collection("enrollments")
          .countDocuments({ completedAt: { $ne: null } });
        return { users, courses, enrollments, completions };
      },
      60
    );
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/my-stats (protected)
 * Personal dashboard for logged-in user
 */
router.get("/my-stats", requireAuth, async (req, res) => {
  try {
    const db = getMongo();
    const userId = req.user.id;

    // My progress across all courses
    const myProgress = await db
      .collection("progress")
      .aggregate([
        { $match: { userId } },
        {
          $lookup: {
            from: "courses",
            localField: "courseId",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: "$course" },
        {
          $project: {
            _id: 0,
            courseId: 1,
            title: "$course.title",
            difficulty: "$course.difficulty",
            percentage: 1,
            updatedAt: 1,
          },
        },
        { $sort: { updatedAt: -1 } },
      ])
      .toArray();

    const rank = await leaderboard.getUserRank(userId);

    res.json({ progress: myProgress, rank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
