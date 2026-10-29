import express from 'express';
import multer from 'multer';
import Ticket from '../models/Ticket.js';
import { analyzeImage } from '../services/aiClient.js';

const router = express.Router();
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Upload a JPG, PNG, or WebP image.');
      error.status = 415;
      return callback(error);
    }
    callback(null, true);
  },
});

const allowedDefects = new Set(['pothole', 'garbage', 'sewage', 'streetlight', 'unknown']);
const allowedStatuses = new Set(['Pending', 'Assigned', 'In Progress', 'Resolved']);

// General object detectors do not predict CivicPulse's civic taxonomy reliably.
// Map only well-known labels; use the resident's selected category for the rest.
const normalizeDefect = (label, fallback = 'unknown') => {
  const value = String(label || '').toLowerCase().replace(/[ -]+/g, '_');
  const aliases = {
    pothole: 'pothole',
    garbage: 'garbage',
    trash: 'garbage',
    rubbish: 'garbage',
    waste: 'garbage',
    sewage: 'sewage',
    sewer: 'sewage',
    streetlight: 'streetlight',
    street_light: 'streetlight',
    lamp: 'streetlight',
    traffic_light: 'unknown',
  };
  return aliases[value] || (allowedDefects.has(fallback) ? fallback : 'unknown');
};

const getZoneFromCoordinates = ([lng, lat]) => {
  // Zone names are intentionally generic until real municipal boundaries are configured.
  if (lat > 40.74) return 'north';
  if (lat < 40.72) return 'south';
  return 'central';
};

const emitSocketEvent = (req, eventName, payload) => {
  const io = req.app.get('io');
  if (io) io.emit(eventName, payload);
};

router.get('/', async (req, res, next) => {
  try {
    const { status, zone, priority_score } = req.query;
    const query = {};
    if (status) {
      if (!allowedStatuses.has(status)) return res.status(400).json({ message: 'Invalid status filter.' });
      query.status = status;
    }
    if (zone) query.zone = String(zone).slice(0, 80);
    if (priority_score !== undefined) {
      const score = Number(priority_score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return res.status(400).json({ message: 'priority_score must be between 0 and 100.' });
      }
      query.priority_score = { $gte: score };
    }

    const tickets = await Ticket.find(query).sort({ createdAt: -1 }).limit(250).lean();
    // Never show synthetic demo incidents as if they were real resident reports.
    return res.json(tickets);
  } catch (error) {
    return next(error);
  }
});

router.post('/report', upload.single('image'), async (req, res, next) => {
  try {
    const { defect_type, latitude, longitude, description, status = 'Pending' } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ message: 'Image file is required.' });
    if (!description || String(description).trim().length < 5 || String(description).trim().length > 2000) {
      return res.status(400).json({ message: 'Description must be between 5 and 2000 characters.' });
    }
    if (!allowedDefects.has(defect_type)) return res.status(400).json({ message: 'Choose a supported issue category.' });
    if (status !== 'Pending') return res.status(400).json({ message: 'New reports must start as Pending.' });

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required. Use your location or enter coordinates.' });
    }

    const aiResult = await analyzeImage(file, { defect_type });
    const defectLabel = normalizeDefect(aiResult.defect_type, defect_type);
    const zone = getZoneFromCoordinates([lng, lat]);

    const duplicateTicket = await Ticket.findOne({
      defect_type: defectLabel,
      status: { $ne: 'Resolved' },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: 15,
        },
      },
    });

    if (duplicateTicket) {
      duplicateTicket.upvote_count += 1;
      duplicateTicket.report_frequency += 1;
      duplicateTicket.duplicate_count += 1;
      await duplicateTicket.save();
      emitSocketEvent(req, 'INCIDENT_UPDATED', duplicateTicket.toObject());
      return res.status(200).json({
        message: 'Nearby report merged into the existing incident.',
        ticket: duplicateTicket,
        merged: true,
      });
    }

    const newTicket = await Ticket.create({
      defect_type: defectLabel,
      description: String(description).trim(),
      priority_score: Math.round(Math.min(100, Math.max(0, Number(aiResult.priority_score) || 0))),
      severity: ['CRITICAL', 'MEDIUM', 'LOW'].includes(aiResult.severity) ? aiResult.severity : 'LOW',
      location: { type: 'Point', coordinates: [lng, lat] },
      exif_timestamp: new Date(),
      status: 'Pending',
      zone,
      confidence: Math.min(1, Math.max(0, Number(aiResult.confidence) || 0)),
      upvote_count: 1,
      report_frequency: 1,
      duplicate_count: 0,
      before_damage_pct: Math.min(100, Math.max(0, Number(aiResult.damage_coverage_pct) || 0)),
      after_damage_pct: null,
    });

    emitSocketEvent(req, 'INCIDENT_CREATED', newTicket.toObject());
    return res.status(201).json({ message: 'Ticket created successfully.', ticket: newTicket, merged: false });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!allowedStatuses.has(status)) return res.status(400).json({ message: 'Invalid ticket status.' });
    if (status === 'Resolved') {
      return res.status(400).json({
        message: 'Resolution requires a real after-repair photo and review. Use the resolution evidence workflow before marking this issue resolved.',
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    const previousStatus = ticket.status;
    ticket.status = status;
    await ticket.save();

    emitSocketEvent(req, 'INCIDENT_UPDATED', { ...ticket.toObject(), previousStatus });
    return res.json(ticket);
  } catch (error) {
    return next(error);
  }
});

export default router;
