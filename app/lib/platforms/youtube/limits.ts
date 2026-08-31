export const YOUTUBE_LIMITS = {
  // YouTube API uses units/day: upload = 1600 units, read = 1 unit
  // Default daily quota: 10,000 units → ~6 uploads/day
  uploadsPerDay: 6,
  dailyQuotaUnits: 10000,
};
