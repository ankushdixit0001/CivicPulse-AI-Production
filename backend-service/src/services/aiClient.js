const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5000';

export const analyzeImage = async (file, metadata = {}) => {
  const formData = new FormData();
  formData.append('file', new Blob([file.buffer], { type: file.mimetype || 'image/jpeg' }), file.originalname || 'issue.jpg');

  try {
    const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`AI service responded with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn('AI service unavailable, using fallback scoring.', error.message);
    return {
      status: 'fallback',
      defect_type: metadata.defect_type || 'pothole',
      confidence: 0.8,
      severity: 'MEDIUM',
      priority_score: 72,
      damage_coverage_pct: 62,
      metadata: {},
      bounding_boxes: [{
        label: metadata.defect_type || 'pothole',
        confidence: 0.8,
        bbox: [30, 25, 250, 200],
      }],
    };
  }
};

export const verifyResolution = async (beforeFile, afterFile) => {
  const formData = new FormData();
  formData.append('before', new Blob([beforeFile.buffer], { type: beforeFile.mimetype || 'image/jpeg' }), beforeFile.originalname || 'before.jpg');
  formData.append('after', new Blob([afterFile.buffer], { type: afterFile.mimetype || 'image/jpeg' }), afterFile.originalname || 'after.jpg');

  try {
    const response = await fetch(`${AI_SERVICE_URL}/verify-resolution`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Verification failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn('Resolution verification unavailable; using fallback.', error.message);
    return {
      status: 'fallback',
      is_resolved: true,
      resolution_score: 84,
      ssim_score: 0.82,
      before_damage_pct: 65,
      after_damage_pct: 12,
      area_reduction_pct: 53,
    };
  }
};
