export const ISSUE_CATEGORIES = Object.freeze(['pothole', 'garbage', 'sewage', 'streetlight', 'unknown']);
export const ISSUE_STATUSES = Object.freeze(['Pending', 'Assigned', 'In Progress', 'Resolved']);
export const USER_ROLES = Object.freeze(['resident', 'staff', 'admin']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

export function validateIssueReport(input) {
  const errors = {};
  if (!ISSUE_CATEGORIES.includes(input.defect_type)) errors.defect_type = 'Unsupported issue category.';
  const description = String(input.description || '').trim();
  if (description.length < 5 || description.length > 2000) errors.description = 'Description must be 5–2000 characters.';
  const lat = Number(input.latitude), lng = Number(input.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.latitude = 'Latitude must be between -90 and 90.';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.longitude = 'Longitude must be between -180 and 180.';
  const landmark = String(input.landmark || '');
  if (landmark.length > 200) errors.landmark = 'Landmark must be 200 characters or fewer.';
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateImage(file) {
  if (!file || !ALLOWED_IMAGE_TYPES.includes(file.type)) return { valid: false, error: 'Upload a JPG, PNG, or WebP image.' };
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return { valid: false, error: 'Image must be between 1 byte and 8 MB.' };
  return { valid: true, errors: {} };
}

export function validateComment(body) {
  const value = String(body || '').trim();
  return value.length >= 1 && value.length <= 2000
    ? { valid: true, value }
    : { valid: false, error: 'Comment must be between 1 and 2000 characters.' };
}
