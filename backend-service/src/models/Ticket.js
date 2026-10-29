import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema(
  {
    defect_type: {
      type: String,
      required: true,
      enum: ['pothole', 'garbage', 'sewage', 'streetlight', 'unknown'],
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 2000,
    },
    priority_score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    severity: {
      type: String,
      enum: ['CRITICAL', 'MEDIUM', 'LOW'],
      default: 'LOW',
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (coordinates) =>
            Array.isArray(coordinates) &&
            coordinates.length === 2 &&
            Number.isFinite(coordinates[0]) &&
            coordinates[0] >= -180 && coordinates[0] <= 180 &&
            Number.isFinite(coordinates[1]) &&
            coordinates[1] >= -90 && coordinates[1] <= 90,
          message: 'Location must be [longitude, latitude] within valid ranges.',
        },
      },
    },
    exif_timestamp: { type: Date },
    before_image_url: String,
    after_image_url: String,
    status: {
      type: String,
      enum: ['Pending', 'Assigned', 'In Progress', 'Resolved'],
      default: 'Pending',
    },
    upvote_count: { type: Number, default: 0, min: 0 },
    report_frequency: { type: Number, default: 1, min: 1 },
    duplicate_count: { type: Number, default: 0, min: 0 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    zone: { type: String, default: 'central', maxlength: 80 },
    before_damage_pct: { type: Number, min: 0, max: 100 },
    after_damage_pct: { type: Number, min: 0, max: 100, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ location: '2dsphere' });
ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ zone: 1, status: 1 });
ticketSchema.index({ priority_score: -1 });

const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);

export default Ticket;
